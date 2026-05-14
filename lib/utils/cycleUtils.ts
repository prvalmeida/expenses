import { CardCycle } from '../models/CardCycle';
import { CardBrand } from '@/types';
import { addMonthsClamped } from './dateUtils';

export const DEFAULT_SETTINGS: Record<string, { closingDay: number; dueDay: number }> = {
  [CardBrand.MasterSantander]: { closingDay: 20, dueDay: 25 },
  [CardBrand.Visa]: { closingDay: 15, dueDay: 25 },
  [CardBrand.EloCaixa]: { closingDay: 15, dueDay: 25 },
};

export async function getCycle(
  cardBrand: string,
  month: number,
  year: number
): Promise<{ closingDate: string; dueDate: string }> {
  const specific = await CardCycle.findOne({ cardBrand, month, year });
  if (specific) {
    return {
      closingDate: new Date(specific.closingDate).toISOString().split('T')[0],
      dueDate: new Date(specific.dueDate).toISOString().split('T')[0],
    };
  }
  const defaults = DEFAULT_SETTINGS[cardBrand];
  if (!defaults) throw new Error(`Unknown cardBrand: ${cardBrand}`);
  return {
    closingDate: new Date(Date.UTC(year, month - 1, defaults.closingDay)).toISOString().split('T')[0],
    dueDate: new Date(Date.UTC(year, month - 1, defaults.dueDay)).toISOString().split('T')[0],
  };
}

export async function computeEffectiveDate(
  purchaseDate: string,
  cardBrand: string,
  paymentType: string,
): Promise<string> {
  if (paymentType !== 'credit' || !cardBrand || !purchaseDate) {
    return purchaseDate;
  }
  const [year, month] = purchaseDate.split('-').map(Number);
  const cycle = await getCycle(cardBrand, month, year);
  if (purchaseDate > cycle.closingDate) {
    const nextMonthDate = addMonthsClamped(purchaseDate, 1);
    const nextCycle = await getCycle(cardBrand, nextMonthDate.getUTCMonth() + 1, nextMonthDate.getUTCFullYear());
    return nextCycle.dueDate;
  }
  return cycle.dueDate;
}
