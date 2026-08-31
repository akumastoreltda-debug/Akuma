# Amazon Profit Manager

Sistema em português do Brasil para gestão financeira e operacional de uma empresa que vende na Amazon Seller Brasil. A primeira etapa cobre autenticação, catálogo de produtos, indicadores do dashboard, alertas, fornecedores e o cálculo de custo máximo recomendado de compra.

## Tecnologia

- Frontend React + TypeScript + Vite, com rotas compatíveis com a base path do Replit.
- API em Express no workspace compartilhado, pronta para ser consumida por Server Actions/API Routes caso o projeto migre para Next.js.
- Autenticação por e-mail e senha usando Clerk gerenciado.
- PostgreSQL via Supabase REST, acessado somente pelo backend através do conector seguro.
- Schema SQL em `supabase/migrations/0001_amazon_profit_manager.sql`.
- Valores monetários persistidos como `numeric`, nunca como `float`.

## Configurar o Supabase

1. Crie ou abra um projeto PostgreSQL no Supabase.
2. Execute o arquivo `supabase/migrations/0001_amazon_profit_manager.sql` no SQL Editor.
3. Mantenha o conector Supabase conectado ao ambiente do Replit. O backend usa `ReplitConnectors` e não exige copiar chaves para o código.
4. Confirme que as tabelas estão publicadas no schema `public` e que a conexão possui a chave adequada para as operações do servidor.

O arquivo de migration contém o modelo completo para usuários Clerk, produtos, fornecedores, relação produto-fornecedor, lotes de compras, vendas, taxas Amazon, movimentos de estoque, despesas, caixa, importações, alertas e configurações.

## Rodar

```bash
pnpm install
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run dev
```

O workflow do frontend inicia a interface com as variáveis de porta e base path já configuradas. O Clerk deve permanecer conectado para que as rotas protegidas respondam.

## Integração privada com Amazon Selling Partner API

A integração é executada somente no backend. Nenhum token, client secret ou refresh token é enviado ao navegador, persistido nas tabelas comuns ou incluído em respostas e logs.

### 1. Criar e autorizar a aplicação

1. No Seller Central da conta Seller Brasil, abra **Apps e serviços > Desenvolver apps**.
2. Crie uma aplicação privada com acesso a **Pedidos**, **Finanças** e **Estoque FBA**. PII de compradores não é necessária e não deve ser habilitada para este fluxo.
3. Faça a self-authorization da aplicação para a própria conta vendedora.
4. Copie o Client ID LWA, Client Secret LWA e Refresh Token gerado na autorização.
5. Por padrão, a integração usa o marketplace brasileiro `A2Q3Y263D00KWC`. O backend aceita
   `AMAZON_MARKETPLACE_ID` apenas como override opcional de ambiente; ele não é um
   Secret obrigatório.

### 2. Configurar Secrets no Replit

Cadastre os três valores abaixo como Secrets do ambiente. Nunca coloque esses valores em arquivos versionados, variáveis `VITE_*` ou campos da interface:

- `AMAZON_LWA_CLIENT_ID`
- `AMAZON_LWA_CLIENT_SECRET`
- `AMAZON_LWA_REFRESH_TOKEN`

Depois de salvar os Secrets, reinicie o workflow da API e use **Conexão Amazon > Testar conexão**.

Como os Secrets representam uma única conta Seller, o primeiro usuário Clerk autenticado
que inicializar ou testar a integração é registrado como proprietário em
`amazon_connections`. Depois disso, o backend bloqueia com 403 qualquer outro usuário
Clerk antes de consultar a Amazon ou iniciar uma sincronização. O proprietário existente
nunca é substituído automaticamente.

### 3. Banco e sincronização

Além da migration inicial, execute `supabase/migrations/0002_amazon_selling_partner.sql` e `supabase/migrations/0003_amazon_sync_integrity.sql` no SQL Editor do Supabase. Elas adicionam o estado não sensível da conexão, histórico, cursores, eventos financeiros, snapshots FBA, chaves externas de idempotência, trava por proprietário e persistência atômica do estoque.

A sincronização é manual. O fluxo completo executa pedidos pela Orders API `v2026-01-01`, finanças pela Finances API `v2024-06-19` e estoque pela FBA Inventory API no endpoint North America. Esta integração usa somente o token LWA, sem AWS SigV4 ou credenciais IAM.

Desde 2 de outubro de 2023, a Amazon informa que a SP-API não exige mais AWS IAM nem AWS Signature Version 4 em nenhuma região. As chamadas atuais usam o access token LWA no header `x-amz-access-token`: https://developer-docs.amazon.com/sp-api/changelog/sp-api-will-no-longer-require-aws-iam-or-aws-signature-version-4

## Dados de demonstração

O banco não é populado automaticamente. Se dados de demonstração forem adicionados durante o desenvolvimento, remova-os pelo módulo correspondente ou diretamente no Supabase antes de usar o sistema em produção.