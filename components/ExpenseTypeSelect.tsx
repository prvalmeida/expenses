'use client';

import { ExpenseForm, ExpenseSubtypes } from "@/types";

interface ExpenseTypeSelectProps {
  expense: ExpenseForm;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

export default function ExpenseTypeSelect({ expense, onChange }: ExpenseTypeSelectProps) {
  return (
    <div className="space-y-4">
      <select
        name="type"
        value={expense.type}
        onChange={onChange}
        className="w-full p-2 border rounded"
      >
        <option value="">Selecione o tipo</option>
        {Object.keys(ExpenseSubtypes)
          .sort((a, b) => a.localeCompare(b)) // Sorts strings alphabetically
          .map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
      </select>
      {/* Subtype Selection - Only shows if Type is selected */}
      {expense.type && ExpenseSubtypes[expense.type as keyof typeof ExpenseSubtypes] && (
        <div>
          <label className="block text-sm font-medium mb-1">Subtipo</label>
          <select
            name="subtype"
            value={expense.subtype || ""}
            onChange={onChange}
            className="w-full p-2 border rounded"
          >
            <option value="">Selecione o subtipo (opcional)</option>
            {[...ExpenseSubtypes[expense.type as keyof typeof ExpenseSubtypes]] // Spread into a new array to avoid mutating 'as const'
              .sort((a, b) => a.localeCompare(b))
              .map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
}