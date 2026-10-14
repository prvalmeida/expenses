'use client';

import { useState, useEffect } from 'react';
import { CardBrand } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, Notice } from '@/components/ui/display';
import { MonthSwitcher, TextField } from '@/components/ui/controls';
import { currentMonth } from '@/lib/utils/routeParams';

interface ConfigState {
  [key: string]: {
    closingDate: string;
    dueDate: string;
  };
}

type SaveState = { tone: 'success' | 'error'; text: string } | 'saving';

export default function CardConfigPage() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [cardConfigs, setCardConfigs] = useState<ConfigState>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});

  // Fetch data whenever the month changes
  useEffect(() => {
    let cancelled = false;
    const fetchConfigs = async () => {
      setLoading(true);
      setLoadError(false);
      setSaveState({});
      const [year, month] = selectedMonth.split('-');
      const newConfigs: ConfigState = {};
      try {
        // Fetch each card's config (or get defaults from API)
        for (const brand of Object.values(CardBrand)) {
          const res = await fetch(`/api/card-cycles?brand=${brand}&month=${month}&year=${year}`);
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          newConfigs[brand] = { closingDate: data.closingDate, dueDate: data.dueDate };
        }
        if (!cancelled) setCardConfigs(newConfigs);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchConfigs();
    return () => { cancelled = true; };
  }, [selectedMonth]);

  const handleInputChange = (brand: string, field: 'closingDate' | 'dueDate', value: string) => {
    setCardConfigs((prev) => ({ ...prev, [brand]: { ...prev[brand], [field]: value } }));
    setSaveState(prev => {
      const next = { ...prev };
      delete next[brand];
      return next;
    });
  };

  const handleSave = async (brand: string) => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const config = cardConfigs[brand];
    setSaveState(prev => ({ ...prev, [brand]: 'saving' }));
    try {
      const response = await fetch('/api/card-cycles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardBrand: brand, month, year, closingDate: config.closingDate, dueDate: config.dueDate }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const recalculated: number = data.updatedExpenses ?? 0;
      setSaveState(prev => ({
        ...prev,
        [brand]: {
          tone: 'success',
          text: recalculated > 0
            ? `Salvo. ${recalculated} ${recalculated === 1 ? 'gasto teve a data de pagamento recalculada' : 'gastos tiveram a data de pagamento recalculada'}.`
            : 'Salvo.',
        },
      }));
    } catch {
      setSaveState(prev => ({ ...prev, [brand]: { tone: 'error', text: 'Não foi possível salvar. Tente de novo.' } }));
    }
  };

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em]">Cartões e fechamento</h1>
        <p className="text-[13px] text-ink-muted">Ajuste as datas quando o fechamento ou o vencimento cair em feriado ou fim de semana.</p>
      </div>
      <div className="flex justify-center sm:justify-start">
        <MonthSwitcher month={selectedMonth} onChange={setSelectedMonth} />
      </div>

      {loadError && <Notice tone="error" title="Não foi possível carregar as datas dos cartões">Recarregue a página para tentar de novo.</Notice>}

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando">
          {Object.values(CardBrand).map(b => <div key={b} className="h-40 animate-pulse rounded-card bg-surface-2" />)}
        </div>
      ) : !loadError && (
        Object.values(CardBrand).map((brand) => {
          const state = saveState[brand];
          return (
            <Card key={brand} title={brand}>
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <TextField
                  label="Fechamento"
                  type="date"
                  value={cardConfigs[brand]?.closingDate || ''}
                  onChange={(e) => handleInputChange(brand, 'closingDate', e.target.value)}
                />
                <TextField
                  label="Vencimento"
                  type="date"
                  value={cardConfigs[brand]?.dueDate || ''}
                  onChange={(e) => handleInputChange(brand, 'dueDate', e.target.value)}
                />
                <Button onClick={() => handleSave(brand)} disabled={state === 'saving'}>
                  {state === 'saving' ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
              {state && state !== 'saving' && (
                <div className="mt-3"><Notice tone={state.tone} title={state.text} /></div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
