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

test('B1: rejects dot-decimal values instead of silently reading them as 100x', () => {
  const result = parseTelegramExpenseText(
    'nome: almoço\nvalor: 42.90\ncategoria: comida\nsubcategoria: restaurante\npagamento: pix'
  );

  assert.equal(result.success, false);
  if (result.success) return;

  assert.deepEqual(result.details.value, ['Valor inválido. Use um número como 42,90.']);
});

test('B2: rejects month 13 in DD/MM/YYYY instead of overflowing the credit cycle', () => {
  const result = parseTelegramExpenseText(
    'nome: note\nvalor: 100\ncategoria: compras\nsubcategoria: outros\npagamento: crédito\ncartão: visa\ndata: 31/13/2026'
  );

  assert.equal(result.success, false);
  if (result.success) return;

  assert.deepEqual(result.details.date, ['Data inválida. Use YYYY-MM-DD, DD/MM/YYYY, hoje ou ontem.']);
});

test('B2: rejects impossible calendar dates (31/02, 31/04) and invalid ISO dates', () => {
  for (const date of ['31/02/2026', '31/04/2026', '2026-13-01', '2026-02-31']) {
    const result = parseTelegramExpenseText(
      `nome: x\nvalor: 1\ncategoria: compras\nsubcategoria: outros\npagamento: pix\ndata: ${date}`
    );
    assert.equal(result.success, false, `data ${date} deveria falhar`);
    if (result.success) return;
    assert.ok(result.details.date, `data ${date} deveria reportar details.date`);
  }
});

test('accepts valid calendar dates including leap day', () => {
  for (const [input, expected] of [['29/02/2028', '2028-02-29'], ['29/02/2026', undefined]] as const) {
    const result = parseTelegramExpenseText(
      `nome: x\nvalor: 1\ncategoria: compras\nsubcategoria: outros\npagamento: pix\ndata: ${input}`
    );
    if (expected === undefined) {
      assert.equal(result.success, false, `data ${input} deveria falhar`);
    } else {
      assert.equal(result.success, true, `data ${input} deveria passar`);
      if (!result.success) return;
      assert.equal(result.expense.date, expected);
    }
  }
});

test('amount grammar accepts thousands separators and rejects malformed values', () => {
  const cases = [
    ['R$ 5.000,46', true],
    ['5.000,46', true],
    ['1.234.567,89', true],
    ['42,90', true],
    ['42', true],
    ['42.90', false],
    ['1.23', false],
    ['42,905', false],
    ['R$ 4290', true],
    ['  42,90  ', true],
  ] as const;

  for (const [raw, shouldPass] of cases) {
    const result = parseTelegramExpenseText(
      `nome: x\nvalor: ${raw}\ncategoria: compras\nsubcategoria: outros\npagamento: pix`
    );
    assert.equal(result.success, shouldPass, `valor "${raw}" deveria ${shouldPass ? 'passar' : 'falhar'}`);
  }
});
