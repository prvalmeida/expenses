import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';
import { validateExpensePair } from '../../../../lib/utils/categoryUtils';
import { updateExpense, deleteExpense } from '../../../../lib/services/expenseService';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await connectToDatabase();
    const expense = await Expense.findById(id);
    if (!expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
    }
    return NextResponse.json(expense);
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch expense. ${error}` }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name, value, type, subtype, paymentType, cardBrand, date, effectiveDate } = await request.json();

    if (!(await validateExpensePair(type, subtype))) {
      return NextResponse.json({ error: 'Categoria ou subcategoria inválida.' }, { status: 400 });
    }

    const updatedExpense = await updateExpense(id, {
      name, value, type, subtype, paymentType, cardBrand, date, effectiveDate,
    });

    if (!updatedExpense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 });

    return NextResponse.json(updatedExpense);
  } catch (error) {
    return NextResponse.json({ error: `Failed to update: ${error}` }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const allInstallments = searchParams.get('all') === 'true';

    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const result = await deleteExpense(id, { allInstallments });
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      message: result.scope === 'group' ? 'All installments deleted.' : 'Single expense deleted.',
    });
  } catch (error) {
    return NextResponse.json({ error: `Error: ${error}` }, { status: 500 });
  }
}