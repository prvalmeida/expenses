import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../lib/mongodb';
import Income from '../../../lib/models/Income';

export async function GET() {
  try {
    await connectToDatabase();
    const incomes = await Income.find({});
    return NextResponse.json(incomes);
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch incomes. ${error}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json();
    console.log(`income request body: ${JSON.stringify(body)}`)
    const income = new Income(body);
    console.log(`income: ${JSON.stringify(income)}`)
    await income.save();
    return NextResponse.json(income, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Failed to create income. ${error}` }, { status: 500 });
  }
}