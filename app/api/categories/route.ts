import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../lib/mongodb';
import { Category } from '../../../lib/models/Category';
import {
  cascadeReassignExpenseType,
  cascadeRenameExpenseSubtype,
  cascadeRenameExpenseType,
  cascadeRenameIncomeType,
  countAssociatedForSubtype,
  countAssociatedForType,
  invalidateCategoryCache,
  type CategoryKind,
} from '../../../lib/utils/categoryUtils';

function isKind(value: unknown): value is CategoryKind {
  return value === 'expense' || value === 'income';
}

export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const kind = request.nextUrl.searchParams.get('kind');
    const filter = isKind(kind) ? { kind } : {};
    const categories = await Category.find(filter).sort({ order: 1, name: 1 });
    return NextResponse.json(categories);
  } catch (error) {
    return NextResponse.json({ error: `Falha ao buscar categorias: ${error}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json();
    const { kind, name, subtype } = body as { kind?: string; name?: string; subtype?: string };

    if (!isKind(kind) || !name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'kind e name são obrigatórios' }, { status: 400 });
    }
    const trimmedName = name.trim();

    if (subtype !== undefined) {
      if (kind !== 'expense') {
        return NextResponse.json({ error: 'Somente categorias de gasto possuem subtipos' }, { status: 400 });
      }
      if (!subtype.trim()) {
        return NextResponse.json({ error: 'subtype inválido' }, { status: 400 });
      }
      const updated = await Category.findOneAndUpdate(
        { kind, name: trimmedName },
        { $addToSet: { subtypes: subtype.trim() } },
        { new: true }
      );
      if (!updated) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 });
      invalidateCategoryCache();
      return NextResponse.json(updated);
    }

    const existing = await Category.findOne({ kind, name: trimmedName });
    if (existing) return NextResponse.json({ error: 'Categoria já existe' }, { status: 409 });

    const created = await Category.create({ kind, name: trimmedName, subtypes: [] });
    invalidateCategoryCache();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao criar categoria: ${error}` }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await connectToDatabase();
    const body = await request.json();
    const { action } = body as { action?: string };

    if (action === 'renameType') {
      const { kind, oldName, newName } = body as { kind?: string; oldName?: string; newName?: string };
      if (!isKind(kind) || !oldName || !newName?.trim()) {
        return NextResponse.json({ error: 'kind, oldName e newName são obrigatórios' }, { status: 400 });
      }
      const target = newName.trim();
      if (target !== oldName && (await Category.findOne({ kind, name: target }))) {
        return NextResponse.json({ error: 'Já existe uma categoria com esse nome' }, { status: 409 });
      }
      const cat = await Category.findOneAndUpdate({ kind, name: oldName }, { $set: { name: target } }, { new: true });
      if (!cat) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 });
      if (kind === 'expense') await cascadeRenameExpenseType(oldName, target);
      else await cascadeRenameIncomeType(oldName, target);
      invalidateCategoryCache();
      return NextResponse.json(cat);
    }

    if (action === 'renameSubtype') {
      const { type, oldSub, newSub } = body as { type?: string; oldSub?: string; newSub?: string };
      if (!type || !oldSub || !newSub?.trim()) {
        return NextResponse.json({ error: 'type, oldSub e newSub são obrigatórios' }, { status: 400 });
      }
      const target = newSub.trim();
      const cat = await Category.findOne({ kind: 'expense', name: type });
      if (!cat) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 });
      if (target !== oldSub && cat.subtypes.includes(target)) {
        return NextResponse.json({ error: 'Já existe uma subcategoria com esse nome' }, { status: 409 });
      }
      cat.subtypes = cat.subtypes.map((s: string) => (s === oldSub ? target : s));
      await cat.save();
      await cascadeRenameExpenseSubtype(type, oldSub, target);
      invalidateCategoryCache();
      return NextResponse.json(cat);
    }

    if (action === 'reorder') {
      const { kind, order } = body as { kind?: string; order?: string[] };
      if (!isKind(kind) || !Array.isArray(order)) {
        return NextResponse.json({ error: 'kind e order são obrigatórios' }, { status: 400 });
      }
      await Promise.all(
        order.map((name, index) => Category.updateOne({ kind, name }, { $set: { order: index } }))
      );
      invalidateCategoryCache();
      return NextResponse.json({ reordered: true });
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao atualizar categoria: ${error}` }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await connectToDatabase();
    const params = request.nextUrl.searchParams;
    const force = params.get('force') === 'true';
    const reassignTo = params.get('reassignTo');
    const type = params.get('type');
    const subtype = params.get('subtype');

    // Subtype-level deletion
    if (type && subtype) {
      const cat = await Category.findOne({ kind: 'expense', name: type });
      if (!cat) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 });

      const count = await countAssociatedForSubtype(type, subtype);
      if (count > 0 && !force && !reassignTo) {
        return NextResponse.json({ hasAssociated: true, count }, { status: 409 });
      }
      if (reassignTo) {
        if (!cat.subtypes.includes(reassignTo)) {
          return NextResponse.json({ error: 'Subtipo de destino inválido' }, { status: 400 });
        }
        await cascadeRenameExpenseSubtype(type, subtype, reassignTo);
      }
      cat.subtypes = cat.subtypes.filter((s: string) => s !== subtype);
      await cat.save();
      invalidateCategoryCache();
      return NextResponse.json({ deleted: true, reassigned: !!reassignTo });
    }

    // Type-level deletion
    const kind = params.get('kind');
    const name = params.get('name');
    if (!isKind(kind) || !name) {
      return NextResponse.json({ error: 'kind e name são obrigatórios' }, { status: 400 });
    }

    const cat = await Category.findOne({ kind, name });
    if (!cat) return NextResponse.json({ error: 'Categoria não encontrada' }, { status: 404 });

    const count = await countAssociatedForType(kind, name);
    if (count > 0 && !force && !reassignTo) {
      return NextResponse.json({ hasAssociated: true, count }, { status: 409 });
    }
    if (reassignTo) {
      const target = await Category.findOne({ kind, name: reassignTo });
      if (!target) return NextResponse.json({ error: 'Categoria de destino inválida' }, { status: 400 });
      if (kind === 'expense') await cascadeReassignExpenseType(name, reassignTo);
      else await cascadeRenameIncomeType(name, reassignTo);
    }
    await Category.deleteOne({ kind, name });
    invalidateCategoryCache();
    return NextResponse.json({ deleted: true, reassigned: !!reassignTo });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao excluir categoria: ${error}` }, { status: 500 });
  }
}
