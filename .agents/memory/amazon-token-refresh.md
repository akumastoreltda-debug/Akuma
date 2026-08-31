---
name: Amazon token refresh
description: Regra de concorrência para cache e renovação de tokens LWA.
---

O refresh do token LWA deve ser single-flight e uma resposta 401 só pode invalidar o token que foi usado naquela requisição.

**Why:** Chamadas paralelas podem receber 401 em momentos diferentes; invalidar cegamente o cache pode apagar um token mais novo e iniciar uma tempestade de renovações.

**How to apply:** Compare o valor do token que falhou com o cache atual antes de invalidar e reutilize a promessa de refresh em andamento, inclusive quando várias chamadas precisam repetir a requisição.