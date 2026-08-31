---
name: Sessões Clerk no preview
description: Diferença entre a sessão do navegador do usuário e a sessão usada pelo Agent ao diagnosticar previews autenticados.
---

A sessão Clerk do navegador do usuário não fica disponível no navegador isolado usado pelo Agent para screenshots e previews. Uma tela de login no screenshot do Agent não contradiz uma sessão ativa no navegador do usuário.

**Por que:** os dois contextos têm jars de cookies e armazenamento local separados; transportar ou solicitar cookies/tokens seria inseguro e não é necessário.

**Como aplicar:** confirme o navegador do usuário por requisições autenticadas do backend — por exemplo, rotas protegidas retornando 200/304 e chamadas de sessão Clerk bem-sucedidas — e não conclua que o login falhou apenas porque o screenshot do Agent está deslogado. Um teste que exige a sessão deve ser clicado no navegador autenticado do usuário quando não houver uma ferramenta de interação compartilhada.