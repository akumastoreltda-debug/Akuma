---
name: Overrides de autofix pnpm
description: Como evitar upgrades incompatíveis gerados por overrides automáticos de segurança.
---

Overrides gerados por `pnpm audit --fix` com apenas um limite inferior podem resolver para uma major mais nova e incompatível. Prefira a primeira versão corrigida dentro da série já usada quando o consumidor depende da API daquela major.

**Why:** Um autofix de dependência transitiva escolheu uma major posterior que removeu a forma de exportação esperada pelo gerador de contratos, quebrando o build apesar de eliminar o CVE.

**How to apply:** Depois do autofix, confira as versões realmente resolvidas e execute contratos/build. Se houver salto de major não necessário, restrinja o override à versão corrigida compatível e regenere o lockfile.