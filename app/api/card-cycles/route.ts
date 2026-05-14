import { NextResponse } from 'next/server';
import { CardCycle } from '../../../lib/models/CardCycle';
import Expense from '../../../lib/models/Expense';
import connectToDatabase from '../../../lib/mongodb';
import { DEFAULT_SETTINGS, computeEffectiveDate } from '../../../lib/utils/cycleUtils';

export async function GET(request: Request) {
  await connectToDatabase();
  const { searchParams } = new URL(request.url);
  const brand = searchParams.get('brand');
  const month = parseInt(searchParams.get('month') || '');
  const year = parseInt(searchParams.get('year') || '');

  // 1. Try to find specific config for this month/year
  const specificConfig = await CardCycle.findOne({ cardBrand: brand, month, year });

  if (specificConfig) {
    // Convert DB Date objects to simple YYYY-MM-DD strings before returning
    return NextResponse.json({
        ...specificConfig._doc, // spread the mongoose document data
        closingDate: new Date(specificConfig.closingDate).toISOString().split('T')[0],
        dueDate: new Date(specificConfig.dueDate).toISOString().split('T')[0],
        isDefault: false
    });
  }

  // 2. Fallback: Generate dates based on defaults
  const defaults = DEFAULT_SETTINGS[brand as string];
  if (!defaults) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

  // Create dates for the 15th (closing) and 25th (due) of that specific month
  const closingDate = new Date(Date.UTC(year, month - 1, defaults.closingDay));
  const dueDate = new Date(Date.UTC(year, month - 1, defaults.dueDay));

  return NextResponse.json({
    cardBrand: brand,
    month,
    year,
    closingDate: closingDate.toISOString().split('T')[0],
    dueDate: dueDate.toISOString().split('T')[0],
    isDefault: true // Helpful for the UI to show a "!" warning
  });
}

export async function POST(request: Request) {
  await connectToDatabase();
  const body = await request.json();
  const { cardBrand, month, year, closingDate, dueDate } = body;

  const config = await CardCycle.findOneAndUpdate(
    { cardBrand, month, year },
    { closingDate, dueDate },
    { upsert: true, new: true }
  );

  // Recalculate effectiveDate for all credit expenses of this card whose
  // purchase date falls in the cycle's month or the preceding month (purchases
  // after the closing date of the previous month land in this cycle).
  const monthStart = new Date(Date.UTC(year, month - 2, 1)).toISOString().split('T')[0];
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().split('T')[0];

  const affectedExpenses = await Expense.find({
    paymentType: 'credit',
    cardBrand,
    date: { $gte: monthStart, $lte: monthEnd },
  });

  const bulkOps: Parameters<typeof Expense.bulkWrite>[0] = [];
  for (const expense of affectedExpenses) {
    const newEffectiveDate = await computeEffectiveDate(expense.date, cardBrand, 'credit');
    if (newEffectiveDate !== expense.effectiveDate) {
      bulkOps.push({
        updateOne: {
          filter: { _id: expense._id },
          update: { $set: { effectiveDate: newEffectiveDate } },
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    await Expense.bulkWrite(bulkOps);
  }

  return NextResponse.json({ config, updatedExpenses: bulkOps.length });
}