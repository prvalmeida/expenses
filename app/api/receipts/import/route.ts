import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';
import { ProductMapping } from '../../../../lib/models/ProductMapping';
import { getCycle } from '../../../../lib/utils/cycleUtils';
import { addMonthsClamped } from '../../../../lib/utils/dateUtils';
import { ConfirmedReceiptItem } from '@/types';

interface ImportBody {
  cnpj: string;
  address?: string;
  date: string;
  paymentType: string;
  cardBrand?: string;
  items: ConfirmedReceiptItem[];
  newMappings: ConfirmedReceiptItem[];
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { cnpj, address, date, paymentType, cardBrand, items, newMappings }: ImportBody = await request.json();

    if (!cnpj || !date || !paymentType || !items?.length) {
      return NextResponse.json(
        { error: 'cnpj, date, paymentType e items são obrigatórios' },
        { status: 400 }
      );
    }

    const storeAddress = address ?? null;

    if (newMappings?.length) {
      await Promise.all(
        newMappings.map(item =>
          ProductMapping.updateOne(
            { cnpj, address: storeAddress, description: item.description.toLowerCase().trim() },
            { $set: { type: item.type, subtype: item.subtype } },
            { upsert: true }
          )
        )
      );
    }

    let effectiveDate = date;
    if (paymentType === 'credit' && cardBrand) {
      const [year, month] = date.split('-').map(Number);
      const cycle = await getCycle(cardBrand, month, year);
      if (date > cycle.closingDate) {
        const nextMonthDate = addMonthsClamped(date, 1);
        const nextCycle = await getCycle(cardBrand, nextMonthDate.getUTCMonth() + 1, nextMonthDate.getUTCFullYear());
        effectiveDate = nextCycle.dueDate;
      } else {
        effectiveDate = cycle.dueDate;
      }
    }

    const expenses = items.map(item => ({
      name: item.description,
      value: item.value,
      type: item.type,
      subtype: item.subtype,
      paymentType,
      date,
      effectiveDate,
      ...(item.qty !== undefined && { qty: item.qty }),
      ...(item.unit && { unit: item.unit }),
      ...(paymentType === 'credit' && {
        cardBrand,
        installment: 1,
        totalInstallments: 1,
        transactionId: crypto.randomUUID(),
      }),
    }));

    const created = await Expense.insertMany(expenses);

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao importar gastos: ${error}` }, { status: 500 });
  }
}
