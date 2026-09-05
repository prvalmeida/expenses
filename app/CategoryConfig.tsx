'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCategories, type CategoryDoc } from '@/hooks/useCategories';

type DeleteTarget =
  | { level: 'type'; kind: 'expense' | 'income'; name: string; count: number }
  | { level: 'subtype'; type: string; subtype: string; count: number };

type RenameTarget =
  | { level: 'type'; kind: 'expense' | 'income'; name: string }
  | { level: 'subtype'; type: string; subtype: string };

const currentName = (t: RenameTarget) => (t.level === 'type' ? t.name : t.subtype);

export default function CategoryConfig() {
  const { categories, refetch, loading } = useCategories();
  const [newExpenseType, setNewExpenseType] = useState('');
  const [newIncomeType, setNewIncomeType] = useState('');
  const [newSubtype, setNewSubtype] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expenseCats = categories.filter(c => c.kind === 'expense');
  const incomeCats = categories.filter(c => c.kind === 'income');

  const toggleExpand = (name: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const runAction = async (fn: () => Promise<Response>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Erro ao salvar');
        return false;
      }
      await refetch();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const addType = async (kind: 'expense' | 'income', name: string, reset: () => void) => {
    if (!name.trim()) return;
    const ok = await runAction(() =>
      fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name: name.trim() }),
      })
    );
    if (ok) reset();
  };

  const addSubtype = async (type: string) => {
    const value = (newSubtype[type] ?? '').trim();
    if (!value) return;
    const ok = await runAction(() =>
      fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'expense', name: type, subtype: value }),
      })
    );
    if (ok) setNewSubtype(prev => ({ ...prev, [type]: '' }));
  };

  const startRename = (target: RenameTarget) => {
    setError(null);
    setRenameValue(currentName(target));
    setRenameTarget(target);
  };

  const confirmRename = async () => {
    if (!renameTarget) return;
    const value = renameValue.trim();
    if (!value || value === currentName(renameTarget)) {
      setRenameTarget(null);
      return;
    }
    const body =
      renameTarget.level === 'type'
        ? { action: 'renameType', kind: renameTarget.kind, oldName: renameTarget.name, newName: value }
        : { action: 'renameSubtype', type: renameTarget.type, oldSub: renameTarget.subtype, newSub: value };
    const ok = await runAction(() =>
      fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    if (ok) setRenameTarget(null);
  };

  useEffect(() => {
    if (!renameTarget && !deleteTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setRenameTarget(null);
      setDeleteTarget(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [renameTarget, deleteTarget]);

  const attemptDeleteType = async (kind: 'expense' | 'income', name: string) => {
    setError(null);
    const res = await fetch(`/api/categories?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (res.ok) {
      await refetch();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.hasAssociated) {
      setReassignTo('');
      setDeleteTarget({ level: 'type', kind, name, count: data.count });
    } else {
      setError(data.error ?? 'Erro ao excluir');
    }
  };

  const attemptDeleteSubtype = async (type: string, subtype: string) => {
    setError(null);
    const res = await fetch(
      `/api/categories?type=${encodeURIComponent(type)}&subtype=${encodeURIComponent(subtype)}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      await refetch();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.hasAssociated) {
      setReassignTo('');
      setDeleteTarget({ level: 'subtype', type, subtype, count: data.count });
    } else {
      setError(data.error ?? 'Erro ao excluir');
    }
  };

  const buildDeleteUrl = (target: DeleteTarget, extra: string) => {
    if (target.level === 'type') {
      return `/api/categories?kind=${target.kind}&name=${encodeURIComponent(target.name)}${extra}`;
    }
    return `/api/categories?type=${encodeURIComponent(target.type)}&subtype=${encodeURIComponent(target.subtype)}${extra}`;
  };

  const confirmReassign = async () => {
    if (!deleteTarget || !reassignTo) return;
    const ok = await runAction(() =>
      fetch(buildDeleteUrl(deleteTarget, `&reassignTo=${encodeURIComponent(reassignTo)}`), { method: 'DELETE' })
    );
    if (ok) setDeleteTarget(null);
  };

  const confirmForceDelete = async () => {
    if (!deleteTarget) return;
    const ok = await runAction(() =>
      fetch(buildDeleteUrl(deleteTarget, '&force=true'), { method: 'DELETE' })
    );
    if (ok) setDeleteTarget(null);
  };

  const reassignOptions = (): string[] => {
    if (!deleteTarget) return [];
    if (deleteTarget.level === 'type') {
      return categories.filter(c => c.kind === deleteTarget.kind && c.name !== deleteTarget.name).map(c => c.name);
    }
    const cat = categories.find(c => c.kind === 'expense' && c.name === deleteTarget.type);
    return (cat?.subtypes ?? []).filter(s => s !== deleteTarget.subtype);
  };

  const renderTypeRow = (cat: CategoryDoc) => {
    const isExpense = cat.kind === 'expense';
    const isOpen = expanded.has(cat.name);
    return (
      <li key={cat._id ?? cat.name} className="border-b border-gray-100 last:border-b-0">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            {isExpense && (
              <button
                onClick={() => toggleExpand(cat.name)}
                className="text-gray-400 hover:text-gray-700 text-xs w-4 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center -my-2 sm:my-0"
                title={isOpen ? 'Recolher' : 'Expandir'}
              >
                {isOpen ? '▼' : '▶'}
              </button>
            )}
            <span className="text-sm font-bold text-gray-800 uppercase truncate">{cat.name}</span>
            {isExpense && (
              <span className="text-[10px] text-gray-400 font-bold">{cat.subtypes.length} sub</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => startRename({ level: 'type', kind: cat.kind, name: cat.name })}
              disabled={busy}
              className="text-blue-400 hover:text-blue-600 text-xs font-bold px-2 py-1 min-h-11 sm:min-h-0 inline-flex items-center -my-2 sm:my-0"
            >
              Renomear
            </button>
            <button
              onClick={() => attemptDeleteType(cat.kind, cat.name)}
              disabled={busy}
              className="text-red-400 hover:text-red-600 text-xs font-bold px-2 py-1 min-h-11 sm:min-h-0 inline-flex items-center -my-2 sm:my-0"
            >
              Excluir
            </button>
          </div>
        </div>
        {isExpense && isOpen && (
          <div className="px-4 pb-3 pl-10 space-y-1">
            {cat.subtypes.length === 0 && (
              <p className="text-xs text-gray-400 italic">Nenhuma subcategoria.</p>
            )}
            {[...cat.subtypes].sort((a, b) => a.localeCompare(b)).map(sub => (
              <div key={sub} className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-700">{sub}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startRename({ level: 'subtype', type: cat.name, subtype: sub })}
                    disabled={busy}
                    className="text-blue-400 hover:text-blue-600 text-[11px] font-bold px-2.5 min-h-11 sm:min-h-0 sm:px-1.5 inline-flex items-center"
                  >
                    Renomear
                  </button>
                  <button
                    onClick={() => attemptDeleteSubtype(cat.name, sub)}
                    disabled={busy}
                    className="text-red-400 hover:text-red-600 text-[11px] font-bold px-2.5 min-h-11 sm:min-h-0 sm:px-1.5 inline-flex items-center"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <input
                type="text"
                value={newSubtype[cat.name] ?? ''}
                onChange={e => setNewSubtype(prev => ({ ...prev, [cat.name]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addSubtype(cat.name); }}
                placeholder="Nova subcategoria"
                className="flex-1 p-1.5 border rounded text-xs"
              />
              <button
                onClick={() => addSubtype(cat.name)}
                disabled={busy}
                className="bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold hover:bg-blue-600 disabled:opacity-50"
              >
                Adicionar
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Categorias</h1>

      {error && !renameTarget && !deleteTarget && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      {loading && <p className="text-sm text-gray-400">Carregando...</p>}

      {/* Expense categories */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Categorias de Gasto</h2>
        </div>
        <ul>{expenseCats.map(renderTypeRow)}</ul>
        <div className="flex gap-2 p-4 border-t border-gray-100">
          <input
            type="text"
            value={newExpenseType}
            onChange={e => setNewExpenseType(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addType('expense', newExpenseType, () => setNewExpenseType('')); }}
            placeholder="Nova categoria de gasto"
            className="flex-1 p-2 border rounded text-sm"
          />
          <button
            onClick={() => addType('expense', newExpenseType, () => setNewExpenseType(''))}
            disabled={busy}
            className="bg-blue-500 text-white px-4 py-2 rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      </div>

      {/* Income categories */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Tipos de Receita</h2>
        </div>
        <ul>{incomeCats.map(renderTypeRow)}</ul>
        <div className="flex gap-2 p-4 border-t border-gray-100">
          <input
            type="text"
            value={newIncomeType}
            onChange={e => setNewIncomeType(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addType('income', newIncomeType, () => setNewIncomeType('')); }}
            placeholder="Novo tipo de receita"
            className="flex-1 p-2 border rounded text-sm"
          />
          <button
            onClick={() => addType('income', newIncomeType, () => setNewIncomeType(''))}
            disabled={busy}
            className="bg-blue-500 text-white px-4 py-2 rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      </div>

      {deleteTarget && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={() => setDeleteTarget(null)}>
          <div
            className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[85dvh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 sm:p-6 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <h2 className="text-lg font-bold">
                Excluir {deleteTarget.level === 'type' ? 'categoria' : 'subcategoria'} “
                {deleteTarget.level === 'type' ? deleteTarget.name : deleteTarget.subtype}”
              </h2>
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Existem {deleteTarget.count} {deleteTarget.count === 1 ? 'registro associado' : 'registros associados'}.
                Reatribua-os a outra opção, ou exclua mesmo assim (os registros ficarão órfãos e precisarão de correção manual).
              </p>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Reatribuir para</label>
                <select
                  value={reassignTo}
                  onChange={e => setReassignTo(e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                >
                  <option value="">Selecione...</option>
                  {reassignOptions().map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2 border border-gray-300 rounded text-sm font-bold hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmReassign}
                  disabled={busy || !reassignTo}
                  className="flex-1 py-2 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50"
                >
                  Reatribuir e excluir
                </button>
              </div>
              <button
                onClick={confirmForceDelete}
                disabled={busy}
                className="w-full py-2 bg-red-100 text-red-700 border border-red-300 rounded text-sm font-bold hover:bg-red-200 disabled:opacity-50"
              >
                Excluir mesmo assim (deixar órfãos)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {renameTarget && createPortal(
        <div
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[85dvh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <form
              onSubmit={e => { e.preventDefault(); confirmRename(); }}
              className="p-4 sm:p-6 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <h2 className="text-lg font-bold">
                Renomear {renameTarget.level === 'type' ? 'categoria' : 'subcategoria'} “
                {currentName(renameTarget)}”
              </h2>

              {renameTarget.level === 'subtype' && (
                <p className="text-sm text-gray-600">
                  Em <span className="font-semibold">{renameTarget.type}</span>. Os gastos, mapeamentos e lojas
                  que usam este nome são atualizados junto.
                </p>
              )}

              <div>
                <label htmlFor="rename-input" className="block text-xs font-bold text-gray-700 mb-1 uppercase">Novo nome</label>
                <input
                  id="rename-input"
                  autoFocus
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="flex-1 py-2 border border-gray-300 rounded text-sm font-bold hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy || !renameValue.trim() || renameValue.trim() === currentName(renameTarget)}
                  className="flex-1 py-2 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50"
                >
                  {busy ? 'Salvando...' : 'Renomear'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
