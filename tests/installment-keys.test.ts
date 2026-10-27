import test from 'node:test';
import assert from 'node:assert/strict';
import { installmentKey, installmentKeyId, storedCopies } from '../lib/utils/installmentKeys';

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

test('storedCopies: the n-th identical purchase needs n stored copies of every installment', () => {
  const keys = [1, 2, 3].map(installment => ({ ...doc, installment }));
  const one = new Map(keys.map(k => [installmentKeyId(k), 1]));
  const two = new Map(keys.map(k => [installmentKeyId(k), 2]));

  assert.equal(storedCopies(keys, one), 1);
  // Two different purchases with the same card, value, date and count: the
  // second is NOT already stored just because the first is.
  assert.equal(storedCopies(keys, two), 2);

  const partial = new Map(two);
  partial.set(installmentKeyId(keys[2]), 1);
  assert.equal(storedCopies(keys, partial), 1);
  partial.delete(installmentKeyId(keys[2]));
  assert.equal(storedCopies(keys, partial), 0);
  assert.equal(storedCopies([], one), 0);
});
