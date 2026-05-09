import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';

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
    await connectToDatabase();
    const { name, value, type, subtype, paymentType, cardBrand, date, effectiveDate } = await request.json();

    const $set: Record<string, unknown> = { name, value, type, subtype, paymentType, date, effectiveDate };
    if (paymentType === 'credit') $set.cardBrand = cardBrand;

    const update = paymentType !== 'credit'
      ? { $set, $unset: { cardBrand: '', installment: '', totalInstallments: '' } }
      : { $set };

    const updatedExpense = await Expense.findByIdAndUpdate(
      id,
      update,
      { new: true }
    );

    if (!updatedExpense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 });

    return NextResponse.json(updatedExpense);
  } catch (error) {
    return NextResponse.json({ error: `Failed to update: ${error}` }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const deleteAllParts = searchParams.get('all') === 'true';

    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const expenseToDelete = await Expense.findById(id);
    if (!expenseToDelete) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (deleteAllParts && expenseToDelete.transactionId) {
      // Deleta TODAS as despesas com o mesmo transactionId
      await Expense.deleteMany({ transactionId: expenseToDelete.transactionId });
      return NextResponse.json({ message: 'All installments deleted.' });
    } else {
      // Deleta apenas a parcela específica
      await Expense.findByIdAndDelete(id);
      return NextResponse.json({ message: 'Single expense deleted.' });
    }
  } catch (error) {
    return NextResponse.json({ error: `Error: ${error}` }, { status: 500 });
  }
}