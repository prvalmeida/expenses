'use client';

import { useState, useEffect } from 'react';
import { CardBrand } from '@/types';

interface ConfigState {
  [key: string]: {
    closingDate: string;
    dueDate: string;
  };
}

export default function CardConfigPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Initialize state for all card brands
  const [cardConfigs, setCardConfigs] = useState<ConfigState>({});
  const [loading, setLoading] = useState(false);

  // Fetch data whenever the month changes
  useEffect(() => {
    const fetchConfigs = async () => {
      setLoading(true);
      const [year, month] = selectedMonth.split('-');
      
      const newConfigs: ConfigState = {};

      // Fetch each card's config (or get defaults from API)
      for (const brand of Object.values(CardBrand)) {
        const res = await fetch(`/api/card-cycles?brand=${brand}&month=${month}&year=${year}`);
        const data = await res.json();
        newConfigs[brand] = {
          closingDate: data.closingDate,
          dueDate: data.dueDate,
        };
      }
      setCardConfigs(newConfigs);
      setLoading(false);
    };

    fetchConfigs();
  }, [selectedMonth]);

  const handleInputChange = (brand: string, field: 'closingDate' | 'dueDate', value: string) => {
    setCardConfigs((prev) => ({
      ...prev,
      [brand]: {
        ...prev[brand],
        [field]: value,
      },
    }));
  };

  const handleSave = async (brand: string) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const config = cardConfigs[brand];

    const response = await fetch('/api/card-cycles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardBrand: brand,
        month,
        year,
        closingDate: config.closingDate,
        dueDate: config.dueDate,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const recalculated: number = data.updatedExpenses ?? 0;
      const message = recalculated > 0
        ? `${brand} atualizado. ${recalculated} despesa(s) com data efetiva recalculada.`
        : `${brand} atualizado com sucesso!`;
      alert(message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-2xl font-bold mb-6 text-gray-800">Ajustar Fechamento de Cartão</h1>
      
      <div className="mb-8 p-4 bg-blue-50 rounded-md border border-blue-100">
        <label htmlFor="month-select" className="block text-sm font-semibold text-blue-900 mb-2">
          Selecione o Mês de Referência
        </label>
        <input 
          id="month-select"
          type="month" 
          value={selectedMonth} 
          onChange={e => setSelectedMonth(e.target.value)}
          className="p-2 border rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <p className="text-xs text-blue-700 mt-2">
          * Ajuste as datas caso o fechamento ou vencimento caia em feriados ou fins de semana.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Carregando configurações...</div>
      ) : (
        <div className="space-y-6">
          {Object.values(CardBrand).map((brand) => (
            <div key={brand} className="flex flex-col sm:flex-row gap-4 items-end p-4 border rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex-1">
                <span className="block text-lg font-semibold text-gray-700">{brand}</span>
              </div>
              
              <div className="flex-1 w-full">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Corte (Fechamento)</label>
                <input 
                  type="date" 
                  value={cardConfigs[brand]?.closingDate || ""} 
                  onChange={(e) => handleInputChange(brand, 'closingDate', e.target.value)}
                  className="w-full border p-2 rounded focus:border-blue-500 outline-none"
                />
              </div>

              <div className="flex-1 w-full">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Vencimento (Pagamento)</label>
                <input 
                  type="date" 
                  value={cardConfigs[brand]?.dueDate || ""} 
                  onChange={(e) => handleInputChange(brand, 'dueDate', e.target.value)}
                  className="w-full border p-2 rounded focus:border-blue-500 outline-none"
                />
              </div>

              <button 
                onClick={() => handleSave(brand)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded font-medium transition-colors w-full sm:w-auto"
              >
                Salvar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}