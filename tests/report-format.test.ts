import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDigest, type DigestLike } from '../scripts/lib/reportFormat';

const digest = (over: Partial<DigestLike> = {}): DigestLike => ({
  expenses: [],
  incomes: [],
  totals: { expenses: 0, incomes: 0 },
  pending: { count: 0, total: 0 },
  anomalies: 0,
  ...over,
});

const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(value)
    .replace(/\u202f/g, '\u00a0');

test('renders the day with expenses, incomes and a month total', () => {
  const message = formatDigest({
    today: '2026-11-08',
    digest: digest({
      expenses: [
        { name: 'iFood', value: 58.9, date: '2026-11-07', type: 'comida', subtype: 'Delivery' },
        { name: 'Uber', value: 21.5, date: '2026-11-08', type: 'transporte', subtype: null },
      ],
      incomes: [{ name: 'TED RECEBIDA', value: 3.07, date: '2026-11-06' }],
      totals: { expenses: 80.4, incomes: 3.07 },
    }),
    monthToDate: 9870,
  });

  const lines = message.split('\n');
  assert.equal(lines[0], '🔄 Sync de 08/11 concluída');
  assert.equal(lines[2], `Novos gastos (2) — ${brl(80.4)}`);
  assert.equal(lines[3], `• 07/11 iFood — ${brl(58.9)} · comida › Delivery`);
  // No subtype: the glyph would dangle.
  assert.equal(lines[4], `• 08/11 Uber — ${brl(21.5)} · transporte`);
  assert.ok(message.includes(`Novas receitas (1) — ${brl(3.07)}`));
  assert.ok(message.includes(`Mês até agora (fluxo de caixa): ${brl(9870)}`));
});

test('says so when the day brought nothing, and stays quiet about healthy syncs', () => {
  const message = formatDigest({
    today: '2026-11-08',
    digest: digest(),
    sync: {
      accounts: [{ accountId: 'acc-1', name: 'Nubank' }],
      items: [{ itemId: 'item-1', label: 'Nubank', status: 'UPDATED' }],
    },
  });

  assert.equal(message, '🔄 Sync de 08/11 concluída\n\nNenhum gasto nem receita nova.');
});

test('caps the expense list and counts the rest', () => {
  const expenses = Array.from({ length: 20 }, (_, index) => ({
    name: `gasto ${index}`,
    value: 10,
    date: '2026-11-07',
    type: 'mercado',
  }));

  const message = formatDigest({
    today: '2026-11-08',
    digest: digest({ expenses, totals: { expenses: 200, incomes: 0 } }),
  });

  assert.equal(message.split('\n').filter(line => line.startsWith('• ')).length, 15);
  assert.ok(message.includes('…e mais 5 gastos'));
});

test('surfaces a failing account, a broken connection and anomalies', () => {
  const message = formatDigest({
    today: '2026-11-08',
    digest: digest({ anomalies: 2, pending: { count: 12, total: 1204.1 } }),
    sync: {
      accounts: [{ accountId: 'acc-1', name: 'Nubank', error: 'LOGIN_ERROR' }],
      items: [{ itemId: 'item-1', label: 'Nubank', status: 'LOGIN_ERROR' }],
    },
  });

  assert.ok(message.includes('⚠️ Nubank: falhou ao sincronizar (LOGIN_ERROR)'));
  assert.ok(message.includes('⚠️ Nubank: LOGIN_ERROR'));
  assert.ok(message.includes(`⏳ 12 aguardando revisão — ${brl(1204.1)}`));
  assert.ok(message.includes('🚨 2 transações em anomalia'));
});

test('the header uses the full count even when the list is capped', () => {
  const expenses = Array.from({ length: 20 }, (_, index) => ({
    name: `gasto ${index}`,
    value: 10,
    date: '2026-11-07',
    type: 'mercado',
  }));

  const message = formatDigest({
    today: '2026-11-08',
    digest: digest({
      counts: { expenses: 250, incomes: 0 },
      expenses,
      totals: { expenses: 2500, incomes: 0 },
    }),
  });

  assert.ok(message.includes(`Novos gastos (250) — ${brl(2500)}`));
  assert.ok(message.includes('…e mais 235 gastos'));
});

test('a locked sync is reported as such, not as a failure', () => {
  const message = formatDigest({ today: '2026-11-08', digest: digest(), locked: true });

  assert.equal(message.split('\n')[0], '⏳ Sync de 08/11 — outra execução ainda está rodando');
});

test('a report-only run does not claim it synced', () => {
  const message = formatDigest({ today: '2026-11-08', digest: digest(), synced: false });

  assert.equal(message.split('\n')[0], '📊 Resumo de 08/11');
});

test('WAITING_USER_ACTION is a broken connection, the transient MFA prompt is not', () => {
  const message = formatDigest({
    today: '2026-11-08',
    digest: digest(),
    sync: {
      items: [
        { itemId: 'item-1', label: 'Caixa', status: 'WAITING_USER_ACTION' },
        { itemId: 'item-2', label: 'Nubank', status: 'WAITING_USER_INPUT' },
        { itemId: 'item-3', label: 'Inter', status: 'OUTDATED' },
      ],
    },
  });

  assert.ok(message.includes('⚠️ Caixa: WAITING_USER_ACTION'));
  assert.ok(message.includes('⚠️ Inter: OUTDATED'));
  assert.ok(!message.includes('WAITING_USER_INPUT'));
});

test('a failed sync is reported in the header and the digest still goes out', () => {
  const message = formatDigest({
    today: '2026-11-08',
    digest: digest({
      expenses: [{ name: 'Uber', value: 21.5, date: '2026-11-08', type: 'transporte' }],
      totals: { expenses: 21.5, incomes: 0 },
    }),
    syncError: '502: Bad Gateway',
    locked: false,
  });

  assert.equal(message.split('\n')[0], '⚠️ Sync de 08/11 falhou: 502: Bad Gateway');
  assert.ok(message.includes(`Novos gastos (1) — ${brl(21.5)}`));
});

test('a sync error carrying an HTML error page is cut to one short line', () => {
  const html = `502: <!DOCTYPE html>\n<html lang="en-US">${'<div>x</div>'.repeat(50)}</html>`;
  const header = formatDigest({ today: '2026-11-08', digest: digest(), syncError: html }).split('\n')[0];

  assert.equal(header, '⚠️ Sync de 08/11 falhou: 502: <!DOCTYPE html>');

  const long = `500: ${'a'.repeat(300)}`;
  const longHeader = formatDigest({ today: '2026-11-08', digest: digest(), syncError: long }).split('\n')[0];
  assert.ok(longHeader.endsWith('…'));
  assert.ok(longHeader.length < 160);
});
