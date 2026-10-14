'use client';

import { useState } from 'react';
import ExpenseTypeSelect from '@/components/ExpenseTypeSelect';
import { CardBrand, ExpenseForm } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, Notice } from '@/components/ui/display';
import { Select, TextField } from '@/components/ui/controls';
import { PAYMENT_OPTIONS } from '@/lib/utils/money';
import { todayLocal } from '@/lib/utils/monthUtils';

const CARD_OPTIONS = Object.values(CardBrand).map(v => ({ value: v, label: v }));

export default function AddExpense({ onExpenseAdded }: { onExpenseAdded: () => void }) {
  const [expense, setExpense] = useState<ExpenseForm>({
    name: '',
    value: '',
    type: '',
    subtype: '',
    paymentType: '',
    cardBrand: undefined,
    date: todayLocal(),
    installments: 1
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError('Escolha o cartão usado na compra.');
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

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onExpenseAdded();
      } else {
        const { error: message } = await res.json().catch(() => ({ error: null }));
        console.error('Failed to create expense:', message);
        setError(`Não foi possível salvar o gasto.${message ? ` ${message}` : ''}`);
      }
    } catch (err) {
      console.error('Network error:', err);
      setError('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  const isCredit = expense.paymentType === 'credit';

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4">
      <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em]">Novo gasto</h1>
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <Notice tone="error" title={error} />}
          <TextField label="Descrição" name="name" value={expense.name} onChange={handleChange} placeholder="Padaria Barcelos" required />
          <div className={`grid gap-4 ${isCredit ? 'grid-cols-2' : ''}`}>
            <TextField
              label={isCredit ? 'Valor total' : 'Valor'}
              prefix="R$"
              type="number"
              inputMode="decimal"
              name="value"
              value={expense.value}
              onChange={handleChange}
              min="0"
              step="0.01"
              required
            />
            {isCredit && (
              <TextField
                label="Parcelas"
                type="number"
                inputMode="numeric"
                name="installments"
                value={expense.installments ?? ''}
                onChange={handleChange}
                min="1"
                required
              />
            )}
          </div>
          <ExpenseTypeSelect expense={expense} onChange={handleChange} />
          <Select
            label="Forma de pagamento"
            name="paymentType"
            value={expense.paymentType}
            onChange={handleChange}
            required
            placeholder="Escolha a forma de pagamento"
            options={PAYMENT_OPTIONS}
          />
          {isCredit && (
            <Select
              label="Cartão"
              name="cardBrand"
              value={expense.cardBrand ?? ''}
              onChange={handleChange}
              required
              placeholder="Escolha o cartão"
              options={CARD_OPTIONS}
            />
          )}
          <TextField
            label="Data da compra"
            type="date"
            name="date"
            value={expense.date}
            onChange={handleChange}
            required
            hint={isCredit ? 'No cartão, cada parcela conta no fluxo de caixa do mês da fatura.' : undefined}
          />
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar gasto'}</Button>
        </form>
      </Card>
    </div>
  );
}
