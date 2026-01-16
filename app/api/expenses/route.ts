import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../lib/mongodb';
import Expense from '../../../lib/models/Expense';

export async function GET() {
  try {
    await connectToDatabase();
    const expenses = await Expense.find({});
    return NextResponse.json(expenses);
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch expenses. ${error}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json();
    console.log(`request body: ${JSON.stringify(body)}`)
    const expense = new Expense(body);
    console.log(`expense: ${JSON.stringify(expense)}`)
    await expense.save();
    return NextResponse.json(expense, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Failed to create expense. ${error}` }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await connectToDatabase();
    
    // Extrai o ID da URL (ex: /api/expenses?id=123)
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required for deletion.' }, { status: 400 });
    }

    const deletedExpense = await Expense.findByIdAndDelete(id);

    if (!deletedExpense) {
      return NextResponse.json({ error: 'Expense not found.' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Expense deleted successfully.' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: `Failed to delete expense. ${error}` }, { status: 500 });
  }
}