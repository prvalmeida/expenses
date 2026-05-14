import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';
import { addMonthsClamped } from '../../../../lib/utils/dateUtils';
import { getCycle } from '../../../../lib/utils/cycleUtils';

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { transactionId, cardBrand, originalDate } = await request.json();

    if (!transactionId || !cardBrand || !originalDate) {
      return NextResponse.json(
        { error: 'transactionId, cardBrand e originalDate são obrigatórios' },
        { status: 400 }
      );
    }

    const installments = await Expense.find({ transactionId }).sort({ installment: 1 });

    if (installments.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma parcela encontrada para este transactionId' },
        { status: 404 }
      );
    }

    const corrections: { id: string; date: string; effectiveDate: string }[] = [];

    for (let i = 0; i < installments.length; i++) {
      const purchaseDate = addMonthsClamped(originalDate, i);
      const dateString = purchaseDate.toISOString().split('T')[0];
      const month = purchaseDate.getUTCMonth() + 1;
      const year = purchaseDate.getUTCFullYear();
      const cycle = await getCycle(cardBrand, month, year);

      let effectiveDateString: string;
      if (dateString > cycle.closingDate) {
        const nextMonthDate = addMonthsClamped(dateString, 1);
        const nextCycle = await getCycle(
          cardBrand,
          nextMonthDate.getUTCMonth() + 1,
          nextMonthDate.getUTCFullYear()
        );
        effectiveDateString = nextCycle.dueDate;
      } else {
        effectiveDateString = cycle.dueDate;
      }

      corrections.push({ id: String(installments[i]._id), date: dateString, effectiveDate: effectiveDateString });
    }

    await Promise.all(
      corrections.map(({ id, date, effectiveDate }) =>
        Expense.findByIdAndUpdate(id, { $set: { date, effectiveDate } })
      )
    );

    return NextResponse.json({ fixed: corrections.length, corrections });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao corrigir parcelas: ${error}` }, { status: 500 });
  }
}
