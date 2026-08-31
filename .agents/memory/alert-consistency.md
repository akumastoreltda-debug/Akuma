---
name: Consistência de alertas
description: Regra para reconhecer alertas com múltiplas instâncias da API
---

Mutações do mesmo reconhecimento de alerta devem adquirir uma trava transacional compartilhada no banco e retornar a linha persistida pela própria transação; uma fila em memória só pode ser uma otimização local.

**Why:** réplicas independentes não compartilham memória, e um upsert concorrente sem um ponto de ordenação compartilhado pode produzir respostas divergentes ou perder a ordem efetiva de `updated_at`.

**How to apply:** ao alterar o reconhecimento ou a contagem de alertas, preserve o RPC transacional por `(owner, alert)` e gere timestamps depois de adquirir a trava; mantenha testes com clientes independentes.