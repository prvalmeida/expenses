'use client';

import { ExpenseForm } from "@/types";
import { useCategories } from "@/hooks/useCategories";

interface ExpenseTypeSelectProps {
  expense: ExpenseForm;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

export default function ExpenseTypeSelect({ expense, onChange }: ExpenseTypeSelectProps) {
  const { expenseTypes, subtypesFor, loading } = useCategories();
  const subtypes = expense.type ? subtypesFor(expense.type) : [];
  const typeInvalid = !loading && !!expense.type && !expenseTypes.includes(expense.type);
  const subtypeInvalid = !loading && !typeInvalid && !!expense.subtype && !subtypes.includes(expense.subtype);

  return (
    <div className="space-y-4">
      <select
        name="type"
        value={typeInvalid ? "" : expense.type}
        onChange={onChange}
        className="w-full p-2 border rounded"
      >
        <option value="">Selecione o tipo</option>
        {[...expenseTypes]
          .sort((a, b) => a.localeCompare(b))
          .map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
      </select>
      {typeInvalid && (
        <p className="text-xs text-amber-700">
          ⚠ Categoria atual &ldquo;{expense.type}&rdquo; não existe mais — selecione uma válida.
        </p>
      )}
      {expense.type && !typeInvalid && subtypes.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">Subtipo</label>
          <select
            name="subtype"
            value={subtypeInvalid ? "" : expense.subtype || ""}
            onChange={onChange}
            className="w-full p-2 border rounded"
          >
            <option value="">Selecione o subtipo (opcional)</option>
            {[...subtypes]
              .sort((a, b) => a.localeCompare(b))
              .map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
          </select>
          {subtypeInvalid && (
            <p className="text-xs text-amber-700 mt-1">
              ⚠ Subcategoria atual &ldquo;{expense.subtype}&rdquo; não existe mais — selecione uma válida.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
