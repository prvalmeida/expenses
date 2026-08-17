'use client';

import { useState } from 'react';
import ExpenseTypeSelect from '../components/ExpenseTypeSelect';
import { CardBrand, ExpenseForm } from '../types';

export default function AddExpense({ onExpenseAdded }: { onExpenseAdded: () => void }) {
  const [expense, setExpense] = useState<ExpenseForm>({
    name: '',
    value: '',
    type: '',
    subtype: '',
    paymentType: '',
    cardBrand: undefined,
    date: '',
    installments: 1
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    setExpense((prev) => {
      switch (name) {
        case 'value':
          return { ...prev, value: value === '' ? '' : parseFloat(value) };
        
        case 'installments':
          return { ...prev, installments: value === '' ? undefined : parseInt(value) };
        
        case 'type':
          return {
            ...prev,
            type: value,
            subtype: ''
          };
        
        case 'paymentType':
          return { 
            ...prev, 
            paymentType: value as ExpenseForm['paymentType'] 
          };
        
        case 'cardBrand':
          return { 
            ...prev, 
            cardBrand: value === '' ? undefined : (value as CardBrand) 
          };

        default:
          return { ...prev, [name]: value };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (expense.paymentType === 'credit' && !expense.cardBrand) {
      alert("Favor passar as informações do cartão");
      return;
    }

    const isCredit = expense.paymentType === 'credit';

    // One request for the whole purchase: the server expands the installments
    // and derives every effectiveDate from the card cycle. The optional fields
    // are omitted rather than sent empty — the create schema is a discriminated
    // union that rejects a cardBrand on a non-credit expense.
    const payload = {
      name: expense.name,
      value: expense.value === '' ? 0 : expense.value,
      type: expense.type,
      subtype: expense.subtype,
      paymentType: expense.paymentType,
      date: expense.date,
      ...(isCredit && {
        cardBrand: expense.cardBrand,
        installments: expense.installments ?? 1,
      }),
    };

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setExpense({
          name: '',
          value: 0,
          type: '',
          paymentType: '',
          cardBrand: undefined,
          date: '',
          installments: 1
        });
        onExpenseAdded();
      } else {
        const { error } = await res.json();
        console.error('Failed to create expense:', error);
        alert(`Erro ao salvar o gasto. ${error ?? ''}`);
      }
    } catch (error) {
      console.error("Network error:", error);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 border rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Novo Gasto</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">Nome</label>
          <input
            type="text"
            id="name"
            name="name"
            value={expense.name}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <div>
          <label htmlFor="value" className="block text-sm font-medium mb-1">
            Valor
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <span className="text-gray-500">R$</span>
            </div>

            <input
              type="number"
              id="value"
              name="value"
              value={expense.value}
              onChange={handleChange}
              className="w-full p-2 pl-10 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              min="0"
              step="0.01"
              required
            />
          </div>
        </div>
        <div>
          <label htmlFor="type" className="block text-sm font-medium mb-1">Tipo</label>
          <ExpenseTypeSelect
            expense={expense}
            onChange={handleChange}
          />
        </div>
        <div>
          <label htmlFor="paymentType" className="block text-sm font-medium mb-1">Tipo de Pagamento</label>
          <select
            id="paymentType"
            name="paymentType"
            value={expense.paymentType}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          >
            <option value="">Selecione o tipo de pagamento</option>
            <option value="credit">Crédito</option>
            <option value="debit">Débito</option>
            <option value="pix">PIX</option>
            <option value="cash">Dinheiro</option>
            <option value="food-voucher">Vale Alimentação</option>
            <option value="meal-voucher">Vale Refeição</option>
            <option value="fuel-voucher">Vale Combustível</option>
          </select>
        </div>
        {expense.paymentType === "credit" ? 
          (
            <div className="space-y-4">
              <div>
                <label htmlFor="installments" className="block text-sm font-medium mb-1">Número de Parcelas</label>
                <input
                  type="number"
                  id="installments"
                  name="installments"
                  value={expense.installments ?? ''}
                  onChange={handleChange}
                  className="w-full p-2 border rounded"
                  min="1"
                  required
                />
              </div>
              <div>
                <label htmlFor="cardBrand" className="block text-sm font-medium mb-1">Cartão Utilizado</label>
                <select
                  id="cardBrand"
                  name="cardBrand"
                  value={expense.cardBrand}
                  onChange={handleChange}
                  className="w-full p-2 border rounded"
                  required
                >
                  <option value="">Selecione o cartão utilizado</option>
                  {Object.entries(CardBrand).map(([key, value]) => (
                    <option key={key} value={value}>
                      {value}
                    </option>
                  ))}                
                </select>
              </div>
            </div>
          ) : null
        }
        <div>
          <label htmlFor="date" className="block text-sm font-medium mb-1">Data</label>
          <input
            type="date"
            id="date"
            name="date"
            value={expense.date}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
          Criar
        </button>
      </form>
    </div>
  );
}