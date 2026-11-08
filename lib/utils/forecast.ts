// Deterministic month forecast behind GET /v1/reports/month-forecast and the
// weekly Telegram analysis. Everything here is pure: the service loads rows,
// this decides the numbers, the agent only narrates them.
//
// Basis is the app's "fluxo de caixa" view: an expense belongs to the month of
// its effectiveDate (a card purchase lands on the bill's due date), never the
// purchase date. Rows still awaiting review are NOT part of the analysis — the
// forecast is built from what was actually stored.

export const DEFAULT_HISTORY_MONTHS = 3;
export const DEFAULT_SAVINGS_GOAL = 1500;
export const DEFAULT_ALERT_MARGIN = 500;
export const MAX_HISTORY_MONTHS = 12;

export interface ForecastExpense {
  value: number;
  // Purchase date — only used for the credit-rate window.
  date: string;
  // Cash-flow date (`YYYY-MM-DD`). Decides the month.
  effectiveDate: string;
  paymentType: string;
  cardBrand?: string | null;
  type: string;
  // 1-based; absent on non-installment rows.
  installment?: number | null;
}

export interface ForecastIncome {
  value: number;
  date: string;
  type: string;
}

export interface CardWindow {
  cardBrand: string;
  closingDate: string;
  dueDate: string;
}

export interface ForecastInput {
  /** `YYYY-MM` */
  month: string;
  /** `YYYY-MM-DD` inside `month` (or its last day, to report a closed month). */
  today: string;
  /** Effective dates in `[month-N .. month]`. */
  expenses: ForecastExpense[];
  /** Incomes dated in `[month-N .. month]`. */
  incomes: ForecastIncome[];
  /** The cycles of every card, so the ones due in `month` can be projected. */
  cardWindows: CardWindow[];
  historyMonths?: number;
  savingsGoal?: number;
  alertMargin?: number;
}

export type SavingsStatus = 'ok' | 'atencao' | 'risco';

export interface CardProjection {
  cardBrand: string;
  closingDate: string;
  dueDate: string;
  /** Card spend this month that is not recorded yet (average bill minus what is already stored). */
  expectedAdditional: number;
}

export interface MonthForecast {
  month: string;
  today: string;
  daysInMonth: number;
  daysRemaining: number;
  /** Everything already stored with an effectiveDate in this month. */
  committed: number;
  expected: {
    /** Spend that should already be recorded by today but is not (import lag). */
    unrecorded: number;
    unrecordedLow: number;
    unrecordedHigh: number;
    /** Non-credit spend still to happen, net of what is already booked after today. */
    tail: number;
    tailLow: number;
    tailHigh: number;
    /** Card bills still to be recorded, from each card's own recent monthly average. */
    cards: number;
    cardsLow: number;
    cardsHigh: number;
    total: number;
  };
  projected: number;
  projectedLow: number;
  projectedHigh: number;
  cards: CardProjection[];
  income: {
    recorded: number;
    /** Median salary of the history months, only when this month has none yet. */
    salaryEstimate: number;
    expected: number;
    estimated: boolean;
  };
  savings: {
    goal: number;
    status: SavingsStatus;
    projected: number;
    /** What can still be spent this month and still hit the goal. */
    remainingBudget: number;
    dailyAllowance: number | null;
  };
  history: { month: string; sameDayTotal: number; finalTotal: number }[];
  categories: { type: string; current: number; avgFinal: number; delta: number }[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const monthOf = (date: string): string => date.slice(0, 7);
const dayOf = (date: string): number => Number(date.slice(8, 10));
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/** `YYYY-MM` shifted by `delta` months, across year boundaries. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12 + 12) % 12 + 1).padStart(2, '0')}`;
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function monthForecast(input: ForecastInput): MonthForecast {
  const historyMonths = Math.min(
    Math.max(input.historyMonths ?? DEFAULT_HISTORY_MONTHS, 1),
    MAX_HISTORY_MONTHS
  );
  const goal = input.savingsGoal ?? DEFAULT_SAVINGS_GOAL;
  const margin = input.alertMargin ?? DEFAULT_ALERT_MARGIN;
  const { month, today } = input;
  const todayDay = dayOf(today);
  const daysTotal = daysInMonth(month);
  const daysRemaining = Math.max(0, daysTotal - todayDay);
  // Most recent first; reversed only for the output block.
  const pastMonths = Array.from({ length: historyMonths }, (_, index) => shiftMonth(month, -(index + 1)));

  const monthRows = input.expenses.filter(row => monthOf(row.effectiveDate) === month);
  const committed = round2(sum(monthRows.map(row => row.value)));

  // --- Non-credit spend ------------------------------------------------------
  // Two separate gaps between what is stored and what the month will spend:
  //  a) spend that should ALREADY be recorded by today (the day-5 rent paid by
  //     pix, imported days later). History says how much a month normally has
  //     on the books by this day; the shortfall is treated as not-yet-imported,
  //     not as money saved.
  //  b) spend still ahead, net of what is already booked for the future.
  const committedNonCredit = sum(monthRows.filter(row => row.paymentType !== 'credit').map(row => row.value));
  const bookedAfterToday = sum(
    monthRows
      .filter(row => row.paymentType !== 'credit' && dayOf(row.effectiveDate) > todayDay)
      .map(row => row.value)
  );
  const nonCreditSamples = (afterToday: boolean) =>
    pastMonths.map(pastMonth =>
      round2(
        sum(
          input.expenses
            .filter(
              row =>
                monthOf(row.effectiveDate) === pastMonth &&
                row.paymentType !== 'credit' &&
                (dayOf(row.effectiveDate) > todayDay) === afterToday
            )
            .map(row => row.value)
        )
      )
    );

  const mtdSamples = nonCreditSamples(false);
  const aheadSamples = nonCreditSamples(true);
  const mean = (values: number[]) => (values.length ? sum(values) / values.length : 0);

  const tailMean = mean(aheadSamples);
  const tail = round2(Math.max(0, tailMean - bookedAfterToday));
  const tailLow = round2(Math.max(0, Math.min(...aheadSamples) - bookedAfterToday));
  const tailHigh = round2(Math.max(0, Math.max(...aheadSamples) - bookedAfterToday));

  const unrecorded = round2(Math.max(0, mean(mtdSamples) - committedNonCredit));
  const unrecordedLow = round2(Math.max(0, Math.min(...mtdSamples) - committedNonCredit));
  const unrecordedHigh = round2(Math.max(0, Math.max(...mtdSamples) - committedNonCredit));

  // --- Card bills still to be recorded --------------------------------------
  // A card's monthly total is dominated by installments and recurring charges,
  // and it is imported as a lump when the bill closes — often days later. So
  // the honest estimate for "what this card will add to the month" is its own
  // recent monthly average, minus what is already stored. The purchase-rate
  // model this replaces was measured against real months and was 3-5x too low
  // at the start of a month, exactly when the report matters most.
  const openCards = input.cardWindows.filter(window => monthOf(window.dueDate) === month);
  const cardTotals = (cardBrand: string, pastMonth: string): number =>
    round2(
      sum(
        input.expenses
          .filter(
            row =>
              monthOf(row.effectiveDate) === pastMonth &&
              row.paymentType === 'credit' &&
              row.cardBrand === cardBrand
          )
          .map(row => row.value)
      )
    );

  const cardCommitted = (cardBrand: string): number =>
    round2(
      sum(
        monthRows
          .filter(row => row.paymentType === 'credit' && row.cardBrand === cardBrand)
          .map(row => row.value)
      )
    );

  const cardStats = openCards.map(window => {
    const samples = pastMonths.map(pastMonth => cardTotals(window.cardBrand, pastMonth));
    return {
      window,
      committed: cardCommitted(window.cardBrand),
      average: samples.length ? sum(samples) / samples.length : 0,
      minimum: samples.length ? Math.min(...samples) : 0,
      maximum: samples.length ? Math.max(...samples) : 0,
    };
  });

  // Never negative: a card already above its average adds nothing more.
  const remaining = (target: number, committed: number) => round2(Math.max(0, target - committed));

  const cards: CardProjection[] = cardStats.map(stat => ({
    cardBrand: stat.window.cardBrand,
    closingDate: stat.window.closingDate,
    dueDate: stat.window.dueDate,
    expectedAdditional: remaining(stat.average, stat.committed),
  }));

  const cardsExpected = round2(sum(cards.map(card => card.expectedAdditional)));
  const cardsLow = round2(sum(cardStats.map(stat => remaining(stat.minimum, stat.committed))));
  const cardsHigh = round2(sum(cardStats.map(stat => remaining(stat.maximum, stat.committed))));

  const expectedTotal = round2(unrecorded + tail + cardsExpected);
  const projected = round2(committed + expectedTotal);

  // --- Income ---------------------------------------------------------------
  const monthIncomes = input.incomes.filter(row => monthOf(row.date) === month);
  const recordedIncome = round2(sum(monthIncomes.map(row => row.value)));
  const hasSalary = monthIncomes.some(row => row.type === 'salary');
  // Months without any salary row are dropped: a zero would drag the median of
  // a 2-3 point sample to nonsense.
  const salarySamples = pastMonths
    .map(pastMonth =>
      sum(
        input.incomes
          .filter(row => monthOf(row.date) === pastMonth && row.type === 'salary')
          .map(row => row.value)
      )
    )
    .filter(value => value > 0);
  const salaryEstimate = hasSalary ? 0 : round2(median(salarySamples));
  const expectedIncome = round2(recordedIncome + salaryEstimate);

  // --- Savings goal ---------------------------------------------------------
  const projectedSavings = round2(expectedIncome - projected);
  const status: SavingsStatus =
    projectedSavings >= goal + margin ? 'ok' : projectedSavings >= goal ? 'atencao' : 'risco';
  // The card bills not imported yet are spend already contracted (installments,
  // recurring charges), not money free to spend. The tail is NOT subtracted:
  // it is the forecast of the very day-to-day spending this budget has to cover.
  const remainingBudget = round2(expectedIncome - goal - committed - unrecorded - cardsExpected);

  // --- Comparison with previous months --------------------------------------
  const history = pastMonths
    .map(pastMonth => {
      const rows = input.expenses.filter(row => monthOf(row.effectiveDate) === pastMonth);
      return {
        month: pastMonth,
        sameDayTotal: round2(
          sum(rows.filter(row => dayOf(row.effectiveDate) <= todayDay).map(row => row.value))
        ),
        finalTotal: round2(sum(rows.map(row => row.value))),
      };
    })
    .reverse();

  const finalByType = new Map<string, number[]>();
  for (const pastMonth of pastMonths) {
    const perType = new Map<string, number>();
    for (const row of input.expenses) {
      if (monthOf(row.effectiveDate) !== pastMonth) continue;
      perType.set(row.type, (perType.get(row.type) ?? 0) + row.value);
    }
    // Every month contributes a sample for every type seen anywhere, a zero
    // when the category had no spending — otherwise the "monthly average" of a
    // category used once would be divided by one instead of by the window.
    for (const type of new Set([
      ...perType.keys(),
      ...input.expenses.map(row => row.type),
    ])) {
      finalByType.set(type, [...(finalByType.get(type) ?? []), perType.get(type) ?? 0]);
    }
  }

  const currentByType = new Map<string, number>();
  for (const row of monthRows) {
    currentByType.set(row.type, (currentByType.get(row.type) ?? 0) + row.value);
  }

  const categories = [...new Set([...currentByType.keys(), ...finalByType.keys()])]
    .map(type => {
      const current = round2(currentByType.get(type) ?? 0);
      const samples = finalByType.get(type) ?? [];
      const avgFinal = round2(samples.length ? sum(samples) / samples.length : 0);
      return { type, current, avgFinal, delta: round2(current - avgFinal) };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    month,
    today,
    daysInMonth: daysTotal,
    daysRemaining,
    committed,
    expected: {
      /** Spend that should already be recorded by today but is not (import lag). */
      unrecorded,
      unrecordedLow,
      unrecordedHigh,
      tail,
      tailLow,
      tailHigh,
      cards: cardsExpected,
      cardsLow,
      cardsHigh,
      total: expectedTotal,
    },
    projected,
    projectedLow: round2(committed + unrecordedLow + tailLow + cardsLow),
    projectedHigh: round2(committed + unrecordedHigh + tailHigh + cardsHigh),
    cards,
    income: {
      recorded: recordedIncome,
      salaryEstimate,
      expected: expectedIncome,
      estimated: !hasSalary && salarySamples.length > 0,
    },
    savings: {
      goal,
      status,
      projected: projectedSavings,
      remainingBudget,
      dailyAllowance:
        daysRemaining > 0 ? round2(remainingBudget / daysRemaining) : null,
    },
    history,
    categories,
  };
}
