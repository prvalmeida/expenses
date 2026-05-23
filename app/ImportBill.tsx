'use client';

import { useEffect, useRef, useState } from 'react';
import { CardBrand, ExpenseSubtypes, NewBillMapping, ParsedBillItem } from '@/types';

type BillParseResponse = {
  items: ParsedBillItem[];
  cardBrand: CardBrand;
  closingDate: string | null;
  dueDate: string | null;
};

type ItemState = ParsedBillItem & {
  resolvedDescription: string;
  resolvedValue: number;
  resolvedType: keyof typeof ExpenseSubtypes | null;
  resolvedSubtype: string | null;
};

export default function ImportBill({ onDone }: { onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [file, setFile] = useState<File | null>(null);
  const [cardBrand, setCardBrand] = useState<CardBrand | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<BillParseResponse | null>(null);
  const [items, setItems] = useState<ItemState[]>([]);
  const [closingDate, setClosingDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const selectAllBillRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setError(null);
  };

  const handleProcess = async () => {
    if (!file || !cardBrand) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('cardBrand', cardBrand);

      const res = await fetch('/api/bills/parse', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Erro ao processar fatura');
        return;
      }

      const response = data as BillParseResponse;
      setParsed(response);
      setClosingDate(response.closingDate ?? null);
      setDueDate(response.dueDate ?? null);
      setItems(
        response.items.map(item => ({
          ...item,
          resolvedDescription: item.description,
          resolvedValue: item.value,
          resolvedType: item.type,
          resolvedSubtype: item.subtype,
        }))
      );
      setSelectedIndices(new Set());
      setStep(2);
    } catch {
      setError('Erro de rede ao processar a fatura');
    } finally {
      setLoading(false);
    }
  };

  const updateItem = <K extends keyof ItemState>(index: number, field: K, value: ItemState[K]) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value };
        // Reset subtype when type changes
        if (field === 'resolvedType') {
          updated.resolvedSubtype = null;
        }
        return updated;
      })
    );
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
    setSelectedIndices(new Set());
  };

  const removeBulkItems = () => {
    setItems(prev => prev.filter((_, i) => !selectedIndices.has(i)));
    setSelectedIndices(new Set());
  };

  useEffect(() => {
    if (selectAllBillRef.current) {
      selectAllBillRef.current.indeterminate =
        selectedIndices.size > 0 && selectedIndices.size < items.length;
    }
  }, [selectedIndices, items.length]);

  const unclassifiedCount = items.filter(i => i.resolvedType === null).length;
  const total = items.reduce((s, i) => s + i.resolvedValue, 0);

  // ── Step 1: Upload ───────────────────────────────────────────────────────────
  if (step === 1) {
    const canSubmit = !!file && !!cardBrand;

    return (
      <div className="max-w-md mx-auto p-4 border rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Importar Fatura</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Arquivo PDF da Fatura</label>
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full p-2 border rounded text-sm cursor-pointer bg-white"
            >
              {file === null
                ? <span className="text-gray-400">Selecione um arquivo PDF…</span>
                : file.name}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Cartão</label>
            <select
              value={cardBrand}
              onChange={e => setCardBrand(e.target.value as CardBrand | '')}
              className="w-full p-2 border rounded text-sm"
            >
              <option value="">Selecione o cartão...</option>
              {Object.entries(CardBrand).map(([key, value]) => (
                <option key={key} value={value}>{value}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleProcess}
            disabled={!canSubmit || loading}
            className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
          >
            {loading ? 'Processando...' : 'Processar Fatura'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Review table ─────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-2">Revisar Fatura</h2>
      <div className="text-sm text-gray-600 mb-4 space-y-1">
        <p>
          <span className="font-semibold">Cartão:</span> {parsed?.cardBrand}
          <span className="ml-4 font-semibold">Transações:</span> {items.length}
          <span className="ml-4 font-semibold">Total:</span>{' '}
          R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </p>
        <p>
          <span className="font-semibold">Fechamento:</span>{' '}
          {closingDate
            ? new Date(`${closingDate}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
            : <span className="text-amber-600">Não detectado — ciclo padrão será usado</span>}
          {dueDate && (
            <>
              <span className="ml-4 font-semibold">Vencimento:</span>{' '}
              {new Date(`${dueDate}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
            </>
          )}
        </p>
      </div>

      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2 border border-gray-200 w-8 text-center">
                <input
                  type="checkbox"
                  ref={selectAllBillRef}
                  checked={items.length > 0 && selectedIndices.size === items.length}
                  onChange={(e) => {
                    setSelectedIndices(e.target.checked ? new Set(items.map((_, i) => i)) : new Set());
                  }}
                />
              </th>
              <th className="p-2 border border-gray-200 whitespace-nowrap">Data</th>
              <th className="p-2 border border-gray-200">Descrição</th>
              <th className="p-2 border border-gray-200 whitespace-nowrap">Parcela</th>
              <th className="p-2 border border-gray-200">Categoria</th>
              <th className="p-2 border border-gray-200">Subcategoria</th>
              <th className="p-2 border border-gray-200 text-right whitespace-nowrap">Valor</th>
              <th className="p-2 border border-gray-200" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const subtypes = item.resolvedType
                ? ([...ExpenseSubtypes[item.resolvedType]] as string[]).sort()
                : [];

              return (
                <tr
                  key={index}
                  className={
                    item.resolvedType !== null
                      ? 'bg-green-50'
                      : 'bg-amber-50'
                  }
                >
                  <td className="p-1.5 border border-gray-200 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIndices.has(index)}
                      onChange={(e) => {
                        setSelectedIndices(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(index);
                          else next.delete(index);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="p-1.5 border border-gray-200 whitespace-nowrap text-xs text-gray-600">
                    {item.date
                      ? new Date(`${item.date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
                      : '—'}
                  </td>
                  <td className="p-1.5 border border-gray-200">
                    <input
                      type="text"
                      value={item.resolvedDescription}
                      onChange={e => updateItem(index, 'resolvedDescription', e.target.value)}
                      className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white"
                    />
                  </td>
                  <td className="p-1.5 border border-gray-200 text-xs text-center whitespace-nowrap text-gray-600">
                    {item.installmentCurrent !== undefined && item.installmentTotal !== undefined
                      ? `${item.installmentCurrent}/${item.installmentTotal}`
                      : '—'}
                  </td>
                  <td className="p-1.5 border border-gray-200">
                    <select
                      value={item.resolvedType ?? ''}
                      onChange={e =>
                        updateItem(
                          index,
                          'resolvedType',
                          e.target.value === '' ? null : (e.target.value as keyof typeof ExpenseSubtypes)
                        )
                      }
                      className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white"
                    >
                      <option value="">Selecione...</option>
                      {(Object.keys(ExpenseSubtypes).sort() as (keyof typeof ExpenseSubtypes)[]).map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1.5 border border-gray-200">
                    <select
                      value={item.resolvedSubtype ?? ''}
                      onChange={e =>
                        updateItem(index, 'resolvedSubtype', e.target.value === '' ? null : e.target.value)
                      }
                      disabled={!item.resolvedType}
                      className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white disabled:opacity-40"
                    >
                      <option value="">Selecione...</option>
                      {subtypes.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1.5 border border-gray-200">
                    <input
                      type="number"
                      value={item.resolvedValue}
                      min="0"
                      step="0.01"
                      onChange={e =>
                        updateItem(index, 'resolvedValue', parseFloat(e.target.value) || 0)
                      }
                      className="w-24 p-0.5 border rounded text-xs text-right bg-transparent focus:bg-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </td>
                  <td className="p-1.5 border border-gray-200 text-center">
                    <button
                      onClick={() => removeItem(index)}
                      className="text-red-400 hover:text-red-600 font-bold px-2"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {unclassifiedCount > 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
          ⚠ {unclassifiedCount} {unclassifiedCount === 1 ? 'item sem categoria' : 'itens sem categoria'} — {unclassifiedCount === 1 ? 'será importado' : 'serão importados'} sem tipo.
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => setStep(1)}
          className="flex-1 py-2 border border-gray-300 rounded text-sm font-bold hover:bg-gray-50"
        >
          Voltar
        </button>
        {selectedIndices.size > 0 && (
          <button
            onClick={removeBulkItems}
            className="py-2 px-4 bg-red-100 text-red-700 border border-red-300 rounded text-sm font-bold hover:bg-red-200"
          >
            Remover selecionados ({selectedIndices.size})
          </button>
        )}
        <button
          onClick={async () => {
            const confirmed = items.map(item => ({
              date: item.date,
              description: item.resolvedDescription,
              value: item.resolvedValue,
              ...(item.installmentCurrent !== undefined && { installmentCurrent: item.installmentCurrent }),
              ...(item.installmentTotal !== undefined && { installmentTotal: item.installmentTotal }),
              type: item.resolvedType,
              subtype: item.resolvedSubtype,
            }));
            const newMappings: NewBillMapping[] = items
              .filter(
                item =>
                  item.resolvedType !== null &&
                  (item.resolvedType !== item.type || item.resolvedSubtype !== item.subtype)
              )
              .map(item => ({
                description: item.resolvedDescription.toLowerCase().trim(),
                type: item.resolvedType!,
                subtype: item.resolvedSubtype,
              }));
            setLoading(true);
            setError(null);
            try {
              const res = await fetch('/api/bills/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: confirmed, cardBrand, closingDate, dueDate, newMappings }),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error ?? 'Erro ao importar fatura');
                return;
              }
              onDone();
            } catch {
              setError('Erro de rede ao importar a fatura');
            } finally {
              setLoading(false);
            }
          }}
          disabled={items.length === 0 || loading}
          className="flex-1 py-2 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Importando...' : `Confirmar ${items.length} ${items.length === 1 ? 'transação' : 'transações'}`}
        </button>
      </div>
    </div>
  );
}
