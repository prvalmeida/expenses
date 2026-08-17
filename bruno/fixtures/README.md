# Fixtures

Gitignored on purpose. The requests in `Bills/` and `Receipts/` expect:

- `sample-bill.pdf` — uma fatura **sintética e redigida**, sem dados reais. Se estiver protegida
  por senha, envie o campo `password` no request em vez de depender do `PDF_KEY` do servidor.
- `sample-receipt.pdf` — uma NF-e sintética.

Não comite faturas ou notas reais: são dados financeiros pessoais, exatamente a classe de dado
que o plano de conformidade LGPD cobre. A senha da fatura real é o CPF do titular, então uma
fixture real também exigiria um CPF comitado.
