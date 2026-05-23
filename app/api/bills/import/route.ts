import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';
import { CardCycle } from '../../../../lib/models/CardCycle';
import { computeEffectiveDate } from '../../../../lib/utils/cycleUtils';
import { addMonthsClamped } from '../../../../lib/utils/dateUtils';
import { CardBrand, ConfirmedBillItem, NewBillMapping } from '@/types';
import { BillMapping } from '../../../../lib/models/BillMapping';

interface ImportBody {
  items: ConfirmedBillItem[];
  cardBrand: CardBrand;
  closingDate: string | null;
  dueDate: string | null;
  newMappings?: NewBillMapping[];
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { items, cardBrand, closingDate, dueDate, newMappings }: ImportBody = await request.json();

    if (!cardBrand || !items?.length) {
      return NextResponse.json(
        { error: 'cardBrand e items são obrigatórios' },
        { status: 400 }
      );
    }

    // 1. Persist user-confirmed classifications for future auto-classification
    if (newMappings?.length) {
      await Promise.all(
        newMappings.map(m =>
          BillMapping.updateOne(
            { description: m.description.toLowerCase().trim() },
            { $set: { type: m.type, subtype: m.subtype } },
            { upsert: true }
          )
        )
      );
    }

    // 2. Upsert CardCycle so computeEffectiveDate uses the bill's actual closing date
    if (closingDate && dueDate) {
      const [year, month] = closingDate.split('-').map(Number);
      await CardCycle.findOneAndUpdate(
        { cardBrand, month, year },
        { closingDate: new Date(closingDate), dueDate: new Date(dueDate) },
        { upsert: true, new: true }
      );
    }

    let imported = 0;
    let skipped = 0;

    for (const item of items) {
      // Skip items without a category — Expense schema requires type
      if (item.type === null) {
        skipped++;
        continue;
      }

      const isInstallment =
        item.installmentCurrent !== undefined &&
        item.installmentTotal !== undefined &&
        item.installmentTotal > 1;

      if (!isInstallment) {
        const effectiveDate = await computeEffectiveDate(item.date, cardBrand, 'credit');
        await Expense.create({
          name: item.description,
          value: item.value,
          type: item.type,
          subtype: item.subtype ?? undefined,
          paymentType: 'credit',
          cardBrand,
          date: item.date,
          effectiveDate,
          installment: 1,
          totalInstallments: 1,
          transactionId: crypto.randomUUID(),
        });
        imported++;
        continue;
      }

      // Parcelado: compute effectiveDate for installment 1, then offset per installment
      const effectiveDate1 = await computeEffectiveDate(item.date, cardBrand, 'credit');
      const transactionId = crypto.randomUUID();
      const total = item.installmentTotal!;

      for (let k = 1; k <= total; k++) {
        const date_k = k === 1
          ? item.date
          : addMonthsClamped(item.date, k - 1).toISOString().split('T')[0];

        const effectiveDateK =
          k === 1
            ? effectiveDate1
            : addMonthsClamped(effectiveDate1, k - 1).toISOString().split('T')[0];

        const exists = await Expense.findOne({
          name: item.description,
          value: item.value,
          date: date_k,
          cardBrand,
          installment: k,
          totalInstallments: total,
        });

        if (exists) {
          skipped++;
          continue;
        }

        await Expense.create({
          name: item.description,
          value: item.value,
          type: item.type,
          subtype: item.subtype ?? undefined,
          paymentType: 'credit',
          cardBrand,
          date: date_k,
          effectiveDate: effectiveDateK,
          installment: k,
          totalInstallments: total,
          transactionId,
        });
        imported++;
      }
    }

    return NextResponse.json({ imported, skipped }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao importar fatura: ${error}` }, { status: 500 });
  }
}
