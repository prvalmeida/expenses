import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTelegramExpenseText } from '../lib/services/telegramExpenseService';

test('parses a pix expense from Telegram-style text', () => {
  const result = parseTelegramExpenseText(
    'nome: almoço\nvalor: 42,90\ncategoria: comida\nsubcategoria: restaurante\npagamento: pix\ndata: 2026-08-29'
  );

  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(result.expense.name, 'almoço');
  assert.equal(result.expense.value, 42.9);
  assert.equal(result.expense.type, 'comida');
  assert.equal(result.expense.subtype, 'restaurante');
  assert.equal(result.expense.paymentType, 'pix');
  assert.equal(result.expense.date, '2026-08-29');
});

test('parses credit aliases, combined category and installments', () => {
  const result = parseTelegramExpenseText(
    'nome: notebook\nvalor: R$ 5.000,46\ncategoria: compras / eletrônicos\npagamento: crédito\ncartão: visa\nparcelas: 6\ndata: 31/03/2026'
  );

  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(result.expense.paymentType, 'credit');
  assert.equal(result.expense.cardBrand, 'Visa Caixa');
  assert.equal(result.expense.installments, 6);
  assert.equal(result.expense.type, 'compras');
  assert.equal(result.expense.subtype, 'eletrônicos');
  assert.equal(result.expense.date, '2026-03-31');
});

test('rejects installments on non-credit expenses', () => {
  const result = parseTelegramExpenseText(
    'nome: mercado\nvalor: 20\ncategoria: supermercado\nsubcategoria: outros\npagamento: pix\nparcelas: 2'
  );

  assert.equal(result.success, false);
  if (result.success) return;

  assert.deepEqual(result.details.installments, ['Parcelas só são aceitas para pagamento no crédito.']);
});
