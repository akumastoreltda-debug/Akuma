---
name: Montagem de callbacks Supabase
description: Comportamento observado quando conexões Supabase MCP estão adicionadas, mas suas funções SQL não aparecem na sessão do agente.
---

Conexões Supabase MCP podem aparecer como `added` e ainda assim não montar nenhum callback `mcpSupabase_*` no sandbox de execução; nesse estado, a conexão REST continua limitada ao PostgREST e não pode aplicar DDL.

**Why:** Tentar executar migration pela API REST ou pelo banco Replit aplicaria a operação no canal errado e deixaria a API consultando um schema incompleto.

**How to apply:** Confirme a disponibilidade dos callbacks antes de uma migration externa. Se estiverem ausentes, registre o erro remoto observado e aguarde uma sessão com MCP SQL montado ou outro canal SQL autorizado; não tente reautorização sem evidência de falha de credencial.