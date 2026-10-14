'use client';

import { IncomeForm } from "@/types";
import { useState } from "react";
import { useCategories } from "@/hooks/useCategories";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/display";
import { Select, TextField } from "@/components/ui/controls";
import { todayLocal } from "@/lib/utils/monthUtils";

export default function AddIncome({ onIncomeAdded }: { onIncomeAdded: () => void }) {
  const { incomeTypes } = useCategories();
  const [incomeForm, setIncomeForm] = useState<IncomeForm>({
    name: '',
    value: '',
    type: '',
    date: todayLocal(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (incomeForm.value === '' || !incomeForm.name || !incomeForm.type || !incomeForm.date) return;

    setSaving(true);
    setError(null);
    try {
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
        onIncomeAdded();
      } else {
        const { error: message } = await res.json().catch(() => ({ error: null }));
        setError(`Não foi possível salvar a receita.${message ? ` ${message}` : ''}`);
      }
    } catch {
      setError('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4">
      <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em]">Nova receita</h1>
      <Card>
        <form onSubmit={handleAddIncome} className="flex flex-col gap-4">
          {error && <Notice tone="error" title={error} />}
          <TextField
            label="Descrição"
            value={incomeForm.name}
            onChange={(e) => setIncomeForm({ ...incomeForm, name: e.target.value })}
            placeholder="Salário de outubro"
            required
          />
          <TextField
            label="Valor"
            prefix="R$"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={incomeForm.value}
            onChange={(e) => setIncomeForm({ ...incomeForm, value: parseFloat(e.target.value) || '' })}
            required
          />
          <Select
            label="Tipo"
            value={incomeForm.type}
            onChange={(e) => setIncomeForm({ ...incomeForm, type: e.target.value })}
            required
            placeholder="Escolha o tipo"
            options={incomeTypes.map(t => ({ value: t, label: t }))}
          />
          <TextField
            label="Data do recebimento"
            type="date"
            value={incomeForm.date}
            onChange={(e) => setIncomeForm({ ...incomeForm, date: e.target.value })}
            required
          />
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar receita'}</Button>
        </form>
      </Card>
    </div>
  );
}
