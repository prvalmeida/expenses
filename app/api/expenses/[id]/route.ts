import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await connectToDatabase();
    const expense = await Expense.findById(params.id);
    if (!expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
    }
    return NextResponse.json(expense);
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch expense. ${error}` }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json();
    const { _id, ...updateData } = body;

    if (!_id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const updatedExpense = await Expense.findByIdAndUpdate(
      _id,
      updateData,
      { new: true, runValidators: true }
    );

    return NextResponse.json(updatedExpense);
  } catch (error) {
    return NextResponse.json({ error: `Failed to update: ${error}` }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
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