'use client';

import { ExpenseForm } from "@/types";
import { useCategories } from "@/hooks/useCategories";
import { FieldMessage, Select } from "@/components/ui/controls";

interface ExpenseTypeSelectProps {
  expense: ExpenseForm;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

const byName = (a: string, b: string) => a.localeCompare(b);

export default function ExpenseTypeSelect({ expense, onChange }: ExpenseTypeSelectProps) {
  const { expenseTypes, subtypesFor, loading } = useCategories();
  const subtypes = expense.type ? subtypesFor(expense.type) : [];
  const typeInvalid = !loading && !!expense.type && !expenseTypes.includes(expense.type);
  const subtypeInvalid = !loading && !typeInvalid && !!expense.subtype && !subtypes.includes(expense.subtype);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Select
          label="Categoria"
          name="type"
          value={typeInvalid ? "" : expense.type}
          onChange={onChange}
          placeholder="Escolha a categoria"
          options={[...expenseTypes].sort(byName).map(t => ({ value: t, label: t }))}
        />
        {typeInvalid && (
          <FieldMessage tone="warning">
            A categoria &ldquo;{expense.type}&rdquo; não existe mais. Escolha outra.
          </FieldMessage>
        )}
        {/* A category with no subtypes cannot satisfy the mandatory field, so it
            is called out here rather than failing as a 400 on submit. */}
        {expense.type && !typeInvalid && !loading && subtypes.length === 0 && (
          <FieldMessage tone="warning">
            A categoria &ldquo;{expense.type}&rdquo; não tem subcategorias. Cadastre uma em Ajustes › Categorias antes de lançar um gasto nela.
          </FieldMessage>
        )}
      </div>
      {expense.type && !typeInvalid && subtypes.length > 0 && (
        <div className="flex flex-col gap-1">
          <Select
            label="Subcategoria"
            name="subtype"
            value={subtypeInvalid ? "" : expense.subtype || ""}
            onChange={onChange}
            required
            placeholder="Escolha a subcategoria"
            options={[...subtypes].sort(byName).map(s => ({ value: s, label: s }))}
          />
          {subtypeInvalid && (
            <FieldMessage tone="warning">
              A subcategoria &ldquo;{expense.subtype}&rdquo; não existe mais. Escolha outra.
            </FieldMessage>
          )}
        </div>
      )}
    </div>
  );
}
