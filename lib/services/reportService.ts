import { Types } from 'mongoose';
import connectToDatabase from '../mongodb';
import Expense from '../models/Expense';
import Income from '../models/Income';
import { PluggyTransaction } from '../models/PluggyTransaction';
import { CardBrand } from '@/types';
import { accountAmount } from '../utils/pluggyUtils';
import { getCycle } from '../utils/cycleUtils';
import {
  DEFAULT_HISTORY_MONTHS,
  DEFAULT_ALERT_MARGIN,
  DEFAULT_SAVINGS_GOAL,
  daysInMonth,
  monthForecast,
  shiftMonth,
  type CardWindow,
  type ForecastExpense,
  type ForecastIncome,
  type MonthForecast,
} from '../utils/forecast';

// The app is used from Brasília, the server runs in UTC. `todayLocal()`
// (monthUtils) reads the process clock, so at 21:00 BRT it would already be
// tomorrow — enough to move a report into the next month.
export const REPORT_TIME_ZONE = 'America/Sao_Paulo';

export function todayInReportTimeZone(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Last calendar day of `YYYY-MM`. */
export function lastDayOfMonth(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

export interface MonthForecastQuery {
  month?: string;
  today?: string;
  savingsGoal?: number;
  alertMargin?: number;
  historyMonths?: number;
  /** Backtest only: ignore rows created after this instant (see getMonthForecast). */
  createdBefore?: string;
}

const EXPENSE_PROJECTION = 'name value type subtype date effectiveDate paymentType cardBrand installment totalInstallments';

export async function getMonthForecast(query: MonthForecastQuery = {}): Promise<MonthForecast> {
  await connectToDatabase();

  const currentMonth = todayInReportTimeZone().slice(0, 7);
  const month = query.month ?? currentMonth;
  // Reporting a month other than this one only makes sense from its last day:
  // that is what the weekly job does on the first days of a month.
  const today = query.today ?? (month === currentMonth ? todayInReportTimeZone() : lastDayOfMonth(month));
  const historyMonths = query.historyMonths ?? DEFAULT_HISTORY_MONTHS;

  const windowStart = `${shiftMonth(month, -historyMonths)}-01`;
  const windowEnd = lastDayOfMonth(month);

  // The current month is read as "what we know so far": in a backtest, rows
  // stored after the simulated day are ignored. The history months are read in
  // full on purpose — they are the teacher. Filtering them too would teach the
  // model exactly the lag that makes an early-month forecast too low (a
  // September bill imported on October 3rd is still real September spending).
  const createdBeforeFilter = query.createdBefore
    ? { _id: { $lte: Types.ObjectId.createFromTime(Math.floor(Date.parse(query.createdBefore) / 1000)) } }
    : {};
  const monthStart = `${month}-01`;

  const [historyExpenses, currentExpenses, historyIncomes, currentIncomes, cards] =
    await Promise.all([
      Expense.find(
        { effectiveDate: { $gte: windowStart, $lt: monthStart } },
        EXPENSE_PROJECTION
      ).lean<ForecastExpense[]>(),
      Expense.find(
        { effectiveDate: { $gte: monthStart, $lte: windowEnd }, ...createdBeforeFilter },
        EXPENSE_PROJECTION
      ).lean<ForecastExpense[]>(),
      Income.find({ date: { $gte: windowStart, $lt: monthStart } }, 'value date type').lean<
        ForecastIncome[]
      >(),
      Income.find(
        { date: { $gte: monthStart, $lte: windowEnd }, ...createdBeforeFilter },
        'value date type'
      ).lean<ForecastIncome[]>(),
      cardWindowsFor(month),
    ]);

  return monthForecast({
    month,
    today,
    expenses: [...historyExpenses, ...currentExpenses],
    incomes: [...historyIncomes, ...currentIncomes],
    cardWindows: cards,
    historyMonths,
    savingsGoal: query.savingsGoal ?? savingsGoalFromEnv(),
    alertMargin: query.alertMargin ?? alertMarginFromEnv(),
  });
}

function savingsGoalFromEnv(): number {
  const parsed = Number(process.env.SAVINGS_GOAL);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SAVINGS_GOAL;
}

function alertMarginFromEnv(): number {
  const parsed = Number(process.env.SAVINGS_ALERT_MARGIN);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_ALERT_MARGIN;
}

// Every card's cycle for the month, so the forecast can tell which bills are
// still open. getCycle falls back to DEFAULT_SETTINGS when no CardCycle row was
// imported for that month.
async function cardWindowsFor(month: string): Promise<CardWindow[]> {
  const [year, monthNumber] = month.split('-').map(Number);
  const windows = await Promise.all(
    Object.values(CardBrand).map(async (cardBrand): Promise<CardWindow | null> => {
      try {
        const { closingDate, dueDate } = await getCycle(cardBrand, monthNumber, year);
        return { cardBrand, closingDate, dueDate };
      } catch {
        return null;
      }
    })
  );
  return windows.filter((window): window is CardWindow => window !== null);
}

export interface DigestExpense {
  id: string;
  name: string;
  value: number;
  type: string;
  subtype?: string | null;
  date: string;
  effectiveDate: string;
  paymentType: string;
  cardBrand?: string | null;
  installment?: number | null;
  totalInstallments?: number | null;
}

export interface DigestIncome {
  id: string;
  name: string;
  value: number;
  type: string;
  date: string;
}

export interface DailyDigest {
  since: string;
  expenses: DigestExpense[];
  incomes: DigestIncome[];
  totals: { expenses: number; incomes: number };
  // Rows the sync staged but could not auto-import. Not part of the weekly
  // analysis — this is the "go review these" heads-up.
  pending: { count: number; total: number };
  anomalies: number;
}

// "New" is decided by the record's own creation time (the ObjectId timestamp),
// not by which sync run imported it: the Easypanel cron, the manual button and
// this job all write the same collection.
export async function getDailyDigest({ since }: { since: Date }): Promise<DailyDigest> {
  await connectToDatabase();

  const after = Types.ObjectId.createFromTime(Math.floor(since.getTime() / 1000));

  const [expenseDocs, incomeDocs, pendingRows, anomalies] = await Promise.all([
    Expense.find({ _id: { $gt: after } }, EXPENSE_PROJECTION)
      .sort({ date: -1, _id: -1 })
      .limit(200)
      .lean() as unknown as Promise<
      (ForecastExpense & { _id: Types.ObjectId; name: string; subtype?: string | null })[]
    >,
    Income.find({ _id: { $gt: after } }, 'name value type date')
      .sort({ date: -1, _id: -1 })
      .limit(200)
      .lean() as unknown as Promise<(ForecastIncome & { _id: Types.ObjectId; name: string })[]>,
    PluggyTransaction.find(
      { status: 'pending', direction: 'outflow' },
      'amount currencyCode amountInAccountCurrency'
    ).lean() as unknown as Promise<
      { amount: number; currencyCode: string; amountInAccountCurrency?: number }[]
    >,
    PluggyTransaction.countDocuments({ status: 'anomaly' }),
  ]);

  const expenses: DigestExpense[] = expenseDocs.map(doc => ({
    id: String(doc._id),
    name: doc.name,
    value: Math.abs(doc.value),
    type: doc.type,
    subtype: doc.subtype ?? null,
    date: doc.date,
    effectiveDate: doc.effectiveDate,
    paymentType: doc.paymentType,
    cardBrand: doc.cardBrand ?? null,
  }));

  const incomes: DigestIncome[] = incomeDocs.map(doc => ({
    id: String(doc._id),
    name: doc.name,
    value: Math.abs(doc.value),
    type: doc.type,
    date: doc.date,
  }));

  // The staged row's own amount may be in the merchant's currency; the BRL
  // charge is what accountAmount returns.
  const pendingTotal = pendingRows.reduce(
    (total, row) => total + Math.abs(accountAmount(row).amount),
    0
  );

  return {
    since: since.toISOString(),
    expenses,
    incomes,
    totals: {
      expenses: round2(expenses.reduce((total, row) => total + row.value, 0)),
      incomes: round2(incomes.reduce((total, row) => total + row.value, 0)),
    },
    pending: { count: pendingRows.length, total: round2(pendingTotal) },
    anomalies,
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
