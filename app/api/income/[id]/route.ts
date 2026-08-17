import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Income from '../../../../lib/models/Income';
import { validateIncomeType } from '../../../../lib/utils/categoryUtils';
import { updateIncome, deleteIncome } from '../../../../lib/services/incomeService';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await connectToDatabase();
    const income = await Income.findById(id);
    if (!income) {
      return NextResponse.json({ error: 'Income not found' }, { status: 404 });
    }
    return NextResponse.json(income);
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch income. ${error}` }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { name, value, type, date } = await request.json();

    if (!(await validateIncomeType(type))) {
      return NextResponse.json({ error: 'Tipo de receita inválido.' }, { status: 400 });
    }

    const updatedIncome = await updateIncome(id, { name, value, type, date });

    if (!updatedIncome) {
      return NextResponse.json({ error: 'Income not found' }, { status: 404 });
    }

    return NextResponse.json(updatedIncome);
  } catch (error) {
    return NextResponse.json({ error: `Failed to update: ${error}` }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const deletedIncome = await deleteIncome(id);

    if (!deletedIncome) {
      return NextResponse.json({ error: 'Income not found.' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Income deleted successfully.' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: `Failed to delete income. ${error}` }, { status: 500 });
  }
}
