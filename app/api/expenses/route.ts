import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../lib/mongodb';
import Expense from '../../../lib/models/Expense';
import { createExpenseSchema } from '../../../lib/api/schemas/expense';
import { createExpenses } from '../../../lib/services/expenseService';
import { validateExpensePair } from '../../../lib/utils/categoryUtils';

export async function GET() {
  try {
    await connectToDatabase();
    const expenses = await Expense.find({});
    return NextResponse.json(expenses);
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch expenses. ${error}` }, { status: 500 });
  }
}

// Accepts one logical purchase and expands the installments server-side. It used
// to be a raw `new Expense(body)` passthrough with no field whitelist, which is
// why the form screen had to build every installment itself — and re-derive the
// card cycle to do it.
export async function POST(request: NextRequest) {
  try {
    const parsed = createExpenseSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 }
      );
    }

    if (!(await validateExpensePair(parsed.data.type, parsed.data.subtype))) {
      return NextResponse.json({ error: 'Categoria ou subcategoria inválida.' }, { status: 400 });
    }

    const expenses = await createExpenses(parsed.data);
    return NextResponse.json(expenses, { status: 201 });
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
