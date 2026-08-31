---
name: Prontidão do schema de alertas
description: Como verificar dependências Supabase da central sem impor uma chamada extra em cada requisição
---

A verificação de prontidão da central de alertas deve consultar o contrato OpenAPI do Supabase e reutilizar o resultado por um TTL curto no processo; falhas devem impedir operações dependentes com diagnóstico acionável.

**Why:** consultar o schema em toda leitura ou mutação aumentaria a latência e a carga, enquanto deixar a falha aparecer somente no uso produz erro genérico e difícil de corrigir.

**How to apply:** ao adicionar novas dependências do schema à central, inclua-as no checker, mantenha o cache com expiração para permitir recuperação após migration e preserve respostas 503 estruturadas. Para jobs de retenção e outros RPCs administrativos, valide a presença das funções via OpenAPI antes do cenário destrutivo, separando schema incompleto de falha de acesso.