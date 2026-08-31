---
name: Travas de manutenção distribuídas
description: Padrão para impedir jobs periódicos duplicados entre réplicas que acessam o banco via REST
---

Jobs periódicos executados por réplicas independentes devem usar uma locação singleton persistida no banco, com token exclusivo, expiração e RPCs atômicos de aquisição/liberação; a trava em memória fica apenas como atalho local.

**Why:** chamadas REST separadas não compartilham uma sessão PostgreSQL, então advisory locks de sessão não atravessam a aquisição, a varredura e a liberação. O token impede que uma execução antiga libere a locação de uma execução posterior após expirar.

**How to apply:** adquira a locação antes da primeira leitura do job, encerre sem executar mutações quando a aquisição retornar falso e libere em `finally`, tratando falha de liberação como observabilidade e não como erro que substitui o resultado principal.