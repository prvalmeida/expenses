'use client';

import { IncomeForm, IncomeTypes, IncomeType } from "@/types";
import { useState } from "react";

export default function AddIncome({ onIncomeAdded }: { onIncomeAdded: () => void }) {
  const [incomeForm, setIncomeForm] = useState<IncomeForm>({
    name: '',
    value: '',
    type: '',
    date: new Date().toISOString().split('T')[0]
  });

  const handleAddIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (incomeForm.value === '' || !incomeForm.name || !incomeForm.type || !incomeForm.date) return;

    const res = await fetch('/api/income', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: incomeForm.name,
        value: incomeForm.value,
        type: incomeForm.type,
        date: incomeForm.date
      })
    });

    if (res.ok) {
      setIncomeForm({
        name: '',
        value: '',
        type: '',
        date: new Date().toISOString().split('T')[0]
      });
      onIncomeAdded();
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 border rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Adicionar Receita</h2>
      <form onSubmit={handleAddIncome} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Nome</label>
          <input
            type="text"
            value={incomeForm.name}
            onChange={(e) => setIncomeForm({ ...incomeForm, name: e.target.value })}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Valor</label>
          <input
            type="number"
            step="0.01"
            value={incomeForm.value}
            onChange={(e) => setIncomeForm({ ...incomeForm, value: parseFloat(e.target.value) || '' })}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Tipo</label>
          <select
            value={incomeForm.type}
            onChange={(e) => setIncomeForm({ ...incomeForm, type: e.target.value as IncomeType | '' })}
            className="w-full p-2 border rounded"
            required
          >
            <option value="">Selecione</option>
            {IncomeTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Data</label>
          <input
            type="date"
            value={incomeForm.date}
            onChange={(e) => setIncomeForm({ ...incomeForm, date: e.target.value })}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
          Adicionar
        </button>
      </form>
    </div>
  );
}
