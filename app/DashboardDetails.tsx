'use client';

import { Expense } from "@/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EditExpenseModal from "../components/EditExpenseModal";
import { useCategories } from "@/hooks/useCategories";

type Props = {
  initialMonth: string;
  initialViewMode: 'purchase' | 'payment';
  onBack: () => void;
};

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function DashboardDetails({ initialMonth, initialViewMode, onBack }: Props) {
  const { expenseTypes, isValidType, isValidPair } = useCategories();
  const isOrphan = useCallback(
    (e: Expense) => !isValidType(e.type) || (!!e.subtype && !isValidPair(e.type, e.subtype)),
    [isValidType, isValidPair]
  );
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [viewMode, setViewMode] = useState<'purchase' | 'payment'>(initialViewMode);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  const [sortColumn, setSortColumn] = useState<'date' | 'name' | 'type' | 'value' | 'paymentType'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingOriginalDate, setEditingOriginalDate] = useState<string | undefined>();

  // Category analysis
  const [analysisMode, setAnalysisMode] = useState<'detail' | 'compare'>('detail');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [monthA, setMonthA] = useState(initialMonth);
  const [monthB, setMonthB] = useState(() => prevMonth(initialMonth));

  const dateOf = useCallback(
    (e: Expense) => (viewMode === 'payment' ? e.effectiveDate : e.date),
    [viewMode]
  );

  const inMonth = useCallback((dateStr: string, ym: string) => {
    if (!dateStr) return false;
    const [year, month] = ym.split('-').map(Number);
    const d = new Date(`${dateStr}T12:00:00Z`);
    return d.getUTCMonth() === month - 1 && d.getUTCFullYear() === year;
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch('/api/expenses');
      if (response.ok) {
        setAllExpenses(await response.json());
      }
    };
    fetchData();
  }, []);

  const filteredExpenses = useMemo(
    () => allExpenses.filter(e => inMonth(dateOf(e), selectedMonth)),
    [allExpenses, dateOf, inMonth, selectedMonth]
  );

  const handleSort = (column: 'date' | 'name' | 'type' | 'value' | 'paymentType') => {
    if (column === sortColumn) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'date' ? 'desc' : 'asc');
    }
  };

  useEffect(() => {
    const visible = filteredExpenses.filter(e => typeFilter === '' || e.type === typeFilter);
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selectedIds.size > 0 && selectedIds.size < visible.length;
    }
  }, [selectedIds, filteredExpenses, typeFilter]);

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    if (!confirm(`Excluir ${n} ${n === 1 ? 'gasto selecionado' : 'gastos selecionados'}?`)) return;

    const res = await fetch('/api/expenses/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });

    if (res.ok) {
      const deletedIds = new Set(selectedIds);
      setAllExpenses(prev => prev.filter(e => !deletedIds.has(e._id!)));
      setSelectedIds(new Set());
    }
  };

  const onExpenseDeleted = (id: string, deleteAll: boolean) => {
    setAllExpenses(prev => {
      const targetExpense = prev.find(e => e._id === id);
      if (deleteAll && targetExpense?.transactionId) {
        return prev.filter(exp => exp.transactionId !== targetExpense.transactionId);
      }
      return prev.filter(exp => exp._id !== id);
    });
  };

  const handleEdit = (updated: Expense | Expense[]) => {
    setAllExpenses(prev => {
      if (Array.isArray(updated)) {
        const tid = updated[0]?.transactionId;
        return tid
          ? [...prev.filter(e => e.transactionId !== tid), ...updated]
          : [...prev, ...updated];
      }
      return prev.map(e => e._id === updated._id ? updated : e);
    });
    setEditingExpense(null);
    setEditingOriginalDate(undefined);
  };

  const handleDelete = async (id: string, hasMultiple: boolean) => {
    const message = hasMultiple
      ? "Este gasto é parcelado. Todas as parcelas serão excluídas. Confirma?"
      : "Excluir este gasto?";
    if (!confirm(message)) return;

    const url = hasMultiple ? `/api/expenses/${id}?all=true` : `/api/expenses/${id}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) {
      onExpenseDeleted(id, hasMultiple);
    }
  };

  // --- Category analysis helpers ---
  const totalsByType = useCallback((ym: string) => {
    const map = new Map<string, number>();
    for (const e of allExpenses) {
      if (!inMonth(dateOf(e), ym)) continue;
      map.set(e.type, (map.get(e.type) ?? 0) + e.value);
    }
    return map;
  }, [allExpenses, dateOf, inMonth]);

  const totalsBySubtype = useCallback((ym: string, type: string) => {
    const map = new Map<string, number>();
    for (const e of allExpenses) {
      if (e.type !== type || !inMonth(dateOf(e), ym)) continue;
      const key = e.subtype || 'Geral';
      map.set(key, (map.get(key) ?? 0) + e.value);
    }
    return map;
  }, [allExpenses, dateOf, inMonth]);

  const typesCurrent = useMemo(
    () => Array.from(totalsByType(selectedMonth).entries()).sort((a, b) => b[1] - a[1]),
    [totalsByType, selectedMonth]
  );

  // Effective category for the detail/subtype panels: explicit selection, else first by value
  const effectiveType = selectedType ?? typesCurrent[0]?.[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-bold text-gray-600 hover:text-gray-900"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Voltar
        </button>
        <h1 className="text-2xl font-bold">Detalhes</h1>
      </div>

      {/* Controls: month + view mode */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="w-full sm:w-48">
          <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Mês de Referência</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => { setSelectedMonth(e.target.value); setSelectedIds(new Set()); }}
            className="w-full rounded-md border-gray-300 shadow-sm text-sm p-2 border"
          />
        </div>
        <div className="flex bg-gray-200 p-1 rounded-lg self-start">
          <button
            onClick={() => { setViewMode('purchase'); setSelectedIds(new Set()); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
              viewMode === 'purchase' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600'
            }`}
          >
            DATA DA COMPRA
          </button>
          <button
            onClick={() => { setViewMode('payment'); setSelectedIds(new Set()); }}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
              viewMode === 'payment' ? 'bg-white shadow-sm text-green-600' : 'text-gray-600'
            }`}
          >
            FLUXO DE CAIXA
          </button>
        </div>
      </div>

      {/* Category analysis */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="flex bg-gray-100 rounded overflow-hidden">
            <button
              onClick={() => setAnalysisMode('detail')}
              className={`px-3 py-1 text-sm ${analysisMode === 'detail' ? 'bg-white font-bold' : 'text-gray-600'}`}
            >
              Por categoria
            </button>
            <button
              onClick={() => setAnalysisMode('compare')}
              className={`px-3 py-1 text-sm ${analysisMode === 'compare' ? 'bg-white font-bold' : 'text-gray-600'}`}
            >
              Comparar meses
            </button>
          </div>
          {analysisMode === 'compare' && (
            <div className="flex items-center gap-2">
              <input type="month" value={monthA} onChange={e => setMonthA(e.target.value)} className="p-1 border rounded text-sm" />
              <span className="text-sm">vs</span>
              <input type="month" value={monthB} onChange={e => setMonthB(e.target.value)} className="p-1 border rounded text-sm" />
            </div>
          )}
        </div>

        {analysisMode === 'detail' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-600 mb-2">Gastos por categoria</p>
              <div className="space-y-3">
                {typesCurrent.length === 0 && (
                  <div className="text-sm text-gray-400">Nenhum gasto no mês selecionado.</div>
                )}
                {(() => {
                  const max = Math.max(1, ...typesCurrent.map(t => t[1]));
                  return typesCurrent.map(([type, value]) => {
                    const w = Math.round((value / max) * 100);
                    const active = effectiveType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => setSelectedType(type)}
                        className={`w-full flex items-center gap-3 p-2 rounded text-left ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <div className="w-32 text-sm font-medium text-gray-700">{type}</div>
                        <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                          <div style={{ width: `${w}%` }} className="h-4 bg-blue-500" />
                        </div>
                        <div className="w-24 text-right text-sm font-black text-gray-900">R$ {fmt(value)}</div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-600 mb-2">Subcategorias {effectiveType ? `de ${effectiveType}` : ''}</p>
              <div className="space-y-3">
                {(() => {
                  const sel = effectiveType;
                  if (!sel) return <div className="text-sm text-gray-400">Selecione uma categoria.</div>;
                  const list = Array.from(totalsBySubtype(selectedMonth, sel).entries()).sort((a, b) => b[1] - a[1]);
                  if (list.length === 0) return <div className="text-sm text-gray-400">Nenhuma subcategoria encontrada.</div>;
                  const max = Math.max(1, ...list.map(x => x[1]));
                  return list.map(([sub, val]) => {
                    const w = Math.round((val / max) * 100);
                    return (
                      <div key={sub} className="w-full flex items-center gap-3 p-2 rounded text-left">
                        <div className="w-32 text-sm font-medium text-gray-700">{sub}</div>
                        <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                          <div style={{ width: `${w}%` }} className="h-4 bg-green-500" />
                        </div>
                        <div className="w-24 text-right text-sm font-black text-gray-900">R$ {fmt(val)}</div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-gray-600 mb-2">Comparação por categoria</p>
              <div className="space-y-3">
                {(() => {
                  const ta = totalsByType(monthA);
                  const tb = totalsByType(monthB);
                  const types = Array.from(new Set([...ta.keys(), ...tb.keys()])).sort();
                  if (types.length === 0) return <div className="text-sm text-gray-400">Nenhum gasto nos meses selecionados.</div>;
                  const max = Math.max(1, ...types.map(t => Math.max(ta.get(t) ?? 0, tb.get(t) ?? 0)));
                  return types.map(type => {
                    const a = ta.get(type) ?? 0;
                    const b = tb.get(type) ?? 0;
                    return (
                      <div key={type} className="w-full flex items-center gap-3 p-2 rounded hover:bg-gray-50 text-left">
                        <div className="w-32 text-sm font-medium text-gray-700">{type}</div>
                        <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden relative">
                          <div style={{ width: `${Math.round((a / max) * 100)}%` }} className="h-4 bg-blue-500 absolute left-0 top-0" />
                          <div style={{ width: `${Math.round((b / max) * 100)}%` }} className="h-4 bg-green-500 absolute left-0 top-0 opacity-60" />
                        </div>
                        <div className="w-24 text-right text-xs font-black text-blue-600">{fmt(a)}</div>
                        <div className="w-24 text-right text-xs font-black text-green-600">{fmt(b)}</div>
                        <button onClick={() => setSelectedType(type)} className="text-xs text-indigo-600">Detalhar</button>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="flex gap-4 mt-2 text-[10px] uppercase font-bold">
                <span className="text-blue-600">■ {monthA}</span>
                <span className="text-green-600">■ {monthB}</span>
              </div>
            </div>

            {selectedType && (
              <div>
                <p className="text-sm text-gray-600 mb-2">Subcategorias de {selectedType}</p>
                <div className="space-y-3">
                  {(() => {
                    const sa = totalsBySubtype(monthA, selectedType);
                    const sb = totalsBySubtype(monthB, selectedType);
                    const subs = Array.from(new Set([...sa.keys(), ...sb.keys()]));
                    if (subs.length === 0) return <div className="text-sm text-gray-400">Nenhuma subcategoria encontrada.</div>;
                    const max = Math.max(1, ...subs.map(s => Math.max(sa.get(s) ?? 0, sb.get(s) ?? 0)));
                    return subs.map(sub => {
                      const va = sa.get(sub) ?? 0;
                      const vb = sb.get(sub) ?? 0;
                      return (
                        <div key={sub} className="w-full flex items-center gap-3 p-2 rounded text-left">
                          <div className="w-32 text-sm font-medium text-gray-700">{sub}</div>
                          <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden relative">
                            <div style={{ width: `${Math.round((va / max) * 100)}%` }} className="h-4 bg-blue-500 absolute left-0 top-0" />
                            <div style={{ width: `${Math.round((vb / max) * 100)}%` }} className="h-4 bg-green-500 absolute left-0 top-0 opacity-60" />
                          </div>
                          <div className="w-24 text-right text-xs font-black text-blue-600">{fmt(va)}</div>
                          <div className="w-24 text-right text-xs font-black text-green-600">{fmt(vb)}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Full expense table */}
      <div className="bg-white shadow ring-1 ring-black/5 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          <label className="text-xs font-bold text-gray-700 uppercase whitespace-nowrap">Filtrar por Categoria</label>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setSelectedIds(new Set()); }}
            className="rounded-md border-gray-300 shadow-sm text-sm p-2 border"
          >
            <option value="">Todos os Tipos</option>
            {[...expenseTypes].sort().map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkDelete}
              className="ml-auto bg-red-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-red-700"
            >
              Excluir selecionados ({selectedIds.size})
            </button>
          )}
        </div>
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-3 px-3 w-10 text-center">
                <input
                  type="checkbox"
                  ref={selectAllRef}
                  checked={(() => {
                    const visible = filteredExpenses.filter(e => typeFilter === '' || e.type === typeFilter);
                    return visible.length > 0 && visible.every(e => selectedIds.has(e._id!));
                  })()}
                  onChange={(e) => {
                    const visible = filteredExpenses.filter(exp => typeFilter === '' || exp.type === typeFilter);
                    setSelectedIds(e.target.checked ? new Set(visible.map(exp => exp._id!)) : new Set());
                  }}
                />
              </th>
              <th
                className="py-3 px-4 text-left text-xs font-bold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800"
                onClick={() => handleSort('date')}
              >
                Data {sortColumn === 'date' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th
                className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800"
                onClick={() => handleSort('name')}
              >
                Nome {sortColumn === 'name' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th
                className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800"
                onClick={() => handleSort('type')}
              >
                Categoria {sortColumn === 'type' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th
                className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800"
                onClick={() => handleSort('paymentType')}
              >
                Pagamento {sortColumn === 'paymentType' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th
                className="px-3 py-3 text-right text-xs font-bold text-gray-500 uppercase cursor-pointer select-none hover:text-gray-800"
                onClick={() => handleSort('value')}
              >
                Valor {sortColumn === 'value' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th className="px-3 py-3 text-center text-xs font-bold text-gray-500 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredExpenses
              .filter((expense) => typeFilter === '' || expense.type === typeFilter)
              .sort((a, b) => {
                const dir = sortDirection === 'asc' ? 1 : -1;
                if (sortColumn === 'date') {
                  const dateA = viewMode === 'purchase' ? a.date : a.effectiveDate;
                  const dateB = viewMode === 'purchase' ? b.date : b.effectiveDate;
                  return (dateA < dateB ? -1 : dateA > dateB ? 1 : 0) * dir;
                }
                if (sortColumn === 'name') return a.name.localeCompare(b.name) * dir;
                if (sortColumn === 'type') return a.type.localeCompare(b.type) * dir;
                if (sortColumn === 'paymentType') {
                  const cmp = a.paymentType.localeCompare(b.paymentType);
                  if (cmp !== 0) return cmp * dir;
                  const aCard = ('cardBrand' in a ? (a as { cardBrand?: string }).cardBrand : '') ?? '';
                  const bCard = ('cardBrand' in b ? (b as { cardBrand?: string }).cardBrand : '') ?? '';
                  return aCard.localeCompare(bCard) * dir;
                }
                return (a.value - b.value) * dir;
              })
              .map((expense) => (
              <tr key={expense._id} className="hover:bg-gray-50 transition-colors">
                <td className="py-4 px-3 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(expense._id!)}
                    onChange={(e) => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(expense._id!);
                        else next.delete(expense._id!);
                        return next;
                      });
                    }}
                  />
                </td>
                <td className="whitespace-nowrap py-4 px-4 text-sm text-gray-600 font-medium">
                  {new Date(`${viewMode === 'purchase' ? expense.date : expense.effectiveDate}T12:00:00Z`)
                    .toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                </td>
                <td className="px-3 py-4 text-sm text-gray-900 font-semibold">{expense.name}</td>
                <td className="px-3 py-4">
                  <div className="flex flex-col">
                    <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded w-fit ${isOrphan(expense) ? 'text-amber-800 bg-amber-100' : 'text-blue-700 bg-blue-50'}`}>
                      {isOrphan(expense) && <span title="Categoria ou subcategoria inexistente — edite para corrigir">⚠ </span>}
                      {expense.type}
                    </span>
                    <span className="text-[10px] text-gray-400 font-bold uppercase mt-1">{expense.subtype}</span>
                  </div>
                </td>
                <td className="px-3 py-4 text-xs">
                  <span className="capitalize font-medium text-gray-600 block">{expense.paymentType}</span>
                  {expense.paymentType === 'credit' && (
                    <span className="text-[10px] text-blue-500 font-bold">
                      {expense.cardBrand} ({expense.installment}/{expense.totalInstallments})
                    </span>
                  )}
                </td>
                <td className="px-3 py-4 text-right text-sm font-black text-gray-900">
                  R$ {fmt(expense.value)}
                </td>
                <td className="px-3 py-4 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => {
                        setEditingExpense(expense);
                        if (expense.paymentType === 'credit' && (expense.totalInstallments ?? 0) > 1 && expense.transactionId) {
                          const first = allExpenses
                            .filter(e => e.transactionId === expense.transactionId)
                            .sort((a, b) => {
                              const aI = a.paymentType === 'credit' ? a.installment : 0;
                              const bI = b.paymentType === 'credit' ? b.installment : 0;
                              return aI - bI;
                            })[0];
                          setEditingOriginalDate(first?.date);
                        } else {
                          setEditingOriginalDate(undefined);
                        }
                      }}
                      className="text-blue-400 hover:text-blue-600 transition-colors p-1"
                      title="Editar despesa"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        if (expense._id) {
                          const isInstallment = (expense.totalInstallments ?? 0) > 1;
                          handleDelete(expense._id, isInstallment);
                        }
                      }}
                      className="text-red-400 hover:text-red-600 transition-colors p-1"
                      title={expense.totalInstallments && expense.totalInstallments > 1 ? "Excluir parcelas" : "Excluir despesa"}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredExpenses.length === 0 && (
          <div className="p-10 text-center text-gray-400 text-sm">Nenhum gasto encontrado.</div>
        )}
      </div>

      {editingExpense && (
        <EditExpenseModal
          expense={editingExpense}
          originalDate={editingOriginalDate}
          onSave={handleEdit}
          onClose={() => {
            setEditingExpense(null);
            setEditingOriginalDate(undefined);
          }}
        />
      )}
    </div>
  );
}
