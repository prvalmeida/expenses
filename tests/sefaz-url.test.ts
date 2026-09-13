import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedSefazUrl } from '../lib/utils/sefazUrl';

// The SEFAZ allowlist is the SSRF guard on every URL-fetching path (receipt
// URL parse, internal and v1). These cases pin it so the extraction from
// receiptService cannot drift.
//
// The URL below matches the placeholder in ImportReceipt.tsx — a real
// RS-state NFC-e portal link, with a fabricated query string.

test('accepts an https *.gov.br host carrying a SEFAZ keyword', () => {
  const url = 'https://dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce?p=1234';
  assert.equal(isAllowedSefazUrl(url), true);
});

test('accepts hosts with nfce, nfe or dfe anywhere in the hostname', () => {
  assert.equal(isAllowedSefazUrl('https://nfce.fazenda.ms.gov.br/consulta'), true);
  assert.equal(isAllowedSefazUrl('https://www.nfe.fazenda.gov.br/consulta'), true);
  assert.equal(isAllowedSefazUrl('https://dfe-portal.svrs.rs.gov.br/'), true);
});

test('rejects http — the allowlist is https-only', () => {
  assert.equal(isAllowedSefazUrl('http://dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce'), false);
});

test('rejects a non-gov.br domain even with a SEFAZ keyword', () => {
  assert.equal(isAllowedSefazUrl('https://dfe-portal.svrs.rs.gov.br.example.com/Dfe'), false);
  assert.equal(isAllowedSefazUrl('https://nfce.evil.com/'), false);
});

test('rejects gov.br hosts without a SEFAZ keyword', () => {
  assert.equal(isAllowedSefazUrl('https://www.brasil.gov.br/'), false);
});

test('rejects a hostname that only has gov.br as a suffix, not a subdomain', () => {
  // hostname must END WITH .gov.br — a bare "gov.br" or a lookalike fails.
  assert.equal(isAllowedSefazUrl('https://gov.br/'), false);
  assert.equal(isAllowedSefazUrl('https://notgov.br/'), false);
});

test('rejects strings that are not URLs at all', () => {
  assert.equal(isAllowedSefazUrl('not a url'), false);
  assert.equal(isAllowedSefazUrl(''), false);
  assert.equal(isAllowedSefazUrl('ftp://dfe-portal.svrs.rs.gov.br/'), false);
});
