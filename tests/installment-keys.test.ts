import test from 'node:test';
import assert from 'node:assert/strict';
import { installmentKey, installmentKeyId, seriesStored } from '../lib/utils/installmentKeys';

const doc = { value: 100, date: '2026-05-10', cardBrand: 'Visa Caixa', installment: 1, totalInstallments: 3 };

test('installmentKey: only a credit installment of a real group has a key', () => {
  assert.deepEqual(installmentKey({ ...doc, name: 'Loja A' } as typeof doc), doc);
  assert.equal(installmentKey({ ...doc, totalInstallments: 1 }), undefined);
  // A reviewer switched a credit installment row to pix: buildExpenseDocuments
  // emits one document with no card or installment fields. Keying it would
  // match any expense of the same value on that day.
  assert.equal(installmentKey({ value: 100, date: '2026-05-10' }), undefined);
  assert.equal(installmentKey({ ...doc, cardBrand: undefined }), undefined);
});

test('seriesStored: the n-th identical purchase needs n stored copies of every installment', () => {
  const keys = [1, 2, 3].map(installment => ({ ...doc, installment }));
  const one = new Map(keys.map(k => [installmentKeyId(k), 1]));
  const two = new Map(keys.map(k => [installmentKeyId(k), 2]));

  assert.equal(seriesStored(keys, one, 1), true);
  // Two different purchases with the same card, value, date and count: the
  // second is NOT already stored just because the first is.
  assert.equal(seriesStored(keys, one, 2), false);
  assert.equal(seriesStored(keys, two, 2), true);

  const partial = new Map(one);
  partial.delete(installmentKeyId(keys[2]));
  assert.equal(seriesStored(keys, partial, 1), false);
  assert.equal(seriesStored([], one, 1), false);
});
