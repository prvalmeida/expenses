import { NextResponse } from 'next/server';
import { seedCategories } from '../../../../lib/utils/categoryUtils';

export async function POST() {
  try {
    const { expense, income } = await seedCategories();
    return NextResponse.json({ seeded: true, expense, income });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao popular categorias: ${error}` }, { status: 500 });
  }
}
