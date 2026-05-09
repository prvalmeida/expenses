'use client';

import { CardBrand, Expense, ExpenseForm, ExpenseSubtypes } from '@/types';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import ExpenseTypeSelect from './ExpenseTypeSelect';

type EditForm = ExpenseForm & { effectiveDate: string };

interface Props {
  expense: Expense;
  onSave: (updated: Expense) => void;
  onClose: () => void;
}

export default function EditExpenseModal({ expense, onSave, onClose }: Props) {
  const [form, setForm] = useState<EditForm>({
    name: expense.name,
    value: expense.value,
    type: expense.type,
    subtype: expense.subtype ?? '',
    paymentType: expense.paymentType,
    cardBrand: expense.paymentType === 'credit' ? expense.cardBrand : undefined,
    date: expense.date,
    installments: expense.paymentType === 'credit' ? expense.totalInstallments : undefined,
    effectiveDate: expense.effectiveDate,
  });
  const [saving, setSaving] = useState(false);

  const isInstallment = expense.paymentType === 'credit' && (expense.totalInstallments ?? 0) > 1;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => {
      switch (name) {
        case 'value':
          return { ...prev, value: value === '' ? '' : parseFloat(value) };
        case 'type':
          return { ...prev, type: value as keyof typeof ExpenseSubtypes | '', subtype: '' };
        case 'paymentType':
          return { ...prev, paymentType: value as ExpenseForm['paymentType'] };
        case 'cardBrand':
          return { ...prev, cardBrand: value === '' ? undefined : value as CardBrand };
        default:
          return { ...prev, [name]: value };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expense._id) {
      alert('ID do gasto não encontrado.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/expenses/${expense._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          value: form.value === '' ? 0 : form.value,
          type: form.type,
          subtype: form.subtype,
          paymentType: form.paymentType,
          cardBrand: form.cardBrand,
          date: form.date,
          effectiveDate: form.effectiveDate,
        }),
      });

      if (res.ok) {
        const updated: Expense = await res.json();
        onSave(updated);
      } else {
        alert(`Erro ao atualizar o gasto: ${res.statusText}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Editar Gasto</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
          {isInstallment && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
              Esta edição afeta apenas esta parcela ({expense.installment}/{expense.totalInstallments}).
            </p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nome</label>
              <input type="text" name="name" value={form.name} onChange={handleChange} className="w-full p-2 border rounded" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Valor</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <span className="text-gray-500">R$</span>
                </div>
                <input type="number" name="value" value={form.value} onChange={handleChange} className="w-full p-2 pl-10 border rounded" min="0" step="0.01" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo</label>
              <ExpenseTypeSelect expense={form} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo de Pagamento</label>
              <select name="paymentType" value={form.paymentType} onChange={handleChange} className="w-full p-2 border rounded" required>
                <option value="">Selecione o tipo de pagamento</option>
                <option value="credit">Crédito</option>
                <option value="debit">Débito</option>
                <option value="cash">PIX</option>
                <option value="other">Dinheiro</option>
                <option value="food-voucher">Vale Alimentação</option>
                <option value="meal-voucher">Vale Refeição</option>
                <option value="fuel-voucher">Vale Combustível</option>
              </select>
            </div>
            {form.paymentType === 'credit' && (
              <div>
                <label className="block text-sm font-medium mb-1">Cartão Utilizado</label>
                <select name="cardBrand" value={form.cardBrand ?? ''} onChange={handleChange} className="w-full p-2 border rounded" required>
                  <option value="">Selecione o cartão</option>
                  {Object.entries(CardBrand).map(([key, value]) => (
                    <option key={key} value={value}>{value}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Data da Compra</label>
              <input type="date" name="date" value={form.date} onChange={handleChange} className="w-full p-2 border rounded" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Data Efetiva</label>
              <input type="date" name="effectiveDate" value={form.effectiveDate} onChange={handleChange} className="w-full p-2 border rounded" required />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded text-sm font-bold hover:bg-gray-50">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
