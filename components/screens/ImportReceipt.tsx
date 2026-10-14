'use client';

import { CircleCheck, FileText, Link2, ScanQrCode, TriangleAlert } from 'lucide-react';
import { ICON_STROKE } from '@/components/shell/nav';
import { useState } from 'react';
import { CardBrand, ConfirmedReceiptItem, ParsedReceiptItem } from '@/types';
import { useCategories } from '@/hooks/useCategories';
import { isAllowedSefazUrl } from '@/lib/utils/sefazUrl';
import QrScannerModal from '@/components/QrScannerModal';

type ParseResponse = {
  store: { cnpj: string; name: string; address: string | null };
  date: string | null;
  paymentType: string | null;
  total?: number;
  discounts?: number;
  amountDue?: number;
  storeDefaultType?: string;
  items: ParsedReceiptItem[];
};

type ItemState = ParsedReceiptItem & {
  resolvedValue: number;
  resolvedType?: string;
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
  const {
    expenseTypes,
    subtypesFor,
    isValidType,
    isValidPair,
    loading: categoriesLoading,
  } = useCategories();
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
  const [storeType, setStoreType] = useState<string | undefined>(undefined);
  const [installments, setInstallments] = useState(1);
  const [scannerOpen, setScannerOpen] = useState(false);

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

  const applyParsedResponse = (data: ParseResponse) => {
    setParsed(data);
    setPaymentType(data.paymentType ?? '');
    setCardBrand(undefined);
    setStoreType(data.storeDefaultType);
    setItems(
      (data.items as ParsedReceiptItem[]).map(item => ({
        ...item,
        resolvedValue: round2(item.value),
        resolvedType: item.type ?? data.storeDefaultType,
        resolvedSubtype: item.recognized ? (item.subtype ?? '') : undefined,
        ...(item.qty !== undefined && { resolvedQty: item.qty }),
        ...(item.qty !== undefined && item.qty > 0 && { resolvedUnitPrice: round2(item.unitPrice ?? item.value / item.qty) }),
      }))
    );
    setStep(2);
  };

  // Takes the URL as an argument (not from state) so the QR scan callback can
  // fire the parse in the same tick it fills the field — state updates are
  // not visible synchronously inside the callback.
  const parseFromUrl = async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/receipts/parse-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao processar nota fiscal');
        return;
      }
      applyParsedResponse(data);
    } catch {
      setError('Erro de rede ao processar a nota');
    } finally {
      setLoading(false);
    }
  };

  const parseFromPdf = async () => {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file!);
      const res = await fetch('/api/receipts/parse', { method: 'POST', body: formData });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao processar nota fiscal');
        return;
      }
      applyParsedResponse(data);
    } catch {
      setError('Erro de rede ao processar a nota');
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async () => {
    const canSubmit = inputMode === 'pdf' ? !!file : receiptUrl.trim().length > 0;
    if (!canSubmit) return;

    if (inputMode === 'pdf') {
      await parseFromPdf();
    } else {
      await parseFromUrl(receiptUrl.trim());
    }
  };

  // Scan → fill → parse. A QR that carries a non-SEFAZ value still lands in
  // the field (manual correction) but never fires the request.
  const handleScanned = async (text: string) => {
    setScannerOpen(false);
    setReceiptUrl(text);
    if (isAllowedSefazUrl(text.trim())) {
      await parseFromUrl(text.trim());
    } else {
      setError('O QR code não contém um link de nota fiscal (portal SEFAZ). Confira o link no campo acima.');
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

  const handleStoreTypeChange = (newType: string) => {
    const type = newType || undefined;
    setStoreType(type);
    setItems(prev =>
      prev.map(item =>
        item.fromMapping || item.resolvedSubtype
          ? item
          : { ...item, resolvedType: type, resolvedSubtype: undefined }
      )
    );
  };

  const handleTypeChange = (index: number, newType: string) => {
    const type = newType || undefined;
    setItems(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, resolvedType: type, resolvedSubtype: undefined } : item
      )
    );
  };

  // A category renamed or deleted in another tab leaves selections pointing at a
  // name that no longer exists; /api/receipts/import rejects the whole batch, so
  // surface it here instead.
  const effectiveType = (type: string | undefined): string | undefined =>
    type && (categoriesLoading || isValidType(type)) ? type : undefined;

  const effectiveSubtype = (type: string | undefined, subtype: string | undefined): string | undefined =>
    type && subtype && (categoriesLoading || isValidPair(type, subtype)) ? subtype : undefined;

  const allResolved = items.every(
    item =>
      !!effectiveType(item.resolvedType) &&
      !!effectiveSubtype(effectiveType(item.resolvedType), item.resolvedSubtype)
  );

  const handleImport = async () => {
    if (!parsed || !allResolved) return;
    setLoading(true);
    setError(null);
    try {
      // Resolve once, exactly as the `allResolved` gate does, so the payload can
      // never carry a stale name the gate already considered invalid.
      const resolved = items.map(item => {
        const type = effectiveType(item.resolvedType);
        return { item, type, subtype: effectiveSubtype(type, item.resolvedSubtype) };
      });

      const confirmedItems: ConfirmedReceiptItem[] = resolved.map(({ item, type, subtype }) => ({
        description: item.description,
        value: item.resolvedValue,
        type: type!,
        subtype,
        ...(item.resolvedQty !== undefined && { qty: item.resolvedQty }),
        ...(item.unit && { unit: item.unit }),
      }));

      const newMappings: ConfirmedReceiptItem[] = resolved
        .filter(({ item, type, subtype }) => {
          const parsedType = effectiveType(item.type ?? undefined);
          return (
            (type ?? null) !== (parsedType ?? null) ||
            (subtype ?? null) !== (effectiveSubtype(parsedType, item.subtype ?? undefined) ?? null)
          );
        })
        .map(({ item, type, subtype }) => ({
          description: item.description,
          value: item.value,
          type: type!,
          subtype,
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
          storeDefaultType: effectiveType(storeType),
          installments,
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
      <div className="max-w-md mx-auto p-4 border border-border rounded-card bg-surface-1 ">
        <h2 className="mb-4 text-[22px] font-semibold leading-7 tracking-[-0.01em]">Importar nota fiscal</h2>

        {/* Mode toggle */}
        <div className="flex bg-surface-2 p-1 rounded-lg mb-4">
          <button
            onClick={() => switchMode('pdf')}
            className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
              inputMode === 'pdf' ? 'bg-surface-1 text-accent' : 'text-ink-muted'
            }`}
          >
            <FileText size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="inline-block align-[-3px]" /> PDF da nota
          </button>
          <button
            onClick={() => switchMode('url')}
            className={`flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
              inputMode === 'url' ? 'bg-surface-1 text-accent' : 'text-ink-muted'
            }`}
          >
            <Link2 size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="inline-block align-[-3px]" /> Link ou QR code
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
                className="w-full p-2 border border-border-strong rounded text-sm"
              />
            </div>
          ) : (
            <div key="url">
              <label className="block text-sm font-medium mb-1">Link do QR Code da Nota</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={receiptUrl}
                  onChange={e => { setReceiptUrl(e.target.value); setError(null); }}
                  placeholder="https://dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce?p=..."
                  className="flex-1 min-w-0 p-2 border border-border-strong rounded text-sm"
                />
                <button
                  type="button"
                  onClick={() => { setError(null); setScannerOpen(true); }}
                  title="Escanear QR code com a câmera"
                  aria-label="Escanear QR code com a câmera"
                  className="shrink-0 px-3 bg-accent text-on-accent rounded hover:bg-accent-hover text-sm font-bold"
                >
                  <ScanQrCode size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
                </button>
              </div>
              <p className="text-[11px] text-ink-muted mt-1">
                Cole o link gerado pelo QR Code da NFC-e (portais *.gov.br) ou escaneie com a câmera.
              </p>
            </div>
          )}

          {scannerOpen && (
            <QrScannerModal
              onScanned={handleScanned}
              onClose={() => setScannerOpen(false)}
            />
          )}

          {error && (
            <p className="text-sm text-negative bg-negative-soft border border-transparent rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleParse}
            disabled={!canSubmit || loading}
            className="w-full bg-accent text-on-accent p-2 rounded hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed font-bold"
          >
            {loading ? 'Processando...' : 'Processar Nota'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Review ──────────────────────────────────────────────────────────
  if (step === 2 && parsed) {
    const unknownCount = items.filter(i => {
      const type = effectiveType(i.resolvedType);
      return !type || !effectiveSubtype(type, i.resolvedSubtype);
    }).length;
    const total = parsed.total ?? items.reduce((s, i) => s + i.resolvedValue, 0);
    const canImport =
      allResolved && !categoriesLoading && !!paymentType && (paymentType !== 'credit' || !!cardBrand);

    return (
      <div className="max-w-2xl mx-auto p-3 sm:p-4">
        <h2 className="text-xl font-bold mb-2">Revisar itens</h2>
        <div className="text-sm text-ink-muted mb-4 space-y-1">
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
              onChange={e => { const v = e.target.value; setPaymentType(v); setCardBrand(undefined); if (v !== 'credit') setInstallments(1); }}
              className="w-full p-2 border border-border-strong rounded text-sm"
            >
              <option value="">Selecione...</option>
              {PAYMENT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {paymentType === 'credit' && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Cartão Utilizado</label>
                <select
                  value={cardBrand ?? ''}
                  onChange={e => setCardBrand(e.target.value === '' ? undefined : e.target.value as CardBrand)}
                  className="w-full p-2 border border-border-strong rounded text-sm"
                >
                  <option value="">Selecione o cartão utilizado</option>
                  {Object.entries(CardBrand).map(([key, value]) => (
                    <option key={key} value={value}>{value}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Número de Parcelas</label>
                <input
                  type="number"
                  min={1}
                  value={installments}
                  onChange={e => setInstallments(Math.max(1, Math.round(+e.target.value || 1)))}
                  className="w-full p-2 border border-border-strong rounded text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Categoria do Estabelecimento</label>
            <select
              value={effectiveType(storeType) ?? ''}
              onChange={e => handleStoreTypeChange(e.target.value)}
              className="w-full p-2 border border-border-strong rounded text-sm"
            >
              <option value="">Selecione a categoria padrão...</option>
              {[...expenseTypes]
                .sort((a, b) => a.localeCompare(b))
                .map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
            </select>
            <p className="text-[11px] text-ink-muted mt-1">
              Define o tipo padrão para itens desta loja em importações futuras.
            </p>
          </div>
        </div>

        {unknownCount > 0 && (
          <p className="text-xs text-warning bg-warning-soft border border-transparent rounded px-3 py-2 mb-4">
            {unknownCount} {unknownCount === 1 ? 'item precisa' : 'itens precisam'} de classificação.
            Defina categoria e subcategoria antes de importar.
          </p>
        )}

        <div className="space-y-2 mb-6">
          {items.map((item, index) => {
            const type = effectiveType(item.resolvedType);
            const subtype = effectiveSubtype(type, item.resolvedSubtype);
            const typeOrphaned = !type && !!item.resolvedType;
            const subtypeOrphaned = !subtype && !!type && !!item.resolvedSubtype;

            return (
            <div
              key={index}
              className={`p-3 rounded-lg border border-border ${
                item.recognized && type === item.type && subtype === item.subtype
                  ? 'bg-accent-soft border-transparent'
                  : 'bg-warning-soft border-transparent'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-ink">{item.description}</span>
                  {item.resolvedQty !== undefined && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-xs text-ink-muted font-bold">
                        {item.resolvedQty} {item.unit ?? ''}
                      </span>
                      {item.resolvedUnitPrice !== undefined && (
                        <>
                          <span className="text-xs text-ink-muted">×</span>
                          <input
                            type="number"
                            value={item.resolvedUnitPrice}
                            min="0"
                            step="0.01"
                            onChange={e => handleUnitPriceChange(index, parseFloat(e.target.value) || 0)}
                            className="w-20 p-0.5 border border-border-strong rounded text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
                  className="w-24 p-1 border border-border-strong rounded text-sm text-right font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
              <div className="mt-2 flex gap-2">
                <select
                  value={type ?? ''}
                  onChange={e => handleTypeChange(index, e.target.value)}
                  className="flex-1 p-1.5 border border-border-strong rounded text-sm"
                >
                  <option value="">Tipo...</option>
                  {[...expenseTypes]
                    .sort((a, b) => a.localeCompare(b))
                    .map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                </select>
                <select
                  value={subtype ?? ''}
                  onChange={e => handleSubtypeChange(index, e.target.value)}
                  disabled={!type}
                  className="flex-1 p-1.5 border border-border-strong rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Subcategoria...</option>
                  {type
                    ? [...subtypesFor(type)]
                        .sort((a, b) => a.localeCompare(b))
                        .map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))
                    : null}
                </select>
              </div>
              {(typeOrphaned || subtypeOrphaned) && (
                <p className="text-[11px] text-warning mt-1">
                  <TriangleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden="true" className="inline-block align-[-3px]" /> {typeOrphaned ? 'Categoria' : 'Subcategoria'}{' '}
                  &ldquo;{typeOrphaned ? item.resolvedType : item.resolvedSubtype}&rdquo; não existe
                  mais — selecione uma válida.
                </p>
              )}
            </div>
            );
          })}
        </div>

        {error && (
          <p className="text-sm text-negative bg-negative-soft border border-transparent rounded px-3 py-2 mb-4">
            {error}
          </p>
        )}

        <div className="sticky bottom-0 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 bg-surface-1 border-t border-border flex gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => setStep(1)}
            className="flex-1 py-2 border border-border-strong rounded text-sm font-bold hover:bg-surface-2"
          >
            Voltar
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport || loading}
            className="flex-1 py-2 bg-accent text-on-accent rounded text-sm font-bold hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Importando...' : `Importar ${items.length} ${items.length === 1 ? 'item' : 'itens'}`}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: Success ─────────────────────────────────────────────────────────
  return (
    <div className="max-w-md mx-auto p-4 border border-border rounded-card bg-surface-1 text-center space-y-4">
      <CircleCheck size={48} strokeWidth={ICON_STROKE} aria-hidden="true" className="mx-auto text-positive" />
      <h2 className="text-xl font-bold">Importação concluída</h2>
      <p className="text-ink-muted">
        {importedCount} {importedCount === 1 ? 'gasto importado' : 'gastos importados'} com sucesso.
      </p>
      <button
        onClick={onImported}
        className="w-full bg-accent text-on-accent p-2 rounded hover:bg-accent-hover font-bold"
      >
        Ir para o Dashboard
      </button>
    </div>
  );
}
