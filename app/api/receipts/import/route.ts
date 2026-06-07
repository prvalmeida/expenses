import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';
import { ProductMapping } from '../../../../lib/models/ProductMapping';
import { Store } from '../../../../lib/models/Store';
import { computeEffectiveDate } from '../../../../lib/utils/cycleUtils';
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
  storeDefaultType?: string;
  installments?: number;
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { cnpj, address, date, paymentType, cardBrand, items, newMappings, storeDefaultType, installments: rawInstallments }: ImportBody = await request.json();
    const installmentCount = Math.max(1, Math.round(rawInstallments ?? 1));

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

    if (storeDefaultType) {
      await Store.updateOne(
        { cnpj, address: storeAddress },
        { $set: { defaultType: storeDefaultType } }
      );
    }

    const installDates: string[] = [];
    const effectiveDates: string[] = [];
    for (let i = 0; i < installmentCount; i++) {
      const d = addMonthsClamped(date, i);
      const dateStr = d.toISOString().substring(0, 10);
      installDates.push(dateStr);
      effectiveDates.push(await computeEffectiveDate(dateStr, cardBrand ?? '', paymentType));
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const expenses = items.flatMap(item => {
      const txId = crypto.randomUUID();
      const perValue = round2(item.value / installmentCount);
      return Array.from({ length: installmentCount }, (_, i) => ({
        name: item.description,
        value: perValue,
        type: item.type,
        subtype: item.subtype,
        paymentType,
        date: installDates[i],
        effectiveDate: effectiveDates[i],
        ...(item.qty !== undefined && { qty: item.qty }),
        ...(item.unit && { unit: item.unit }),
        ...(paymentType === 'credit' && {
          cardBrand,
          installment: i + 1,
          totalInstallments: installmentCount,
          transactionId: txId,
        }),
      }));
    });

    const created = await Expense.insertMany(expenses);

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao importar gastos: ${error}` }, { status: 500 });
  }
}
