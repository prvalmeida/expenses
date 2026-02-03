import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Income from '../../../../lib/models/Income';

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
    await connectToDatabase();
    const body = await request.json();
    const { ...updateData } = body;

    const updatedIncome = await Income.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

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
    await connectToDatabase();

    const deletedIncome = await Income.findByIdAndDelete(id);

    if (!deletedIncome) {
      return NextResponse.json({ error: 'Income not found.' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Income deleted successfully.' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: `Failed to delete income. ${error}` }, { status: 500 });
  }
}