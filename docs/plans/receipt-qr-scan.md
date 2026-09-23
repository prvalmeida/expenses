# Plan — Ler o QR code da nota fiscal com a câmera do celular

Status: **planned** (not yet implemented)
Created: 2026-09-13

No mobile, o fluxo "Link da Nota" da view `importReceipt` exige copiar/colar manualmente a URL do
portal SEFAZ que está impressa no QR code do cupom da NFC-e. Este plano adiciona um botão de
escanear que abre a câmera, lê o QR, preenche o campo de link e dispara o parse — sem nenhuma
mudança de API, porque o QR da NFC-e codifica exatamente a URL que o campo já aceita e
`/api/receipts/parse-url` já valida contra a allowlist SEFAZ.

Decisões assumidas (perguntas ao usuário ficaram sem resposta; defaults adotados, todos reversíveis):

- **Navegadores-alvo: Android Chrome e iPhone Safari** (faz o fallback JS obrigatório — ver Modo A).
- **Pós-scan: preencher o link e processar a nota automaticamente.** Reverter a fill-only é
  remover uma chamada no wiring (Passo 5).
- **Posição do botão: dentro do modo "Link da Nota"**, ao lado do campo de URL — não um terceiro
  modo no seletor, para não fragmentar a entrada (o resultado do scan é sempre uma URL).

---

## Modo A — decisão técnica: mecanismo de leitura de QR no browser

### Problem statement

Ler um QR code no browser exige decodificar frames de `getUserMedia`. Existem três mecanismos:
a API nativa `BarcodeDetector`, uma lib JS pura (`jsQR` ou `@zxing/library`), ou uma combinação.
A escolha é forçada agora porque sem ela o scan não funciona no iPhone.

### Constraints that decide this

1. **Suporte real dos navegadores-alvo.** BCD (mdn/browser-compat-data, verificado hoje):
   `BarcodeDetector` — Chrome Android 83+, Chrome desktop apenas macOS/ChromeOS (partial),
   Safari 17+ **atrás de flag**, Firefox **não implementado** (bug 1553738). A API nativa sozinha
   não cobre iPhone, que é metade dos celulares.
2. **Complexidade operacional é o recurso mais escasso** (skill do repo): preferir o caminho com
   menos código-caminho e menos branching por feature-detection.
3. **Peso no bundle importa no mobile** — a view `importReceipt` é client-side.
4. **Nada duplicado** (regra dura #6): a validação "é uma URL SEFAZ válida?" já existe em
   `isAllowedSefazUrl` e não pode ganhar uma cópia no client.

### Options considered

| Opção | Prós | Contras | Fit com o stack atual |
|---|---|---|---|
| 1. `jsQR` (npm, dynamic import) | Uma única code path, funciona em todo browser com `getUserMedia` (Android Chrome, iPhone Safari, Firefox, desktop); zero deps transitivas; ships TS types próprias; Apache-2.0; QR-only (~250 KB unminified, carregado só no clique via `import()` dinâmico — custo zero até o usuário escanear) | Sem releases desde 2021-04 (v1.4.0) — porém decodificação de QR é matemática estável de padrão ISO, sem superfície de ataque em evolução | Cliente puro, webpack bundla em chunk separado; sem qualquer preocupação de standalone-tracing/Dockerfile (ao contrário de pdfjs-dist, que é server-side) |
| 2. `BarcodeDetector` nativo + `jsQR` fallback | Acelerado por hardware no Chrome Android | Duas code paths, `declare global` para tipos (TS não trás `BarcodeDetector` no `lib.dom.d.ts` — verificado), feature-detection, e o fallback jsQR seria baixado de qualquer forma na maioria dos casos | Viola o gosto do repo por mecanismo único; ganho marginal só para Chrome Android |
| 3. `@zxing/library` | Mantido ativamente, muitos formatos | Muito maior e mais complexo que o necessário (formatos 1D que o app nunca usará), API mais verbosa | Overkill: o QR da NFC-e é sempre QR code |

### Recommendation

**Opção 1 — `jsQR` apenas, importado dinamicamente no início do scan.**

**Rationale:** uma única code path cobre 100% dos navegadores-alvo; o `import()` dinâmico zera o
custo de bundle até o clique no botão; zero deps transitivas e tipos próprios eliminam atrito de
integração. A ausência de manutenção é aceitável: QR é padrão fechado e a lib é amplamente usada.

**Risks and mitigations:** um QR danificado pode decodificar para texto inválido — mitigado no
wiring (Passo 5): o texto lido cai no input e a mensagem de erro mostra o que foi lido para correção
manual. Se um dia o jsQR precisar ser trocado, o uso fica confinado ao hook (`useQrScanner`).

**Reversibility:** alta — o hook é o único ponto de contato com a lib; trocar por um wrapper de
`BarcodeDetector` não altera a UI nem a validação.

### What NOT to do

- **Não usar `BarcodeDetector` sem fallback** — quebra iPhone Safari (flag-only) e Firefox.
- **Não usar uma lib de scan que abre a própria página** (html5-qrcode com UI embutida) — outro
  estilo visual e outra superfície de dependência para um overlay que o Tailwind do app resolve
  com ~30 linhas de JSX.
- **Não validar a URL do scan com uma regex nova no client** — duplicaria `isAllowedSefazUrl`
  (regra dura #6). Extrair para `lib/utils/` (Passo 2) mantém uma única fonte de verdade.
- **Não importar de `lib/services/receiptService.ts` no client** — o módulo puxa mongoose,
  `pdf-parse` e models para o bundle do browser. Por isso a extração do Passo 2 é pré-requisito.

---

## Modo B — passos

## Goal

Um botão "📷 Escanear QR" no modo "Link da Nota" da view `importReceipt` que abre a câmera traseira
no navegador do celular, lê o QR code da NFC-e, preenche o campo de link e processa a nota.

## Affected files

- `package.json` — nova dependência `jsqr` (runtime, client chunk)
- `lib/utils/sefazUrl.ts` (novo) — extração pura de `isAllowedSefazUrl`
- `lib/services/receiptService.ts` — passa a importar o predicate de `lib/utils/sefazUrl.ts`
- `tests/sefaz-url.test.ts` (novo) — unit tests do predicate extraído
- `hooks/useQrScanner.ts` (novo) — ciclo de vida da câmera + loop de decode
- `components/QrScannerModal.tsx` (novo) — overlay com `<video>` e estados
- `app/ImportReceipt.tsx` — botão de scan no modo URL, estado do modal, wiring scan→fill→parse
- `CLAUDE.md` — parágrafo do receipt import (linha ~95) menciona o scan

Nenhum arquivo de API muda: `/api/receipts/parse-url` e `/api/v1/receipts/parse` (JSON) já
recebem `{ url }` e já validam a allowlist. Nenhum schema Zod muda → `public/openapi.yaml` não
regenera.

## Steps

### 1. [Infra] Adicionar `jsqr` como dependência

**What:** `npm install jsqr` (v1.4.0, runtime dep). Nada de config: webpack client-bundla; sem
entrada em `serverExternalPackages` (não é server-side) e sem COPY no Dockerfile (client chunk é
traced normalmente, ao contrário do caso pdfjs-dist documentado em CLAUDE.md).
**Why:** única forma de cobrir iPhone Safari; e caro zero até o clique por ser importada
dinamicamente no Passo 3.
**Depends on:** none.

### 2. [Util] Extrair `isAllowedSefazUrl` para `lib/utils/sefazUrl.ts`, com unit tests

**What:** Mover o predicate puro (`receiptService.ts:34-47`, incluindo o comentário sobre o guard
SSRF) para `lib/utils/sefazUrl.ts`, arquivo sem imports (nada de mongoose/next). `receiptService.ts`
passa a importá-lo de lá; a chamada que lança `ApiError` (linha 100-105) fica onde está. Escrever
`tests/sefaz-url.test.ts` primeiro (TDD), cobrindo: URL `dfe-portal.svrs.rs.gov.br` válida, `http://`
recusado, domínio não-`.gov.br` recusado, `.gov.br` sem keyword (sefaz/nfce/nfe/dfe) recusado,
string não-URL recusada.
**Why:** o hook do client precisa validar o texto lido antes de disparar o parse (feedback
instantâneo, sem round-trip para descobrir "URL não permitida"), e não pode importar de
`receiptService` sem arrastar mongoose/pdf-parse para o browser. Extração, não cópia — a allowlist
continua tendo um único dono. Os tests prendem o comportamento no refactor.
**Depends on:** none (independente do Passo 1).
**Verificação:** `npm run test:unit` passa; `cd bruno` request `02-reject-non-sefaz-url.bru` segue
rejeitando (a rota chama o mesmo predicate).

### 3. [UI/Hook] `hooks/useQrScanner.ts` — câmera + loop de decode

**What:** Hook client-only que, no start: pede o stream com `getUserMedia({ video: { facingMode: { ideal: 'environment' } } })`,
faz `import('jsqr')` dinamicamente, anexa o stream a um `<video>` ref com `playsInline` (iOS abre
fullscreen sem isso) e roda um loop `requestAnimationFrame` decodificando `getImageData` do frame
atual; expõe estados `idle | scanning | error` , a string lida e um `stop()`. Cleanup: cancelar o
rAF e `track.stop()` em todo caminho de saída (stop manual, unmount, sucesso do scan). Erros de
permissão/não-câmera mapeados para mensagens pt-BR ("Acesso à câmera negado...", "Nenhuma câmera
encontrada").
**Why:** hook é o padrão do repo (`hooks/useCategories.ts`) e isola toda a API de browser
(não testável por runner — AGENTS.md regra 9 não se aplica; a validação pura foi para o Passo 2
justamente para ter teste).
**Depends on:** Passo 1 (jsqr instalado) e Passo 2 (valida o scan com `isAllowedSefazUrl`).
**Verificação:** `npm run build` (client chunk compila); lint limpo.

### 4. [UI] `components/QrScannerModal.tsx` — overlay de escaneamento

**What:** Componente client com overlay fixed cobrindo a tela: `<video>` em tela cheia com máscara
de cantos de QR (bordas Tailwind), botão "Cancelar"/"Fechar" (acessível, fecha o modal), estados de
texto pt-BR ("Aponte para o QR code da nota") e a mensagem de erro do hook. Chama `onScanned(text)`
quando o hook lê algo **válido**; se o texto lido não passa em `isAllowedSefazUrl`, chama
`onScanned` com o valor mesmo assim e o wiring (Passo 5) mostra o erro — a câmera para.
**Why:** `ImportReceipt.tsx` já tem 572 linhas; o overlay é autocontido e segue o precedente de
componente single-use em `components/` (`NavMenu`).
**Depends on:** Passo 3.
**Verificação:** lint/build.

### 5. [Wiring] Botão de scan no modo "Link da Nota" + auto-parse

**What:** Em `app/ImportReceipt.tsx`: (a) extrair de `handleParse` (linhas 74-120) um
`parseFromUrl(url: string)` que recebe a URL como argumento em vez de ler o state — o botão
"Processar Nota" passa a chamá-lo com o valor do campo; (b) no JSX do modo URL (linhas 300-312),
adicionar botão "📷 Escanear QR" ao lado do campo (visível também em desktop — `getUserMedia`
funciona com webcam), que abre o modal do Passo 4; (c) no `onScanned(text)`: `setReceiptUrl(text)`,
e se `isAllowedSefazUrl(text)` → `parseFromUrl(text)` (auto-processar); senão → `setError` com
"Não é um link de nota fiscal (portal SEFAZ)" e o texto fica no campo para correção manual.
**Why:** o auto-parse é a decisão assumida; validar antes de disparar evita um POST condenado e
dá feedback imediato. O refactor (a) existe porque o state do React não está disponível
sincronamente no callback do scan.
**Depends on:** Passos 2, 3, 4.
**Verificação:** fluxo manual (abaixo).

### 6. [Docs] CLAUDE.md

**What:** No parágrafo do receipt import (~linha 95), uma frase: o modo "Link da Nota" também
aceita ler o QR da NFC-e com a câmera (`hooks/useQrScanner.ts` + jsQR via dynamic import); a
validação do link vive em `lib/utils/sefazUrl.ts`, compartilhada com o serviço.
**Why:** o parágrafo descreve a view; e a localização única da allowlist é um invariant que o
CLAUDE.md deve registrar no mesmo change (regra do AGENTS.md).
**Depends on:** Passos 2-5.
**Nota:** `docs/API.md` não muda (nenhuma rota nova). `public/openapi.yaml` não regenera (nenhum
schema muda).

### 7. [Verify] CI completo no local + checklist mobile

**What:** Rodar os quatro passos de CI e reportar output real: `npx eslint --max-warnings=0`, `npm run gen:openapi -- --check`, `npm run test:unit`, `npm run build`.
Checklist manual de acceptance:
1. Desktop Chrome: botão abre webcam, aponta para QR de teste, link preenche e processa.
2. Android Chrome (HTTPS em prod, ou localhost): câmera traseira abre, scan de nota real processa.
3. iPhone Safari: idem — valida que `playsInline` evitou fullscreen e que jsQR decodificou.
4. QR inválido (qualquer QR não-SEFAZ): câmera para, valor aparece no campo, erro pt-BR exibido.
5. Permissão de câmera negada: mensagem de erro sem crash; cancelar/fechar funciona; reabrir
   funciona.
6. Navegar para fora da view com câmera aberta: sem track viva (ícone de câmera some do status bar).
**Why:** AGENTS.md manda reproduzir os 4 passos do CI e nunca reportar como done sem output real;
getUserMedia/decode não tem runner automatizado no repo.
**Depends on:** all.

## Breaking changes / migrations

None. Sem mudança de rota, schema, coleção ou env var.

## Deploy steps

Nenhuma além do fluxo normal (PR → merge → tag `vX.Y.Z` → imagem → Easypanel). A câmera exige
contexto seguro: prod já é HTTPS (Easypanel); `localhost` é secure context no dev. **Não testar por
IP na LAN via http** — `getUserMedia` não existe fora de contexto seguro.

## Open questions

As três decisões assumidas no topo (navegadores-alvo, auto-parse pós-scan, posição do botão) foram
defaults adotados porque as perguntas ficaram sem resposta; o plano segue com elas, e qualquer uma
muda com um diff pequeno. Se o alvo for *só* Android Chrome no futuro, o jsQR pode ser trocado por
`BarcodeDetector` sem tocar na UI.
