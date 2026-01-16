'use client';

import { useCallback, useState } from 'react';
import AddExpense from './AddExpense';
import DashBoard from './Dashboard';
import CardConfigPage from './CardConfig'; // Import your new component

export default function MainPage() {
  // 1. Update the type to include 'cardConfig'
  const [currentView, setCurrentView] = useState<'dashboard' | 'addExpense' | 'cardConfig'>('dashboard');

  const handleExpenseAdded = useCallback(() => {
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

          <hr className="border-gray-400 my-4" />

          {/* 2. New Sidebar Button */}
          <button
            onClick={() => setCurrentView('cardConfig')}
            className={`w-full text-left p-2 rounded transition-colors ${
              currentView === 'cardConfig' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            💳 Fechamento Cartão
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
        
        {currentView === 'cardConfig' && (
          <CardConfigPage />
        )}
      </div>
    </div>
  );
}