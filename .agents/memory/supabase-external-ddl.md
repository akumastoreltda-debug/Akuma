---
name: DDL no Supabase externo
description: Limites de aplicação de migrations quando o workspace possui apenas URL, service role e Connector REST do Supabase.
---

`SUPABASE_URL` com `SUPABASE_SERVICE_ROLE_KEY` autentica chamadas PostgREST server-side, mas não fornece um canal para executar DDL. O Connector Supabase disponível também pode expor somente proxy REST, sem cliente SQL.

**Why:** Uma resposta PostgREST autenticada com `PGRST205` confirma acesso válido e tabela ausente, mas migrations `CREATE TABLE`/`CREATE FUNCTION` ainda exigem conexão PostgreSQL, token de gerenciamento compatível ou execução no SQL Editor do mesmo projeto.

**How to apply:** Antes de prometer aplicar migrations em um Supabase externo, confirme que existe um canal SQL autorizado. Nunca aplique o schema no PostgreSQL Replit como substituto, pois a aplicação continuará consultando o Supabase.