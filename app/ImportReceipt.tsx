'use client';

import { useState } from 'react';
import { CardBrand, ConfirmedReceiptItem, ExpenseSubtypes, ParsedReceiptItem } from '@/types';

type ParseResponse = {
  store: { cnpj: string; name: string; address: string | null };
  date: string | null;
  paymentType: string | null;
  total?: number;
  discounts?: number;
  amountDue?: number;
  items: ParsedReceiptItem[];
};

type ItemState = ParsedReceiptItem & {
  resolvedValue: number;
  resolvedSubtype?: string;
  resolvedQty?: number;
  resolvedUnitPrice?: number;
};


const PAYMENT_OPTIONS = [
  { value: 'credit', label: 'Crédito' },
  { value: 'pix', label: 'PIX' },
  { value: 'debit', label: 'Débito' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'food-voucher', label: 'Vale Alimentação' },
  { value: 'meal-voucher', label: 'Vale Refeição' },
  { value: 'fuel-voucher', label: 'Vale Combustível' },
];

export default function ImportReceipt({ onImported }: { onImported: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [inputMode, setInputMode] = useState<'pdf' | 'url'>('pdf');
  const [file, setFile] = useState<File | null>(null);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [cardBrand, setCardBrand] = useState<CardBrand | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [items, setItems] = useState<ItemState[]>([]);
  const [importedCount, setImportedCount] = useState(0);

  const switchMode = (mode: 'pdf' | 'url') => {
    setInputMode(mode);
    setFile(null);
    setReceiptUrl('');
    setError(null);
    setCardBrand(undefined);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setError(null);
  };

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const handleParse = async () => {
    const canSubmit = inputMode === 'pdf' ? !!file : receiptUrl.trim().length > 0;
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    try {
      let res: Response;

      if (inputMode === 'pdf') {
        const formData = new FormData();
        formData.append('file', file!);
        res = await fetch('/api/receipts/parse', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/receipts/parse-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: receiptUrl.trim() }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao processar nota fiscal');
        return;
      }
      setParsed(data);
      setPaymentType(data.paymentType ?? '');
      setCardBrand(undefined);
      setItems(
        (data.items as ParsedReceiptItem[]).map(item => ({
          ...item,
          resolvedValue: round2(item.value),
          resolvedSubtype: item.recognized ? (item.subtype ?? '') : undefined,
          ...(item.qty !== undefined && { resolvedQty: item.qty }),
          ...(item.qty !== undefined && item.qty > 0 && { resolvedUnitPrice: round2(item.unitPrice ?? item.value / item.qty) }),
        }))
      );
      setStep(2);
    } catch {
      setError('Erro de rede ao processar a nota');
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (index: number, value: number) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== index) return item;
        return {
          ...item,
          resolvedValue: round2(value),
          ...(item.resolvedQty !== undefined && item.resolvedQty > 0 && {
            resolvedUnitPrice: round2(value / item.resolvedQty),
          }),
        };
      })
    );
  };

  const handleUnitPriceChange = (index: number, unitPrice: number) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== index) return item;
        return {
          ...item,
          resolvedUnitPrice: round2(unitPrice),
          ...(item.resolvedQty !== undefined && item.resolvedQty > 0 && {
            resolvedValue: round2(unitPrice * item.resolvedQty),
          }),
        };
      })
    );
  };

  const handleSubtypeChange = (index: number, subtype: string) => {
    setItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, resolvedSubtype: subtype } : item))
    );
  };

  const allResolved = items.every(item => !!item.resolvedSubtype);

  const handleImport = async () => {
    if (!parsed || !allResolved) return;
    setLoading(true);
    setError(null);
    try {
      const confirmedItems: ConfirmedReceiptItem[] = items.map(item => ({
        description: item.description,
        value: item.resolvedValue,
        type: 'supermercado' as keyof typeof ExpenseSubtypes,
        subtype: item.resolvedSubtype,
        ...(item.resolvedQty !== undefined && { qty: item.resolvedQty }),
        ...(item.unit && { unit: item.unit }),
      }));

      const newMappings: ConfirmedReceiptItem[] = items
        .filter(item => item.resolvedSubtype !== (item.subtype ?? null))
        .map(item => ({
          description: item.description,
          value: item.value,
          type: 'supermercado' as keyof typeof ExpenseSubtypes,
          subtype: item.resolvedSubtype,
        }));

      const res = await fetch('/api/receipts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnpj: parsed.store.cnpj,
          address: parsed.store.address,
          date: parsed.date,
          paymentType,
          ...(paymentType === 'credit' && { cardBrand }),
          items: confirmedItems,
          newMappings,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao importar gastos');
        return;
      }
      setImportedCount(Array.isArray(data) ? data.length : 0);
      setStep(3);
    } catch {
      setError('Erro de rede ao importar gastos');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 1: Input ───────────────────────────────────────────────────────────
  if (step === 1) {
    const canSubmit = inputMode === 'pdf' ? !!file : receiptUrl.trim().length > 0;

    return (
      <div className="max-w-md mx-auto p-4 border rounded-lg shadow-md">
        <h2 className="text-xl font-bold mb-4">Importar Nota Fiscal</h2>

        {/* Mode toggle */}
        <div className="flex bg-gray-200 p-1 rounded-lg mb-4">
          <button
            onClick={() => switchMode('pdf')}
            className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
              inputMode === 'pdf' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600'
            }`}
          >
            📄 Upload PDF
          </button>
          <button
            onClick={() => switchMode('url')}
            className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
              inputMode === 'url' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600'
            }`}
          >
            🔗 Link da Nota
          </button>
        </div>

        <div className="space-y-4">
          {inputMode === 'pdf' ? (
            <div key="pdf">
              <label className="block text-sm font-medium mb-1">Arquivo PDF da Nota Fiscal</label>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="w-full p-2 border rounded text-sm"
              />
            </div>
          ) : (
            <div key="url">
              <label className="block text-sm font-medium mb-1">Link do QR Code da Nota</label>
              <input
                type="url"
                value={receiptUrl}
                onChange={e => { setReceiptUrl(e.target.value); setError(null); }}
                placeholder="https://dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce?p=..."
                className="w-full p-2 border rounded text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Cole o link gerado pelo QR Code da NFC-e (portais *.gov.br).
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleParse}
            disabled={!canSubmit || loading}
            className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
          >
            {loading ? 'Processando...' : 'Processar Nota'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Review ──────────────────────────────────────────────────────────
  if (step === 2 && parsed) {
    const unknownCount = items.filter(i => !i.recognized).length;
    const total = parsed.total ?? items.reduce((s, i) => s + i.resolvedValue, 0);
    const canImport = allResolved && !!paymentType && (paymentType !== 'credit' || !!cardBrand);

    return (
      <div className="max-w-2xl mx-auto p-4">
        <h2 className="text-xl font-bold mb-2">Revisar Itens</h2>
        <div className="text-sm text-gray-600 mb-4 space-y-1">
          <p><span className="font-semibold">Estabelecimento:</span> {parsed.store.name}</p>
          <p><span className="font-semibold">CNPJ:</span> {parsed.store.cnpj}</p>
          {parsed.date && (
            <p>
              <span className="font-semibold">Data:</span>{' '}
              {new Date(`${parsed.date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
            </p>
          )}
          <p>
            <span className="font-semibold">Total:</span>{' '}
            R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          {parsed.discounts !== undefined && (
            <p>
              <span className="font-semibold">Descontos:</span>{' '}
              R$ {parsed.discounts.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          )}
          {parsed.amountDue !== undefined && (
            <p>
              <span className="font-semibold">Valor a Pagar:</span>{' '}
              R$ {parsed.amountDue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          )}
        </div>

        <div className="mb-4 space-y-2">
          <div>
            <label className="block text-sm font-medium mb-1">Forma de Pagamento</label>
            <select
              value={paymentType}
              onChange={e => { setPaymentType(e.target.value); setCardBrand(undefined); }}
              className="w-full p-2 border rounded text-sm"
            >
              <option value="">Selecione...</option>
              {PAYMENT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {paymentType === 'credit' && (
            <div>
              <label className="block text-sm font-medium mb-1">Cartão Utilizado</label>
              <select
                value={cardBrand ?? ''}
                onChange={e => setCardBrand(e.target.value === '' ? undefined : e.target.value as CardBrand)}
                className="w-full p-2 border rounded text-sm"
              >
                <option value="">Selecione o cartão utilizado</option>
                {Object.entries(CardBrand).map(([key, value]) => (
                  <option key={key} value={value}>{value}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {unknownCount > 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
            {unknownCount} {unknownCount === 1 ? 'item não reconhecido' : 'itens não reconhecidos'}.
            Classifique-os antes de importar.
          </p>
        )}

        <div className="space-y-2 mb-6">
          {items.map((item, index) => (
            <div
              key={index}
              className={`p-3 rounded-lg border ${
                item.recognized && item.resolvedSubtype === item.subtype
                  ? 'bg-green-50 border-green-200'
                  : 'bg-amber-50 border-amber-200'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-800">{item.description}</span>
                  {item.resolvedQty !== undefined && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-gray-500 font-bold">
                        {item.resolvedQty} {item.unit ?? ''}
                      </span>
                      {item.resolvedUnitPrice !== undefined && (
                        <>
                          <span className="text-[10px] text-gray-400">×</span>
                          <input
                            type="number"
                            value={item.resolvedUnitPrice}
                            min="0"
                            step="0.01"
                            onChange={e => handleUnitPriceChange(index, parseFloat(e.target.value) || 0)}
                            className="w-20 p-0.5 border rounded text-[10px] text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
                <input
                  type="number"
                  value={item.resolvedValue}
                  min="0"
                  step="0.01"
                  onChange={e => handleValueChange(index, parseFloat(e.target.value) || 0)}
                  className="w-24 p-1 border rounded text-sm text-right font-black [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
              <div className="mt-2">
                <select
                  value={item.resolvedSubtype ?? ''}
                  onChange={e => handleSubtypeChange(index, e.target.value)}
                  className="w-full p-1.5 border rounded text-sm"
                >
                  <option value="">Subcategoria...</option>
                  {([...ExpenseSubtypes['supermercado']] as string[])
                    .sort((a, b) => a.localeCompare(b))
                    .map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setStep(1)}
            className="flex-1 py-2 border border-gray-300 rounded text-sm font-bold hover:bg-gray-50"
          >
            Voltar
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport || loading}
            className="flex-1 py-2 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Importando...' : `Importar ${items.length} ${items.length === 1 ? 'item' : 'itens'}`}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: Success ─────────────────────────────────────────────────────────
  return (
    <div className="max-w-md mx-auto p-4 border rounded-lg shadow-md text-center space-y-4">
      <div className="text-5xl font-bold text-green-500">✓</div>
      <h2 className="text-xl font-bold">Importação concluída!</h2>
      <p className="text-gray-600">
        {importedCount} {importedCount === 1 ? 'gasto importado' : 'gastos importados'} com sucesso.
      </p>
      <button
        onClick={onImported}
        className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 font-bold"
      >
        Ir para o Dashboard
      </button>
    </div>
  );
}
