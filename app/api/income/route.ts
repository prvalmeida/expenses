import { NextRequest, NextResponse } from 'next/server';
import { validateIncomeType } from '../../../lib/utils/categoryUtils';
import { listIncomes, createIncome } from '../../../lib/services/incomeService';

export async function GET() {
  try {
    // Unpaginated on purpose: the Dashboard totals the whole list client-side.
    const { items } = await listIncomes();
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch incomes. ${error}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, value, type, date } = await request.json();

    if (!(await validateIncomeType(type))) {
      return NextResponse.json({ error: 'Tipo de receita inválido.' }, { status: 400 });
    }

    const income = await createIncome({ name, value, type, date });
    return NextResponse.json(income, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Failed to create income. ${error}` }, { status: 500 });
  }
}
