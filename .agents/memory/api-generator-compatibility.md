---
name: API generator compatibility
description: Regra para manter o contrato OpenAPI, validação Zod e cliente React sincronizados.
---

O gerador de API deve ser tratado como uma cadeia de artefatos sincronizados: alterações de endpoint ou schema precisam refletir no contrato, no Zod e no cliente React antes de serem consumidas pela interface.

**Why:** O cliente gerado pode compilar mesmo quando o servidor ainda não expõe a rota, e pequenas divergências de geração deixam o erro para o runtime ou para o parser do Vite.

**How to apply:** Ao criar ou alterar uma rota, atualize o contrato fonte e regenere os artefatos relacionados; valide os pacotes `api-server` e `amazon-profit-manager` juntos antes de reiniciar os workflows.

O typecheck do servidor pode resolver os arquivos `.d.ts` compilados de `api-zod`, mesmo quando o código-fonte gerado já está atualizado; rode o codegen do contrato para refrescar essas declarações antes de diagnosticar imports ausentes.

**Why:** A árvore de build incremental mantém declarações compiladas separadas do código-fonte e pode deixar o erro aparente apenas no pacote consumidor.

**How to apply:** Se imports gerados parecerem ausentes no `api-server`, regenere o contrato antes de editar manualmente os tipos.