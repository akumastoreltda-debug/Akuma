---
name: Acesso MCP do Supabase
description: Conexões Supabase MCP podem aparecer como saudáveis sem montar funções SQL executáveis na sessão do agente.
---

O conector Supabase REST e uma conexão MCP Supabase são superfícies diferentes: REST não executa DDL, e uma conexão MCP só pode ser usada quando as funções MCP documentadas estiverem montadas na sessão.

**Why:** Uma conexão `custom-mcp` pode estar adicionada e saudável, mas ainda expor apenas `proxyFetch`; usar esse proxy como substituto do MCP ou usar o PostgreSQL do Replit não aplica migrations no projeto Supabase correto.

**How to apply:** Para migrations externas, confirme primeiro uma função MCP SQL montada ou outro canal SQL autorizado para o mesmo projeto. Se o usuário recusar a autorização e só REST estiver disponível, pare sem trocar credenciais ou banco.