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
  monthForecast,
  shiftMonth,
  type CardWindow,
  type ForecastExpense,
  type ForecastIncome,
  type MonthForecast,
} from '../utils/forecast';
import { lastDayOfMonth, resolveForecastPeriod } from '../utils/reportDate';

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

  const { month, today } = resolveForecastPeriod(query);
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
  /** The full count/total — the lists below are capped for display. */
  counts: { expenses: number; incomes: number };
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

  const [expenseDocs, incomeDocs, pendingRows, anomalies, expenseSum, incomeSum] =
    await Promise.all([
      Expense.find({ _id: { $gt: after } }, EXPENSE_PROJECTION)
        .sort({ date: -1, _id: -1 })
        .limit(MAX_DIGEST_ROWS)
        .lean() as unknown as Promise<
        (ForecastExpense & {
          _id: Types.ObjectId;
          name: string;
          subtype?: string | null;
          totalInstallments?: number | null;
        })[]
      >,
      Income.find({ _id: { $gt: after } }, 'name value type date')
        .sort({ date: -1, _id: -1 })
        .limit(MAX_DIGEST_ROWS)
        .lean() as unknown as Promise<(ForecastIncome & { _id: Types.ObjectId; name: string })[]>,
      PluggyTransaction.find(
        { status: 'pending', direction: 'outflow' },
        'amount currencyCode amountInAccountCurrency'
      ).lean() as unknown as Promise<
        { amount: number; currencyCode: string; amountInAccountCurrency?: number }[]
      >,
      PluggyTransaction.countDocuments({ status: 'anomaly' }),
      // Totals come from the database, not from the capped list above: a busy
      // day would otherwise report a total smaller than the day's spending.
      Expense.aggregate([
        { $match: { _id: { $gt: after } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$value' } } },
      ]),
      Income.aggregate([
        { $match: { _id: { $gt: after } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$value' } } },
      ]),
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
    installment: doc.installment ?? null,
    totalInstallments: doc.totalInstallments ?? null,
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
    counts: {
      expenses: Number(expenseSum[0]?.count ?? 0),
      incomes: Number(incomeSum[0]?.count ?? 0),
    },
    expenses,
    incomes,
    totals: {
      expenses: round2(Math.abs(Number(expenseSum[0]?.total ?? 0))),
      incomes: round2(Math.abs(Number(incomeSum[0]?.total ?? 0))),
    },
    pending: { count: pendingRows.length, total: round2(pendingTotal) },
    anomalies,
  };
}

// Display cap for the "what came in" lists. The message shows at most 15 items
// anyway; this only bounds the payload.
const MAX_DIGEST_ROWS = 200;

const round2 = (value: number): number => Math.round(value * 100) / 100;
