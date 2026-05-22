'use client';

import { useCallback, useState } from 'react';
import AddExpense from './AddExpense';
import AddIncome from './AddIncome';
import DashBoard from './Dashboard';
import CardConfigPage from './CardConfig';
import ImportReceipt from './ImportReceipt';
import ImportBill from './ImportBill';

export default function MainPage() {
  // 1. Update the type to include 'cardConfig'
  const [currentView, setCurrentView] = useState<'dashboard' | 'addExpense' | 'addIncome' | 'cardConfig' | 'importReceipt' | 'importBill'>('dashboard');

  const handleExpenseAdded = useCallback(() => {
    setCurrentView('dashboard');
  }, []);

  const handleIncomeAdded = useCallback(() => {
    setCurrentView('dashboard');
  }, []);

  const handleImported = useCallback(() => {
    setCurrentView('dashboard');
  }, []);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-56 bg-gray-200 p-4 border-r border-gray-300">
        <h2 className="text-lg font-bold mb-6 text-gray-800">Financeiro</h2>
        
        <nav className="space-y-3">
          <button
            onClick={() => setCurrentView('dashboard')}
            className={`w-full text-left p-2 rounded transition-colors ${
              currentView === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            📊 Dashboard
          </button>

          <button
            onClick={() => setCurrentView('addExpense')}
            className={`w-full text-left p-2 rounded transition-colors ${
              currentView === 'addExpense' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            ➕ Novo Gasto
          </button>

          <button
            onClick={() => setCurrentView('addIncome')}
            className={`w-full text-left p-2 rounded transition-colors ${
              currentView === 'addIncome' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            ➕ Nova Receita
          </button>

          <hr className="border-gray-400 my-4" />

          <button
            onClick={() => setCurrentView('cardConfig')}
            className={`w-full text-left p-2 rounded transition-colors ${
              currentView === 'cardConfig' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            💳 Fechamento Cartão
          </button>

          <button
            onClick={() => setCurrentView('importReceipt')}
            className={`w-full text-left p-2 rounded transition-colors ${
              currentView === 'importReceipt' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            📄 Importar NF
          </button>

          <button
            onClick={() => setCurrentView('importBill')}
            className={`w-full text-left p-2 rounded transition-colors ${
              currentView === 'importBill' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            💳 Importar Fatura
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        {/* 3. Conditional Rendering Logic */}
        {currentView === 'dashboard' && <DashBoard />}
        
        {currentView === 'addExpense' && (
          <AddExpense onExpenseAdded={handleExpenseAdded} />
        )}
        
        {currentView === 'addIncome' && (
          <AddIncome onIncomeAdded={handleIncomeAdded} />
        )}
        
        {currentView === 'cardConfig' && (
          <CardConfigPage />
        )}

        {currentView === 'importReceipt' && (
          <ImportReceipt onImported={handleImported} />
        )}

        {currentView === 'importBill' && (
          <ImportBill onDone={() => setCurrentView('dashboard')} />
        )}
      </div>
    </div>
  );
}