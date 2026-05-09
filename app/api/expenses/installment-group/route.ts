import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';
import { addMonthsClamped } from '../../../../lib/utils/dateUtils';
import { getCycle } from '../../../../lib/utils/cycleUtils';

export async function PUT(request: NextRequest) {
  try {
    await connectToDatabase();
    const {
      transactionId,
      totalValue,
      installmentCount,
      originalDate,
      name,
      type,
      subtype,
      paymentType,
      cardBrand,
    } = await request.json();

    if (!transactionId || !totalValue || !installmentCount || !originalDate) {
      return NextResponse.json(
        { error: 'transactionId, totalValue, installmentCount e originalDate são obrigatórios' },
        { status: 400 }
      );
    }

    const current = await Expense.find({ transactionId }).sort({ installment: 1 });
    if (current.length === 0) {
      return NextResponse.json({ error: 'Grupo de parcelas não encontrado' }, { status: 404 });
    }

    const perValue = Math.round((totalValue / installmentCount) * 100) / 100;

    // Compute target state for every installment in the new count
    const targets: {
      date: string;
      effectiveDate: string;
      value: number;
      installment: number;
      totalInstallments: number;
      name: string;
      type: string;
      subtype?: string;
      paymentType: string;
      cardBrand?: string;
      transactionId: string;
    }[] = [];

    for (let i = 1; i <= installmentCount; i++) {
      const purchaseDate = addMonthsClamped(originalDate, i - 1);
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

      targets.push({
        date: dateString,
        effectiveDate: effectiveDateString,
        value: perValue,
        installment: i,
        totalInstallments: installmentCount,
        name,
        type,
        subtype,
        paymentType,
        cardBrand,
        transactionId,
      });
    }

    // Remove excess installments when reducing count
    if (installmentCount < current.length) {
      await Expense.deleteMany({ transactionId, installment: { $gt: installmentCount } });
    }

    // Update existing records
    const updateCount = Math.min(installmentCount, current.length);
    const updatedDocs = await Promise.all(
      Array.from({ length: updateCount }, (_, i) =>
        Expense.findByIdAndUpdate(current[i]._id, { $set: targets[i] }, { new: true })
      )
    );

    // Insert new records when increasing count
    const insertedDocs =
      installmentCount > current.length
        ? await Expense.insertMany(targets.slice(current.length))
        : [];

    const allDocs = [...updatedDocs, ...insertedDocs].sort(
      (a, b) => (a.installment ?? 0) - (b.installment ?? 0)
    );

    return NextResponse.json(allDocs);
  } catch (error) {
    return NextResponse.json({ error: `Falha ao atualizar parcelas: ${error}` }, { status: 500 });
  }
}
