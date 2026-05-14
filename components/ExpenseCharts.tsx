'use client';

import React, { useMemo, useState } from 'react';
import { Expense } from '@/types';

type Props = {
  allExpenses: Expense[];
  viewMode: 'purchase' | 'payment';
  defaultMonth?: string; // YYYY-MM
  onClose?: () => void;
};

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

export default function ExpenseCharts({ allExpenses, viewMode, defaultMonth }: Props) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [mode, setMode] = useState<'detail' | 'compare'>('detail');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => defaultMonth ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })());
  const [monthA, setMonthA] = useState<string>(() => defaultMonth ?? (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })());
  const [monthB, setMonthB] = useState<string>(() => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  });
  
  // Keep selectedMonth in sync with prop changes
  React.useEffect(() => {
    if (defaultMonth) setSelectedMonth(defaultMonth);
  }, [defaultMonth]);

  const parseMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return { y, m };
  };

  const expCurrent = useMemo(() => {
    const { y, m } = parseMonth(selectedMonth);
    return allExpenses.filter(e => {
      const dateStr = viewMode === 'payment' ? e.effectiveDate : e.date;
      if (!dateStr) return false;
      const d = new Date(`${dateStr}T12:00:00Z`);
      return d.getUTCFullYear() === y && d.getUTCMonth() === m - 1;
    });
  }, [allExpenses, selectedMonth, viewMode]);

  const expA = useMemo(() => {
    const { y, m } = parseMonth(monthA);
    return allExpenses.filter(e => {
      const dateStr = viewMode === 'payment' ? e.effectiveDate : e.date;
      if (!dateStr) return false;
      const d = new Date(`${dateStr}T12:00:00Z`);
      return d.getUTCFullYear() === y && d.getUTCMonth() === m - 1;
    });
  }, [allExpenses, monthA, viewMode]);

  const expB = useMemo(() => {
    const { y, m } = parseMonth(monthB);
    return allExpenses.filter(e => {
      const dateStr = viewMode === 'payment' ? e.effectiveDate : e.date;
      if (!dateStr) return false;
      const d = new Date(`${dateStr}T12:00:00Z`);
      return d.getUTCFullYear() === y && d.getUTCMonth() === m - 1;
    });
  }, [allExpenses, monthB, viewMode]);

  const totalsByTypeCurrent = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expCurrent) map.set(e.type || 'Outros', (map.get(e.type || 'Outros') ?? 0) + e.value);
    return map;
  }, [expCurrent]);

  const totalsByTypeA = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expA) map.set(e.type || 'Outros', (map.get(e.type || 'Outros') ?? 0) + e.value);
    return map;
  }, [expA]);

  const totalsByTypeB = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expB) map.set(e.type || 'Outros', (map.get(e.type || 'Outros') ?? 0) + e.value);
    return map;
  }, [expB]);

  const allTypes = useMemo(() => {
    const s = new Set<string>();
    // for detail view, use current totals
    if (mode === 'detail') {
      for (const k of totalsByTypeCurrent.keys()) s.add(k);
    } else {
      for (const k of totalsByTypeA.keys()) s.add(k);
      for (const k of totalsByTypeB.keys()) s.add(k);
    }
    return Array.from(s).sort();
  }, [totalsByTypeA, totalsByTypeB, totalsByTypeCurrent, mode]);

  const totalsBySubtypeFor = (expensesList: Expense[], type: string) => {
    const map = new Map<string, number>();
    for (const e of expensesList) {
      if (e.type !== type) continue;
      const key = e.subtype || 'Geral';
      map.set(key, (map.get(key) ?? 0) + e.value);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  };

  const maxVal = useMemo(() => {
    if (mode === 'detail') return Math.max(1, ...Array.from(totalsByTypeCurrent.values()));
    return Math.max(1, ...allTypes.map(t => Math.max(totalsByTypeA.get(t) ?? 0, totalsByTypeB.get(t) ?? 0)));
  }, [mode, totalsByTypeA, totalsByTypeB, totalsByTypeCurrent, allTypes]);

  // Ensure a selected type exists in detail mode
  React.useEffect(() => {
    if (mode === 'detail') {
      const first = Array.from(totalsByTypeCurrent.keys())[0];
      if (!selectedType && first) setSelectedType(first);
    }
  }, [mode, totalsByTypeCurrent, selectedType]);

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center gap-2 mb-6">
        <div className="flex bg-gray-100 rounded overflow-hidden">
          <button
            onClick={() => setMode('detail')}
            className={`px-3 py-1 text-sm ${mode === 'detail' ? 'bg-white font-bold' : 'text-gray-600'}`}
          >
            Detalhes
          </button>
          <button
            onClick={() => setMode('compare')}
            className={`px-3 py-1 text-sm ${mode === 'compare' ? 'bg-white font-bold' : 'text-gray-600'}`}
          >
            Comparar meses
          </button>
        </div>

        {mode === 'compare' && (
          <div className="flex items-center gap-2">
            <input type="month" value={monthA} onChange={e => setMonthA(e.target.value)} className="p-1 border rounded" />
            <span className="text-sm">vs</span>
            <input type="month" value={monthB} onChange={e => setMonthB(e.target.value)} className="p-1 border rounded" />
          </div>
        )}
      </div>

      {mode === 'detail' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-600 mb-2">Gastos por tipo</p>
            <div className="space-y-3">
              {Array.from(totalsByTypeCurrent.entries()).length === 0 && (
                <div className="text-sm text-gray-400">Nenhum gasto no mês selecionado.</div>
              )}
              {Array.from(totalsByTypeCurrent.entries()).sort((a,b)=>b[1]-a[1]).map(([type, value]) => {
                const widthPercent = Math.round((value / Math.max(1, ...Array.from(totalsByTypeCurrent.values()))) * 100);
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className="w-full flex items-center gap-3 p-2 rounded hover:bg-gray-50 text-left"
                  >
                    <div className="w-36 text-sm font-medium text-gray-700">{type}</div>
                    <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                      <div style={{ width: `${widthPercent}%` }} className="h-4 bg-blue-500" />
                    </div>
                    <div className="w-24 text-right text-sm font-black text-gray-900">R$ {formatCurrency(value)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-sm text-gray-600 mb-2">Subtipos {selectedType ? `de ${selectedType}` : ''}</p>
            <div className="space-y-3">
              {(() => {
                const sel = selectedType ?? Array.from(totalsByTypeCurrent.keys())[0];
                const list = totalsBySubtypeFor(expCurrent, sel || '');
                if (list.length === 0) return <div className="text-sm text-gray-400">Nenhum subtipo encontrado.</div>;
                const maxSub = Math.max(1, ...list.map(x=>x[1]));
                return list.map(([sub, val]) => {
                  const w = Math.round((val / maxSub) * 100);
                  return (
                    <div key={sub} className="w-full flex items-center gap-3 p-2 rounded text-left">
                      <div className="w-36 text-sm font-medium text-gray-700">{sub}</div>
                      <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                        <div style={{ width: `${w}%` }} className="h-4 bg-green-500" />
                      </div>
                      <div className="w-24 text-right text-sm font-black text-gray-900">R$ {formatCurrency(val)}</div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div>
            <p className="text-sm text-gray-600 mb-2">Comparação por tipo</p>
            <div className="space-y-3">
              {allTypes.length === 0 && (
                <div className="text-sm text-gray-400">Nenhum gasto nos meses selecionados.</div>
              )}
              {allTypes.map((type) => {
                const a = totalsByTypeA.get(type) ?? 0;
                const b = totalsByTypeB.get(type) ?? 0;
                const wa = Math.round((a / maxVal) * 100);
                const wb = Math.round((b / maxVal) * 100);
                return (
                  <div key={type} className="w-full flex items-center gap-3 p-2 rounded hover:bg-gray-50 text-left">
                    <div className="w-36 text-sm font-medium text-gray-700">{type}</div>
                    <div className="flex-1 flex gap-2 items-center">
                      <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden relative">
                        <div style={{ width: `${wa}%` }} className="h-4 bg-blue-500 absolute left-0 top-0" />
                        <div style={{ width: `${wb}%` }} className="h-4 bg-green-500 absolute left-0 top-0 opacity-60" />
                      </div>
                      <div className="w-24 text-right text-sm font-black text-gray-900">A: R$ {formatCurrency(a)}</div>
                      <div className="w-24 text-right text-sm font-black text-gray-900">B: R$ {formatCurrency(b)}</div>
                    </div>
                    <div>
                      <button onClick={() => setSelectedType(type)} className="text-xs text-indigo-600">Detalhar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedType && (
            <div>
              <p className="text-sm text-gray-600 mb-2">Subtipos de {selectedType}</p>
              <div className="space-y-3">
                <div className="w-full flex items-center gap-3 p-2 rounded text-left">
                  <div className="w-36 text-sm font-medium text-gray-700">Subtipo</div>
                  <div className="flex-1 text-sm font-medium">Mês A</div>
                  <div className="w-24 text-right text-sm font-black text-gray-900">Mês B</div>
                </div>
                {(() => {
                  const sa = totalsBySubtypeFor(expA, selectedType);
                  const sb = totalsBySubtypeFor(expB, selectedType);
                  const subs = new Set<string>();
                  sa.forEach(s => subs.add(s[0]));
                  sb.forEach(s => subs.add(s[0]));
                  const list = Array.from(subs);
                  const maxSub = Math.max(1, ...list.map(s => Math.max(sa.find(x => x[0] === s)?.[1] ?? 0, sb.find(x => x[0] === s)?.[1] ?? 0)));
                  return list.map(sub => {
                    const va = sa.find(x => x[0] === sub)?.[1] ?? 0;
                    const vb = sb.find(x => x[0] === sub)?.[1] ?? 0;
                    const wa = Math.round((va / maxSub) * 100);
                    return (
                      <div key={sub} className="w-full flex items-center gap-3 p-2 rounded text-left">
                        <div className="w-36 text-sm font-medium text-gray-700">{sub}</div>
                        <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                          <div style={{ width: `${wa}%` }} className="h-4 bg-blue-500" />
                        </div>
                        <div className="w-24 text-right text-sm font-black text-gray-900">R$ {formatCurrency(va)}</div>
                        <div className="w-24 text-right text-sm font-black text-gray-900">R$ {formatCurrency(vb)}</div>
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
  );
}
