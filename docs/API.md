# API pública v1

Base: `/api/v1`. Especificação de máquina: [`public/openapi.yaml`](../public/openapi.yaml),
**gerada** a partir dos schemas Zod (`npm run gen:openapi`) — não edite à mão.

As rotas antigas (`/api/expenses`, `/api/income`, `/api/bills/*`, `/api/receipts/*`) continuam
existindo com o contrato atual: são as que a UI usa e não exigem credencial.

## Autenticação

Toda rota `/api/v1/*` exige a chave estática configurada em `API_KEY`:

```
x-api-key: <API_KEY>
# ou
Authorization: Bearer <API_KEY>
```

Se `API_KEY` não estiver definida no servidor, **todas** as rotas respondem 401 — a guarda falha
fechada, porque tratar chave ausente como "sem autenticação" transformaria um deploy mal
configurado em um banco financeiro aberto.

## Envelope

Sucesso:

```json
{ "data": { } }
```

Erro:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Payload inválido.", "details": { "value": ["Valor deve ser positivo"] } } }
```

`details` só aparece em erros de validação e mapeia `campo → [mensagens]`.

| Código | HTTP | Significado |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Chave ausente, inválida, ou API sem `API_KEY` configurada |
| `VALIDATION_FAILED` | 400 | Payload malformado — bug do chamador |
| `INVALID_CATEGORY` | 400 | Payload válido, mas a categoria não existe — releia `/v1/categories` |
| `NOT_FOUND` | 404 | Registro inexistente |
| `PDF_PASSWORD_REQUIRED` | 422 | Senha do PDF da fatura incorreta |
| `DOCUMENT_UNREADABLE` | 422 | PDF sem texto extraível, ou portal sem conteúdo |
| `UPSTREAM_FAILED` | 502 | Falha ao acessar o portal SEFAZ |
| `INTERNAL_ERROR` | 500 | Falha não prevista (detalhes só no log do servidor) |

`VALIDATION_FAILED` e `INVALID_CATEGORY` são distintos de propósito: o primeiro é um bug do
chamador, o segundo é recuperável relendo a lista de categorias.

## Categorias são dinâmicas

Categorias e subtipos vivem na coleção `Category` e são editáveis pelo usuário em tempo de
execução. Nenhuma lista fica congelada no schema. Consulte antes de escrever:

```
GET /api/v1/categories?kind=expense
```

## Gastos

### Criar uma compra parcelada com uma chamada

```
POST /api/v1/expenses
{
  "name": "Notebook",
  "value": 6000,
  "type": "compras",
  "subtype": "Eletrônicos",
  "paymentType": "credit",
  "cardBrand": "Master Santander",
  "date": "2026-08-10",
  "installments": 6
}
```

Retorna os 6 registros e o `transactionId` compartilhado. Cada parcela recebe `date` avançando
um mês (com o dia truncado ao último dia do mês quando necessário) e `effectiveDate` derivado do
ciclo do cartão — o chamador nunca calcula data de vencimento.

- `value` é o **total** da compra por padrão; envie `"valueIsTotal": false` quando o número já for
  o valor de uma parcela (é assim que uma linha de fatura chega).
- `paymentType` diferente de `credit` proíbe `cardBrand`, `installment` e `totalInstallments`:
  a união discriminada rejeita a combinação com `VALIDATION_FAILED`.

### Ler

```
GET /api/v1/expenses?dateField=effectiveDate&from=2026-08-01&to=2026-08-31&limit=100
```

`dateField` escolhe entre a data da compra (`date`) e a data do fluxo de caixa (`effectiveDate`) —
o mesmo registro pertence a meses diferentes conforme a pergunta. A paginação é por cursor:
repasse `nextCursor` como `cursor` até vir `null`.

### Alterar e excluir

- `PUT /api/v1/expenses/{id}` substitui os oito campos editáveis; `PATCH` altera um subconjunto.
  `transactionId`, `installment` e `totalInstallments` nunca são aceitos — um grupo de parcelas se
  refaz reimportando, não editando uma parcela.
- Mudar `paymentType` de `credit` para outro valor remove `cardBrand`, `installment` e
  `totalInstallments` do registro.
- `DELETE /api/v1/expenses/{id}` apaga um registro; `DELETE /api/v1/expenses/transactions/{transactionId}`
  apaga a compra inteira.

## Receitas

CRUD completo em `/api/v1/incomes` (plural — `/api/income` no singular é a rota interna da UI).
Todo write valida `type` contra as categorias de receita.

## Fatura (PDF do cartão) — ida e volta

1. `POST /api/v1/bills/parse` (multipart: `file`, `cardBrand`, `password` opcional)
   → `{ items, cardBrand, closingDate, dueDate }`.
   `password` só é necessário para faturas protegidas; o padrão é o `PDF_KEY` do servidor.
   Cada item traz `type`/`subtype` sugeridos (`recognized: false` quando não houve classificação
   automática) e `isPossibleDuplicate` como aviso.
2. Classifique os itens com `type: null` e reenvie o mesmo payload:
   `POST /api/v1/bills/import` com `{ items, cardBrand, closingDate, dueDate, newMappings }`.
   `newMappings` ensina a classificação para as próximas faturas.
3. A resposta é `{ imported, skippedInvalid, skippedExisting }` — três números que nunca se
   somam em um só:
   - `skippedInvalid` é o único acionável: são itens com `type: null` ou com categoria que não
     existe mais. Corrija e reenvie **apenas esses** itens.
   - `skippedExisting` é o resultado esperado de faturas com sobreposição de parcelas; não é erro.
   - Um `subtype` inválido para o `type` é descartado silenciosamente e o item **é** importado.

## NF-e (nota fiscal) — ida e volta

1. `POST /api/v1/receipts/parse`, de duas formas:
   - multipart com `file` (PDF da nota), ou
   - JSON `{ "url": "https://...sefaz...gov.br/..." }`. Só links `https` em domínio `*.gov.br`
     contendo `sefaz`, `nfce`, `nfe` ou `dfe` são aceitos (proteção contra SSRF).
2. `POST /api/v1/receipts/import` com os itens confirmados, `newMappings`, `storeDefaultType` e
   `installments`.
3. Diferente da fatura, **um par (type, subtype) inválido rejeita o lote inteiro** com
   `INVALID_CATEGORY`: uma nota é uma compra só, e uma importação parcial deixaria o chamador
   reconciliando à mão.

## Apoio

- `GET /api/v1/categories?kind=expense|income` — categorias e subtipos válidos.
- `GET /api/v1/card-cycles?brand=...&month=8&year=2026` — fechamento e vencimento do ciclo, para
  prever o `effectiveDate` que um POST vai derivar.

Ambas são somente leitura: gravar um ciclo recalcula o `effectiveDate` de gastos já existentes,
o que é uma ação de operador e não de um chamador externo.

## Limitações conhecidas

A chave estática autentica, mas não identifica quem chamou: não há atribuição por chamador,
rate limiting nem trilha de auditoria. `bills/parse` e `receipts/parse` chamam a OpenAI a cada
requisição e são, portanto, um vetor direto de amplificação de custo.
