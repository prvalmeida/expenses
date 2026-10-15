'use client';

import { CardBrand, Expense, ExpenseForm } from '@/types';
import { useId, useState } from 'react';
import ExpenseTypeSelect from './ExpenseTypeSelect';
import Sheet from '@/components/shell/Sheet';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/display';
import { Select, TextField } from '@/components/ui/controls';

type EditForm = ExpenseForm & { effectiveDate: string };

interface Props {
  expense: Expense;
  originalDate?: string;
  onSave: (updated: Expense | Expense[]) => void;
  onClose: () => void;
}

const PAYMENT_OPTIONS = [
  { value: 'credit', label: 'Crédito' },
  { value: 'debit', label: 'Débito' },
  { value: 'pix', label: 'Pix' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'food-voucher', label: 'Vale-alimentação' },
  { value: 'meal-voucher', label: 'Vale-refeição' },
  { value: 'fuel-voucher', label: 'Vale-combustível' },
];

const CARD_OPTIONS = Object.values(CardBrand).map(v => ({ value: v, label: v }));

export default function EditExpenseModal({ expense, originalDate, onSave, onClose }: Props) {
  const isInstallment = expense.paymentType === 'credit' && (expense.totalInstallments ?? 0) > 1;
  const formId = useId();

  const [form, setForm] = useState<EditForm>({
    name: expense.name,
    value: isInstallment
      ? Math.round(expense.value * (expense.totalInstallments ?? 1) * 100) / 100
      : expense.value,
    type: expense.type,
    subtype: expense.subtype ?? '',
    paymentType: expense.paymentType,
    cardBrand: expense.paymentType === 'credit' ? expense.cardBrand : undefined,
    date: isInstallment ? (originalDate ?? expense.date) : expense.date,
    installments: expense.paymentType === 'credit' ? expense.totalInstallments : undefined,
    effectiveDate: expense.effectiveDate,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => {
      switch (name) {
        case 'value':
          return { ...prev, value: value === '' ? '' : parseFloat(value) };
        case 'installments':
          return { ...prev, installments: value === '' ? undefined : parseInt(value) };
        case 'type':
          return { ...prev, type: value, subtype: '' };
        case 'paymentType':
          return { ...prev, paymentType: value as ExpenseForm['paymentType'] };
        case 'cardBrand':
          return { ...prev, cardBrand: value === '' ? undefined : value as CardBrand };
        default:
          return { ...prev, [name]: value };
      }
    });
  };

  // Dismissing mid-request would lose the edit and strand its error behind a sheet that
  // no longer exists, so every close path waits for the save to settle.
  const close = () => {
    if (!saving) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expense._id) {
      setError('Não foi possível identificar este gasto. Recarregue a página.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isInstallment) {
        const res = await fetch('/api/expenses/installment-group', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId: expense.transactionId,
            totalValue: form.value === '' ? 0 : form.value,
            installmentCount: form.installments ?? 1,
            originalDate: form.date,
            name: form.name,
            type: form.type,
            subtype: form.subtype,
            paymentType: form.paymentType,
            cardBrand: form.cardBrand,
          }),
        });
        if (res.ok) {
          const updated: Expense[] = await res.json();
          onSave(updated);
        } else {
          setError(`Não foi possível salvar as parcelas (${res.status}). Confira os campos e tente de novo.`);
        }
      } else {
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
            ...(form.paymentType !== 'credit' && { effectiveDate: form.effectiveDate }),
          }),
        });
        if (res.ok) {
          const updated: Expense = await res.json();
          onSave(updated);
        } else {
          setError(`Não foi possível salvar o gasto (${res.status}). Confira os campos e tente de novo.`);
        }
      }
    } catch {
      setError('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      title={isInstallment ? 'Editar gasto parcelado' : 'Editar gasto'}
      onClose={close}
      footer={
        <>
          <Button className="flex-1 sm:flex-none" onClick={close} disabled={saving}>Cancelar</Button>
          <Button className="flex-1 sm:ml-auto sm:flex-none" variant="primary" type="submit" form={formId} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
        {isInstallment && (
          <Notice tone="info">
            Você está editando as {expense.totalInstallments} parcelas juntas. Valor total e data inicial valem para todas.
          </Notice>
        )}
        {error && <Notice tone="error" title={error} />}

        <TextField label="Descrição" name="name" value={form.name} onChange={handleChange} required />

        <div className={`grid gap-4 ${isInstallment ? 'grid-cols-2' : ''}`}>
          <TextField
            label={isInstallment ? 'Valor total' : 'Valor'}
            prefix="R$"
            type="number"
            inputMode="decimal"
            name="value"
            value={form.value}
            onChange={handleChange}
            min="0"
            step="0.01"
            required
          />
          {isInstallment && (
            <TextField
              label="Parcelas"
              type="number"
              inputMode="numeric"
              name="installments"
              value={form.installments ?? ''}
              onChange={handleChange}
              min="1"
              required
            />
          )}
        </div>

        <ExpenseTypeSelect expense={form} onChange={handleChange} />

        <Select
          label="Forma de pagamento"
          name="paymentType"
          value={form.paymentType}
          onChange={handleChange}
          required
          placeholder="Escolha a forma de pagamento"
          options={PAYMENT_OPTIONS}
        />

        {form.paymentType === 'credit' && (
          <Select
            label="Cartão"
            name="cardBrand"
            value={form.cardBrand ?? ''}
            onChange={handleChange}
            required
            placeholder="Escolha o cartão"
            options={CARD_OPTIONS}
          />
        )}

        <div className={`grid gap-4 ${form.paymentType !== 'credit' ? 'sm:grid-cols-2' : ''}`}>
          <TextField
            label={isInstallment ? 'Data da primeira parcela' : 'Data da compra'}
            type="date"
            name="date"
            value={form.date}
            onChange={handleChange}
            required
          />
          {form.paymentType !== 'credit' && (
            <TextField
              label="Data do pagamento"
              type="date"
              name="effectiveDate"
              value={form.effectiveDate}
              onChange={handleChange}
              required
              hint="Conta no fluxo de caixa deste dia."
            />
          )}
        </div>
      </form>
    </Sheet>
  );
}
