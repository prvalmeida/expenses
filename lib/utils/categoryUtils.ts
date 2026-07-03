import { Category } from '../models/Category';
import Expense from '../models/Expense';
import Income from '../models/Income';
import { ProductMapping } from '../models/ProductMapping';
import { BillMapping } from '../models/BillMapping';
import { Store } from '../models/Store';

export type CategoryKind = 'expense' | 'income';

export interface CategoryData {
  kind: CategoryKind;
  name: string;
  subtypes: string[];
  order?: number;
}

const CACHE_TTL_MS = 5_000;

// NOTE: this cache is per-process. In a multi-instance/serverless deploy,
// invalidateCategoryCache() only clears the cache of the process that runs it;
// other instances self-heal within CACHE_TTL_MS. Do not treat it as a global
// invalidation guarantee.
let cache: { at: number; data: CategoryData[] } | null = null;

function toData(doc: { kind: CategoryKind; name: string; subtypes: string[]; order?: number }): CategoryData {
  return { kind: doc.kind, name: doc.name, subtypes: doc.subtypes ?? [], order: doc.order };
}

export async function getCategories(): Promise<CategoryData[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  const docs = await Category.find({}).sort({ order: 1, name: 1 }).lean<CategoryData[]>();
  const data = docs.map(toData);
  cache = { at: Date.now(), data };
  return data;
}

export function invalidateCategoryCache(): void {
  cache = null;
}

export async function getExpenseCategories(): Promise<CategoryData[]> {
  return (await getCategories()).filter(c => c.kind === 'expense');
}

export async function getIncomeCategories(): Promise<CategoryData[]> {
  return (await getCategories()).filter(c => c.kind === 'income');
}

export async function validateExpensePair(type: string, subtype?: string | null): Promise<boolean> {
  const cat = (await getExpenseCategories()).find(c => c.name === type);
  if (!cat) return false;
  if (!subtype) return true;
  return cat.subtypes.includes(subtype);
}

export async function validateIncomeType(type: string): Promise<boolean> {
  return (await getIncomeCategories()).some(c => c.name === type);
}

export async function countAssociatedForType(kind: CategoryKind, name: string): Promise<number> {
  if (kind === 'income') {
    return Income.countDocuments({ type: name });
  }
  const [expenses, products, bills, stores] = await Promise.all([
    Expense.countDocuments({ type: name }),
    ProductMapping.countDocuments({ type: name }),
    BillMapping.countDocuments({ type: name }),
    Store.countDocuments({ defaultType: name }),
  ]);
  return expenses + products + bills + stores;
}

export async function countAssociatedForSubtype(type: string, subtype: string): Promise<number> {
  const [expenses, products, bills] = await Promise.all([
    Expense.countDocuments({ type, subtype }),
    ProductMapping.countDocuments({ type, subtype }),
    BillMapping.countDocuments({ type, subtype }),
  ]);
  return expenses + products + bills;
}

export async function cascadeRenameExpenseType(oldName: string, newName: string): Promise<void> {
  await Promise.all([
    Expense.updateMany({ type: oldName }, { $set: { type: newName } }),
    ProductMapping.updateMany({ type: oldName }, { $set: { type: newName } }),
    BillMapping.updateMany({ type: oldName }, { $set: { type: newName } }),
    Store.updateMany({ defaultType: oldName }, { $set: { defaultType: newName } }),
  ]);
}

export async function cascadeRenameExpenseSubtype(type: string, oldSub: string, newSub: string): Promise<void> {
  await Promise.all([
    Expense.updateMany({ type, subtype: oldSub }, { $set: { subtype: newSub } }),
    ProductMapping.updateMany({ type, subtype: oldSub }, { $set: { subtype: newSub } }),
    BillMapping.updateMany({ type, subtype: oldSub }, { $set: { subtype: newSub } }),
  ]);
}

export async function cascadeRenameIncomeType(oldName: string, newName: string): Promise<void> {
  await Income.updateMany({ type: oldName }, { $set: { type: newName } });
}

// Merge an expense type into a different existing target category. Unlike a rename
// (where subtypes travel with the category doc), a merge must drop subtypes that
// don't exist on the target — otherwise the migrated records would be orphaned.
export async function cascadeReassignExpenseType(oldName: string, targetName: string): Promise<void> {
  const target = await Category.findOne({ kind: 'expense', name: targetName }).lean<{ subtypes: string[] } | null>();
  const validSubs = target?.subtypes ?? [];
  await Promise.all([
    Expense.updateMany({ type: oldName, subtype: { $in: validSubs } }, { $set: { type: targetName } }),
    Expense.updateMany({ type: oldName, subtype: { $nin: validSubs } }, { $set: { type: targetName }, $unset: { subtype: '' } }),
    ProductMapping.updateMany({ type: oldName, subtype: { $in: validSubs } }, { $set: { type: targetName } }),
    ProductMapping.updateMany({ type: oldName, subtype: { $nin: validSubs } }, { $set: { type: targetName }, $unset: { subtype: '' } }),
    BillMapping.updateMany({ type: oldName, subtype: { $in: validSubs } }, { $set: { type: targetName } }),
    BillMapping.updateMany({ type: oldName, subtype: { $nin: validSubs } }, { $set: { type: targetName }, $unset: { subtype: '' } }),
    Store.updateMany({ defaultType: oldName }, { $set: { defaultType: targetName } }),
  ]);
}
