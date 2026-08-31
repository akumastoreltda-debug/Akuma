---
name: Amazon sync test runner
description: Como executar fixtures da sincronização sem embutir o SDK de conectores.
---

Os testes da sincronização Amazon devem compilar o fixture com esbuild e manter `@replit/connectors-sdk` externalizado.

**Why:** O SDK usa `require` dinâmico; embuti-lo em um bundle ESM de teste falha antes de qualquer fixture executar, mesmo sem chamadas ao Supabase.

**How to apply:** Ao criar testes para o módulo Amazon, reutilize o runner do artefato e deixe o SDK ser resolvido externamente; os testes devem usar clientes e armazenamento em memória.