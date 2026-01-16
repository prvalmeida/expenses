import { NextResponse } from 'next/server';
import { CardCycle } from '../../../lib/models/CardCycle';
import { CardBrand } from '@/types';

// Default settings if no specific month is configured
const DEFAULT_SETTINGS: Record<string, { closingDay: number; dueDay: number }> = {
  [CardBrand.MasterSantander]: { closingDay: 20, dueDay: 25 },
  [CardBrand.Visa]: { closingDay: 15, dueDay: 25 },
  [CardBrand.EloCaixa]: { closingDay: 15, dueDay: 25 },
};

export async function GET(request: Request) {
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
  const body = await request.json();
  const { cardBrand, month, year, closingDate, dueDate } = body;

  // Update or Create (Upsert)
  const config = await CardCycle.findOneAndUpdate(
    { cardBrand, month, year },
    { closingDate, dueDate },
    { upsert: true, new: true }
  );

  return NextResponse.json(config);
}