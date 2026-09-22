import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessCaixaText, preprocessSantanderText } from '../lib/utils/billUtils';

// End-to-end against the deterministic preprocessors: a real bill line in,
// the parsed (date, installments) out. No GPT, no DB. These reproduce the
// production mis-year: a 12/12 row printed 19/09 on a bill due 25/09/2026
// must parse to the 2025-09-19 purchase, not 2026-09-19.

// ─── Caixa VISA ─────────────────────────────────────────────────────────────
// Bill header carries the due date "25/09/2026"; the parcelada row prints the
// original purchase date and the "NN de NN" counter.
const CAIXA_BILL = [
  'FATURA',
  'Vencimento 25/09/2026',
  'PEDRO H T ALMEIDA (Cartão 6806)',
  'COMPRAS PARCELADAS (Cartão 6806)',
  'Data Descrição Parcela Valor',
  '19/09 HTM *asimovacademy 12 DE 12 Barueri 143,20D',
  'Total 143,20',
].join('\n');

test('Caixa: a 12 DE 12 row printed 19/09 on a bill due 25/09/2026 parses to 2025-09-19', () => {
  const rows = preprocessCaixaText(CAIXA_BILL);
  const row = rows.find(r => /asimov/i.test(r.description));
  assert.ok(row, 'expected the asimov row to be parsed');
  assert.equal(row!.installmentCurrent, 12);
  assert.equal(row!.installmentTotal, 12);
  assert.equal(row!.date, '2025-09-19');
  assert.equal(row!.value, 143.2);
});

test('Caixa: a 01 DE 12 row on the same bill stays in 2026', () => {
  const bill = CAIXA_BILL.replace('12 DE 12', '01 DE 12');
  const rows = preprocessCaixaText(bill);
  const row = rows.find(r => /asimov/i.test(r.description));
  assert.ok(row);
  assert.equal(row!.date, '2026-09-19');
});

// ─── Santander ──────────────────────────────────────────────────────────────
// Parcelamentos subsection; row format "[DD/MM] [DESC] [NN/NN] [R$ valor]".
const SANTANDER_BILL = [
  'Detalhamento da Fatura',
  'Vencimento 25/09/2026',
  'PEDRO H T ALMEIDA - 1234 XXXX XXXX 5678',
  'Parcelamentos',
  'Compra Data Descrição Parcela R$',
  '19/09 HTM ASIMOV ACADEMY 12/12 143,20',
  'VALOR TOTAL 143,20',
].join('\n');

test('Santander: a 12/12 row printed 19/09 on a bill due 25/09/2026 parses to 2025-09-19', () => {
  const rows = preprocessSantanderText(SANTANDER_BILL);
  const row = rows.find(r => /ASIMOV/i.test(r.description));
  assert.ok(row, 'expected the asimov row to be parsed');
  assert.equal(row!.installmentCurrent, 12);
  assert.equal(row!.installmentTotal, 12);
  assert.equal(row!.date, '2025-09-19');
  assert.equal(row!.value, 143.2);
});

test('Santander: a plain Despesas row keeps the simple inferYear rule', () => {
  const bill = [
    'Detalhamento da Fatura',
    'Vencimento 25/01/2026',
    'PEDRO H T ALMEIDA - 1234 XXXX XXXX 5678',
    'Despesas',
    'Compra Data Descrição Parcela R$',
    '22/12 PASTEL DA BANCA 29,00',
    'VALOR TOTAL 29,00',
  ].join('\n');
  const rows = preprocessSantanderText(bill);
  const row = rows.find(r => /PASTEL/i.test(r.description));
  assert.ok(row);
  // December purchase on a January bill -> previous year, no installments.
  assert.equal(row!.date, '2025-12-22');
  assert.equal(row!.installmentCurrent, undefined);
});
