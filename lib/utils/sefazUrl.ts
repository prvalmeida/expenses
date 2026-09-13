// SEFAZ URL allowlist — the SSRF guard for every path that fetches a receipt
// URL server-side. Lives here (not in receiptService) so the client-side QR
// scanner can validate a scanned link without importing mongoose/pdf-parse
// into the browser bundle. receiptService imports it too; there is exactly
// one owner of this list.

const ALLOWED_KEYWORDS = ['sefaz', 'nfce', 'nfe', 'dfe'];

export function isAllowedSefazUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.gov.br') &&
      ALLOWED_KEYWORDS.some(kw => url.hostname.includes(kw))
    );
  } catch {
    return false;
  }
}
