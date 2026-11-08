import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysInMonth,
  median,
  monthForecast,
  shiftMonth,
  type ForecastExpense,
  type ForecastInput,
} from '../lib/utils/forecast';

const expense = (over: Partial<ForecastExpense> & Pick<ForecastExpense, 'value' | 'date'>): ForecastExpense => ({
  effectiveDate: over.date,
  paymentType: 'pix',
  type: 'mercado',
  ...over,
});

const base = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  month: '2026-11',
  today: '2026-11-10',
  expenses: [],
  incomes: [],
  cardWindows: [],
  ...over,
});

const visa = { cardBrand: 'Visa Caixa', closingDate: '2026-11-15', dueDate: '2026-11-25' };

test('month helpers cross year boundaries and clamp to the real month length', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-03', -13), '2025-02');
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-11'), 30);
  assert.equal(median([8000, 10000]), 9000);
  assert.equal(median([1, 2, 100]), 2);
  assert.equal(median([]), 0);
});

test('committed counts every stored expense whose effectiveDate is in the month', () => {
  const forecast = monthForecast(
    base({
      expenses: [
        // Bought in October, on the November bill: belongs to November.
        expense({ value: 300, date: '2026-10-20', effectiveDate: '2026-11-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 100, date: '2026-11-05' }),
        // Previous month's own spending.
        expense({ value: 50, date: '2026-10-05' }),
      ],
    })
  );

  assert.equal(forecast.committed, 400);
  assert.equal(forecast.daysInMonth, 30);
  assert.equal(forecast.daysRemaining, 20);
});

test('the tail is the history mean after today, net of what is already booked', () => {
  const expenses = [
    // History: 200 on day 20 of October, 100 on day 28 of September, nothing in August.
    expense({ value: 200, date: '2026-10-20' }),
    expense({ value: 100, date: '2026-09-28' }),
    // Already stored for after today in the current month.
    expense({ value: 60, date: '2026-11-30' }),
  ];

  const withoutBooked = monthForecast(base({ expenses: expenses.slice(0, 2) }));
  assert.equal(withoutBooked.expected.tail, 100);
  assert.equal(withoutBooked.expected.tailLow, 0);
  assert.equal(withoutBooked.expected.tailHigh, 200);

  const withBooked = monthForecast(base({ expenses }));
  assert.equal(withBooked.expected.tail, 40);
  assert.equal(withBooked.expected.tailLow, 0);
  assert.equal(withBooked.expected.tailHigh, 140);
});

test('the tail never goes negative and the last day of the month yields zero', () => {
  const forecast = monthForecast(
    base({
      today: '2026-11-30',
      expenses: [
        expense({ value: 500, date: '2026-10-25' }),
        expense({ value: 300, date: '2026-11-20' }),
      ],
    })
  );

  assert.equal(forecast.daysRemaining, 0);
  assert.equal(forecast.expected.tail, 0);
  assert.equal(forecast.expected.tailLow, 0);
  assert.equal(forecast.expected.tailHigh, 0);
  assert.equal(forecast.savings.dailyAllowance, null);
});

test('a 31-day history month does not break the tail when today is the 30th', () => {
  const forecast = monthForecast(
    base({
      month: '2026-04',
      today: '2026-04-30',
      historyMonths: 2,
      expenses: [expense({ value: 90, date: '2026-03-31' })],
    })
  );

  // March's day-31 spend is part of the sample, February has none: (90 + 0) / 2.
  assert.equal(forecast.expected.tail, 45);
  assert.equal(forecast.committed, 0);
});

test('a card below its recent monthly average is topped up to it', () => {
  const forecast = monthForecast(
    base({
      cardWindows: [visa],
      expenses: [
        // This card's last three months: 500, 1500, 1000 — average 1000.
        expense({ value: 500, date: '2026-08-01', effectiveDate: '2026-08-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 1500, date: '2026-09-01', effectiveDate: '2026-09-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 1000, date: '2026-10-01', effectiveDate: '2026-10-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        // November's bill is only partly imported so far.
        expense({ value: 400, date: '2026-11-02', effectiveDate: '2026-11-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
      ],
    })
  );

  const card = forecast.cards.find(entry => entry.cardBrand === 'Visa Caixa');
  assert.ok(card);
  assert.equal(card.expectedAdditional, 600);
  assert.equal(forecast.expected.cards, 600);
  // The range follows the card's own minimum and maximum bill.
  assert.equal(forecast.expected.cardsLow, 100);
  assert.equal(forecast.expected.cardsHigh, 1100);
  // Only the November bill is counted; the earlier months are history.
  assert.equal(forecast.committed, 400);
  assert.equal(forecast.projected, 1000);
  assert.equal(forecast.projectedLow, 500);
  assert.equal(forecast.projectedHigh, 1500);
});

test('a card already above its average adds nothing, and a card with no history adds nothing', () => {
  const forecast = monthForecast(
    base({
      cardWindows: [visa],
      expenses: [
        expense({ value: 200, date: '2026-09-01', effectiveDate: '2026-09-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 200, date: '2026-10-01', effectiveDate: '2026-10-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 200, date: '2026-11-01', effectiveDate: '2026-11-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 900, date: '2026-11-02', effectiveDate: '2026-11-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
      ],
    })
  );
  assert.equal(forecast.cards[0].expectedAdditional, 0);
  assert.equal(forecast.projected, forecast.committed);

  const noHistory = monthForecast(
    base({
      cardWindows: [visa],
      expenses: [expense({ value: 300, date: '2026-11-02', effectiveDate: '2026-11-25', paymentType: 'credit', cardBrand: 'Visa Caixa' })],
    })
  );
  assert.equal(noHistory.cards[0].expectedAdditional, 0);
});

test('spend that should already be on the books is counted, not treated as saved', () => {
  const forecast = monthForecast(
    base({
      today: '2026-11-10',
      expenses: [
        // A 5000 bill paid by pix on day 5, every month...
        expense({ value: 5000, date: '2026-08-05' }),
        expense({ value: 5000, date: '2026-09-05' }),
        expense({ value: 5000, date: '2026-10-05' }),
        // ...and this month only a small purchase so far, the rent not imported yet.
        expense({ value: 300, date: '2026-11-09' }),
      ],
    })
  );

  assert.equal(forecast.committed, 300);
  assert.equal(forecast.expected.unrecorded, 4700);
  assert.equal(forecast.expected.tail, 0);
  assert.equal(forecast.projected, 5000);
  assert.equal(forecast.projectedLow, 5000);
  assert.equal(forecast.projectedHigh, 5000);
});

test('a card whose bill is not due this month is not projected', () => {
  const forecast = monthForecast(
    base({
      cardWindows: [
        visa,
        { cardBrand: 'Elo Caixa', closingDate: '2026-10-15', dueDate: '2026-10-25' },
      ],
      expenses: [
        expense({ value: 300, date: '2026-10-01', effectiveDate: '2026-10-25', paymentType: 'credit', cardBrand: 'Elo Caixa' }),
      ],
    })
  );

  assert.deepEqual(
    forecast.cards.map(card => card.cardBrand),
    ['Visa Caixa']
  );
  assert.equal(forecast.expected.cards, 0);
});

test('a missing salary is estimated from the history median, a present one is not', () => {
  const incomes = [
    { value: 10000, date: '2026-10-23', type: 'salary' },
    { value: 8000, date: '2026-09-25', type: 'salary' },
    { value: 300, date: '2026-11-06', type: 'other' },
  ];

  const estimated = monthForecast(base({ incomes }));
  assert.equal(estimated.income.recorded, 300);
  assert.equal(estimated.income.salaryEstimate, 9000);
  assert.equal(estimated.income.expected, 9300);
  assert.equal(estimated.income.estimated, true);

  const paid = monthForecast(
    base({ incomes: [...incomes, { value: 12000, date: '2026-11-05', type: 'salary' }] })
  );
  assert.equal(paid.income.salaryEstimate, 0);
  assert.equal(paid.income.expected, 12300);
  assert.equal(paid.income.estimated, false);
});

test('savings status uses the goal plus the alert margin', () => {
  const withIncome = (value: number) =>
    monthForecast(base({ incomes: [{ value, date: '2026-11-10', type: 'other' }] }));

  assert.equal(withIncome(2000).savings.status, 'ok');
  assert.equal(withIncome(1500).savings.status, 'atencao');
  assert.equal(withIncome(1499.99).savings.status, 'risco');
  assert.equal(withIncome(-100).savings.status, 'risco');
});

test('with no card history, remaining budget and daily allowance come from committed spend', () => {
  const forecast = monthForecast(
    base({
      incomes: [{ value: 5000, date: '2026-11-01', type: 'other' }],
      expenses: [expense({ value: 500, date: '2026-11-05' })],
    })
  );

  assert.equal(forecast.savings.remainingBudget, 3000);
  assert.equal(forecast.savings.dailyAllowance, 150);
  assert.equal(forecast.savings.projected, 4500);
});

test('history reports same-day and final totals, categories the biggest movers', () => {
  const forecast = monthForecast(
    base({
      expenses: [
        // November so far.
        expense({ value: 400, date: '2026-11-05', type: 'mercado' }),
        expense({ value: 100, date: '2026-11-08', type: 'lazer' }),
        // October: 300 before day 10, 600 in total.
        expense({ value: 300, date: '2026-10-03', type: 'mercado' }),
        expense({ value: 300, date: '2026-10-20', type: 'mercado' }),
        // September: 200 total, all after day 10.
        expense({ value: 200, date: '2026-09-28', type: 'mercado' }),
      ],
    })
  );

  assert.deepEqual(
    forecast.history.map(entry => entry.month),
    ['2026-08', '2026-09', '2026-10']
  );
  assert.deepEqual(forecast.history[0], { month: '2026-08', sameDayTotal: 0, finalTotal: 0 });
  assert.deepEqual(forecast.history[1], { month: '2026-09', sameDayTotal: 0, finalTotal: 200 });
  assert.deepEqual(forecast.history[2], { month: '2026-10', sameDayTotal: 300, finalTotal: 600 });

  const mercado = forecast.categories.find(entry => entry.type === 'mercado');
  assert.ok(mercado);
  // Current 400 vs the average final of (0 + 200 + 600) / 3 = 266.67.
  assert.equal(mercado.current, 400);
  assert.equal(mercado.avgFinal, 266.67);
  assert.equal(mercado.delta, 133.33);
  assert.equal(forecast.categories[0].type, 'mercado');
  assert.equal(forecast.categories.at(-1)?.type, 'lazer');
});

test('remaining budget subtracts the card bills still to be imported, not the tail', () => {
  const forecast = monthForecast(
    base({
      cardWindows: [visa],
      incomes: [{ value: 10000, date: '2026-11-01', type: 'other' }],
      expenses: [
        // Visa's last three bills average 1000; November has 400 imported so far.
        expense({ value: 500, date: '2026-08-01', effectiveDate: '2026-08-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 1500, date: '2026-09-01', effectiveDate: '2026-09-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 1000, date: '2026-10-01', effectiveDate: '2026-10-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        expense({ value: 400, date: '2026-11-02', effectiveDate: '2026-11-25', paymentType: 'credit', cardBrand: 'Visa Caixa' }),
        // Day-to-day pix spending after day 10 in past months: this is the tail.
        expense({ value: 300, date: '2026-08-20' }),
        expense({ value: 300, date: '2026-09-20' }),
        expense({ value: 300, date: '2026-10-20' }),
      ],
    })
  );

  assert.equal(forecast.expected.cards, 600);
  assert.ok(forecast.expected.tail > 0);
  // 10000 income − 1500 goal − 400 committed − 600 bill still to land.
  assert.equal(forecast.savings.remainingBudget, 7500);
  assert.equal(forecast.savings.dailyAllowance, 375);
});
