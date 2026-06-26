'use client';

import { Expense, Income } from "@/types";

const VOUCHER_PAYMENT_TYPES = ['food-voucher', 'meal-voucher', 'fuel-voucher'];
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  onOpenDetails: (month: string, viewMode: 'purchase' | 'payment') => void;
};

export default function DashBoard({ onOpenDetails }: Props) {
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [allIncomes, setAllIncomes] = useState<Income[]>([]);

  // Toggle: 'purchase' (Data da Compra) vs 'payment' (Fluxo de Caixa)
  const [viewMode, setViewMode] = useState<'purchase' | 'payment'>('purchase');

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const isInMonth = useCallback((dateStr: string) => {
    if (!dateStr) return false;
    const [year, month] = selectedMonth.split('-').map(Number);
    const d = new Date(`${dateStr}T12:00:00Z`);
    return d.getUTCMonth() === month - 1 && d.getUTCFullYear() === year;
  }, [selectedMonth]);

  // Expenses of the month under the current view mode (purchase vs payment date)
  const monthExpenses = useMemo(
    () => allExpenses.filter(e => isInMonth(viewMode === 'payment' ? e.effectiveDate : e.date)),
    [allExpenses, viewMode, isInMonth]
  );

  // Total excludes voucher payment types
  const totalThisMonth = useMemo(
    () => monthExpenses
      .filter(exp => !VOUCHER_PAYMENT_TYPES.includes(exp.paymentType ?? ''))
      .reduce((sum, exp) => sum + exp.value, 0),
    [monthExpenses]
  );

  // Category summary: ALWAYS by purchase date (date), INCLUDES vouchers
  const summaryByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of allExpenses) {
      if (!isInMonth(e.date)) continue;
      map.set(e.type, (map.get(e.type) ?? 0) + e.value);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [allExpenses, isInMonth]);

  const summaryTotal = useMemo(
    () => summaryByCategory.reduce((sum, [, v]) => sum + v, 0),
    [summaryByCategory]
  );

  const monthIncomes = useMemo(
    () => allIncomes
      .filter(income => isInMonth(income.date))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [allIncomes, isInMonth]
  );

  const totalIncomeThisMonth = useMemo(
    () => monthIncomes.reduce((sum, inc) => sum + inc.value, 0),
    [monthIncomes]
  );

  const onIncomeDeleted = (id: string) => {
    setAllIncomes(prev => prev.filter(inc => inc._id !== id));
  };

  const handleDeleteIncome = async (id: string) => {
    if (!confirm("Excluir esta receita?")) return;

    const res = await fetch(`/api/income/${id}`, { method: 'DELETE' });
    if (res.ok) {
      onIncomeDeleted(id);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch('/api/expenses');
      if (response.ok) {
        const data: Expense[] = await response.json();
        setAllExpenses(data);
      }

      const incomeResponse = await fetch('/api/income');
      if (incomeResponse.ok) {
        const incomeData: Income[] = await incomeResponse.json();
        setAllIncomes(incomeData);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header + Switcher de Visualização */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-2xl font-bold">Dashboard de Gastos</h1>

        <div className="flex bg-gray-200 p-1 rounded-lg self-start">
          <button
            onClick={() => setViewMode('purchase')}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
              viewMode === 'purchase' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600'
            }`}
          >
            DATA DA COMPRA
          </button>
          <button
            onClick={() => setViewMode('payment')}
            className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
              viewMode === 'payment' ? 'bg-white shadow-sm text-green-600' : 'text-gray-600'
            }`}
          >
            FLUXO DE CAIXA
          </button>
        </div>
      </div>

      {/* Month picker (above totals) */}
      <div className="w-full sm:w-48">
        <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Mês de Referência</label>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="w-full rounded-md border-gray-300 shadow-sm text-sm p-2 border"
        />
      </div>

      {/* Totals side by side (compact) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className={`p-4 rounded-xl border-l-4 shadow-sm bg-white ${viewMode === 'purchase' ? 'border-blue-500' : 'border-green-500'}`}>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            {viewMode === 'purchase' ? 'Gastos' : 'A Pagar'}
          </p>
          <p className="text-xl font-black mt-1 text-gray-900">
            R$ {totalThisMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div className="p-4 rounded-xl border-l-4 border-purple-500 shadow-sm bg-white">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Receitas</p>
          <p className="text-xl font-black mt-1 text-gray-900">
            R$ {totalIncomeThisMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>

        {viewMode === 'payment' && (
          <div className="p-4 rounded-xl border-l-4 border-yellow-500 shadow-sm bg-white">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Poupança</p>
            <p className={`text-xl font-black mt-1 ${totalIncomeThisMonth - totalThisMonth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              R$ {(totalIncomeThisMonth - totalThisMonth).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        )}
      </div>

      {/* Two columns: category summary (left) + incomes (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Resumo por Categoria */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Resumo por Categoria</h2>
              <p className="text-[10px] text-gray-400 italic">* Por data da compra.</p>
            </div>
            <button
              onClick={() => onOpenDetails(selectedMonth, viewMode)}
              className="text-gray-400 hover:text-blue-600 transition-colors p-1.5 rounded hover:bg-blue-50"
              title="Ver detalhes"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <ul className="divide-y divide-gray-100">
            {summaryByCategory.map(([type, value]) => (
              <li key={type} className="flex items-center justify-between px-5 py-2.5">
                <span className="text-xs font-bold text-blue-700 uppercase bg-blue-50 px-2 py-0.5 rounded">{type}</span>
                <span className="text-sm font-black text-gray-900">
                  R$ {value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </li>
            ))}
            {summaryByCategory.length > 0 && (
              <li className="flex items-center justify-between px-5 py-2.5 bg-gray-50">
                <span className="text-xs font-black text-gray-700 uppercase">Total</span>
                <span className="text-sm font-black text-gray-900">
                  R$ {summaryTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </li>
            )}
          </ul>
          {summaryByCategory.length === 0 && (
            <div className="p-10 text-center text-gray-400 text-sm">Nenhum gasto encontrado.</div>
          )}
        </div>

        {/* Receitas */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Receitas</h2>
            <p className="text-[10px] text-gray-400 italic">* Recebidas no mês.</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {monthIncomes.map((income) => (
              <li key={income._id} className="flex items-center justify-between px-5 py-2.5 gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 font-semibold truncate">{income.name}</p>
                  <p className="text-[10px] text-gray-400 uppercase font-bold">
                    {new Date(`${income.date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} · {income.type}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-black text-gray-900">
                    R$ {income.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                  <button
                    onClick={() => income._id && handleDeleteIncome(income._id)}
                    className="text-red-400 hover:text-red-600 transition-colors p-1"
                    title="Excluir receita"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {monthIncomes.length === 0 && (
            <div className="p-10 text-center text-gray-400 text-sm">Nenhuma receita encontrada.</div>
          )}
        </div>
      </div>
    </div>
  );
}
