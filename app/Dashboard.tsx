'use client';

import { Expense, Income } from "@/types";
import { useCallback, useEffect, useState } from "react";
import ExpenseCharts from "../components/ExpenseCharts";

export default function DashBoard() {
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [filteredExpenses, setFilteredExpenses] = useState<Expense[]>([]);
  const [totalThisMonth, setTotalThisMonth] = useState(0);
  const [showDetailedView, setShowDetailedView] = useState<boolean>(false);
  const [showIncomeView, setShowIncomeView] = useState<boolean>(false);
  
  // Income states
  const [allIncomes, setAllIncomes] = useState<Income[]>([]);
  const [totalIncomeThisMonth, setTotalIncomeThisMonth] = useState(0);
  
  // Toggle: 'purchase' (Data da Compra) vs 'payment' (Fluxo de Caixa)
  const [viewMode, setViewMode] = useState<'purchase' | 'payment'>('purchase');
  const [showCharts, setShowCharts] = useState(false);
  
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const filterAndCalculate = useCallback((expenses: Expense[], mode: 'purchase' | 'payment') => {
    const [year, month] = selectedMonth.split('-').map(Number);

    const filtered = expenses.filter(expense => {
      // Both are now guaranteed YYYY-MM-DD
      const dateStr = mode === 'payment' ? expense.effectiveDate : expense.date;
      const expenseDate = new Date(`${dateStr}T12:00:00Z`);
      
      return (
        expenseDate.getUTCMonth() === month - 1 && 
        expenseDate.getUTCFullYear() === year
      );
    });

    setTotalThisMonth(filtered.reduce((sum, exp) => sum + exp.value, 0));
    setFilteredExpenses(filtered);
  }, [selectedMonth]);

  const filterIncomes = useCallback(() => {
    const [year, month] = selectedMonth.split('-').map(Number);

    const filtered = allIncomes.filter(income => {
      const incomeDate = new Date(`${income.date}T12:00:00Z`);
      
      return (
        incomeDate.getUTCMonth() === month - 1 && 
        incomeDate.getUTCFullYear() === year
      );
    });

    setTotalIncomeThisMonth(filtered.reduce((sum, inc) => sum + inc.value, 0));
  }, [selectedMonth, allIncomes]);

  const onExpenseDeleted = (id: string, deleteAll: boolean) => {
    setAllExpenses(prev => {
      // 1. Pegamos a despesa que vai ser deletada para saber o transactionId dela
      const targetExpense = prev.find(e => e._id === id);
      let newAllExpenses;
      
      if (deleteAll && targetExpense?.transactionId) {
        newAllExpenses = prev.filter(exp => exp.transactionId !== targetExpense.transactionId);
      } else {
        newAllExpenses = prev.filter(exp => exp._id !== id);
      }

      filterAndCalculate(newAllExpenses, viewMode);

      return newAllExpenses;
    });
  };

  const handleDelete = async (id: string, hasMultiple: boolean) => {
    let url = `/api/expenses/${id}`;
    
    let choice: boolean = false
    if (hasMultiple) {
      choice = confirm("Este gasto é parcelado. Deseja excluir TODAS as parcelas? (OK para todas, Cancelar para apenas esta)");
      if (choice) url += "?all=true";
    } else {
      if (!confirm("Excluir este gasto?")) return;
    }

    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) {
      onExpenseDeleted(id, hasMultiple && choice); 
    }
  };

  const onIncomeDeleted = (id: string) => {
    setAllIncomes(prev => prev.filter(inc => inc._id !== id));
    filterIncomes();
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
        filterAndCalculate(data, viewMode);
      }

      const incomeResponse = await fetch('/api/income');
      if (incomeResponse.ok) {
        const incomeData: Income[] = await incomeResponse.json();
        console.log(`incomeData: ${JSON.stringify(incomeData)}`)
        setAllIncomes(incomeData);
      }
    };
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, viewMode]);

  useEffect(() => {
    filterIncomes();
  }, [filterIncomes]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-2xl font-bold">Dashboard de Gastos</h1>
        
        {/* Switcher de Visualização */}
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

      {/* Card de Resumo Financeiro */}
      <div className={`p-6 rounded-xl border-l-4 shadow-sm bg-white transition-all ${viewMode === 'purchase' ? 'border-blue-500' : 'border-green-500'}`}>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">
          Total {viewMode === 'purchase' ? 'em Gastos' : 'a Pagar'} (Mês Selecionado)
        </p>
        <p className="text-3xl font-black mt-1 text-gray-900">
          R$ {totalThisMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </p>
        <p className="text-[10px] text-gray-400 mt-2 italic">
          {viewMode === 'purchase' 
            ? "* Mostra o quanto você decidiu gastar neste mês." 
            : "* Mostra o quanto sairá efetivamente da sua conta (faturas e débitos)."}
        </p>
      </div>

      {/* Card de Receitas */}
      <div className="p-6 rounded-xl border-l-4 border-purple-500 shadow-sm bg-white">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">
          Total em Receitas (Mês Selecionado)
        </p>
        <p className="text-3xl font-black mt-1 text-gray-900">
          R$ {totalIncomeThisMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </p>
        <p className="text-[10px] text-gray-400 mt-2 italic">
          * Receitas recebidas neste mês.
        </p>
      </div>

      {/* Card de Poupança */}
      {viewMode === 'payment' && (
        <div className="p-6 rounded-xl border-l-4 border-yellow-500 shadow-sm bg-white">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">
            Poupança (Mês Selecionado)
          </p>
          <p className={`text-3xl font-black mt-1 ${totalIncomeThisMonth - totalThisMonth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            R$ {(totalIncomeThisMonth - totalThisMonth).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-gray-400 mt-2 italic">
            * Diferença entre receitas e gastos efetivos.
          </p>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col sm:flex-row items-end gap-4">
        <div className="w-full sm:w-48">
          <label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Mês de Referência</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm text-sm p-2 border"
          />
        </div>
        <button 
          onClick={() => setShowDetailedView(!showDetailedView)}
          className="bg-gray-800 text-white px-4 py-2 rounded text-sm font-bold hover:bg-gray-700"
        >
          {showDetailedView ? "OCULTAR GASTOS" : "VER GASTOS"}
        </button>
        <button 
          onClick={() => setShowIncomeView(!showIncomeView)}
          className="bg-purple-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-purple-700"
        >
          {showIncomeView ? "OCULTAR RECEITAS" : "VER RECEITAS"}
        </button>
        <button
          onClick={() => setShowCharts(!showCharts)}
          className="bg-green-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-green-700"
        >
          {showCharts ? "OCULTAR DETALHES" : "VER DETALHES"}
        </button>
      </div>

      {showDetailedView && (
        <div className="bg-white shadow ring-1 ring-black ring-opacity-5 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-bold text-gray-500 uppercase">Data</th>
                <th className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase">Nome</th>
                <th className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase">Categoria</th>
                <th className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase">Pagamento</th>
                <th className="px-3 py-3 text-right text-xs font-bold text-gray-500 uppercase">Valor</th>
                <th className="px-3 py-3 text-center text-xs font-bold text-gray-500 uppercase">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredExpenses
                .sort((a, b) => {
                  const dateA = viewMode === 'purchase' ? a.date : a.effectiveDate;
                  const dateB = viewMode === 'purchase' ? b.date : b.effectiveDate;
                  return new Date(dateB).getTime() - new Date(dateA).getTime();
                })
                .map((expense) => (
                <tr key={expense._id} className="hover:bg-gray-50 transition-colors">
                  <td className="whitespace-nowrap py-4 px-4 text-sm text-gray-600 font-medium">
                    {new Date(`${viewMode === 'purchase' ? expense.date : expense.effectiveDate}T12:00:00Z`)
                      .toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                  </td>
                  <td className="px-3 py-4 text-sm text-gray-900 font-semibold">{expense.name}</td>
                  <td className="px-3 py-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-blue-700 uppercase bg-blue-50 px-1.5 py-0.5 rounded w-fit">
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
                    R$ {expense.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-4 text-center">
                    <button
                      onClick={() => {
                        if (expense._id) {
                          // Verificamos se há mais de uma parcela para decidir a lógica de exclusão
                          const isInstallment = (expense.totalInstallments ?? 0) > 1;
                          handleDelete(expense._id, isInstallment);
                        }
                      }}
                      className="text-red-400 hover:text-red-600 transition-colors p-1"
                      title={expense.totalInstallments && expense.totalInstallments > 1 ? "Excluir parcelas" : "Excluir despesa"}
                    >
                      <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        className="h-5 w-5" 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={2} 
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" 
                        />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredExpenses.length === 0 && (
            <div className="p-10 text-center text-gray-400 text-sm">Nenhum gasto encontrado.</div>
          )}
        </div>
      )}

      {showCharts && (
        <ExpenseCharts allExpenses={allExpenses} viewMode={viewMode} defaultMonth={selectedMonth} onClose={() => setShowCharts(false)} />
      )}

      {showIncomeView && (
        <div className="bg-white shadow ring-1 ring-black ring-opacity-5 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-bold text-gray-500 uppercase">Data</th>
                <th className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase">Nome</th>
                <th className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase">Tipo</th>
                <th className="px-3 py-3 text-right text-xs font-bold text-gray-500 uppercase">Valor</th>
                <th className="px-3 py-3 text-center text-xs font-bold text-gray-500 uppercase">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {allIncomes
                .filter(income => {
                  const [year, month] = selectedMonth.split('-').map(Number);
                  const incomeDate = new Date(`${income.date}T12:00:00Z`);
                  return incomeDate.getUTCMonth() === month - 1 && incomeDate.getUTCFullYear() === year;
                })
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map((income) => (
                <tr key={income._id} className="hover:bg-gray-50 transition-colors">
                  <td className="whitespace-nowrap py-4 px-4 text-sm text-gray-600 font-medium">
                    {new Date(`${income.date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                  </td>
                  <td className="px-3 py-4 text-sm text-gray-900 font-semibold">{income.name}</td>
                  <td className="px-3 py-4 text-sm text-gray-600 capitalize">{income.type}</td>
                  <td className="px-3 py-4 text-right text-sm font-black text-gray-900">
                    R$ {income.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-4 text-center">
                    <button
                      onClick={() => {
                        if (income._id) {
                          handleDeleteIncome(income._id);
                        }
                      }}
                      className="text-red-400 hover:text-red-600 transition-colors p-1"
                      title="Excluir receita"
                    >
                      <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        className="h-5 w-5" 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={2} 
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" 
                        />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {allIncomes.filter(income => {
            const [year, month] = selectedMonth.split('-').map(Number);
            const incomeDate = new Date(`${income.date}T12:00:00Z`);
            return incomeDate.getUTCMonth() === month - 1 && incomeDate.getUTCFullYear() === year;
          }).length === 0 && (
            <div className="p-10 text-center text-gray-400 text-sm">Nenhuma receita encontrada.</div>
          )}
        </div>
      )}
    </div>
  );
}