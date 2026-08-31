---
name: Testes de rotas Amazon
description: Compatibilidade do runner esbuild com o logger do API server em testes de rotas
---

Ao testar rotas que importam o logger do API server no runner esbuild, mantenha `pino` e `pino-http` como módulos externos.

**Why:** o bundle de teste pode transformar requires dinâmicos internos do Pino em um stub de require incompatível com módulos nativos como `node:os`, fazendo a suíte falhar antes de executar os testes.

**How to apply:** ao adicionar entradas de teste que importem o router Amazon completo, atualize a lista de externos do runner antes de interpretar a falha como erro da rota.