# portal-aluno-personal — Portal do Aluno

Parte do ecossistema LT360. Ver [`../CLAUDE.md`](../CLAUDE.md) para arquitetura compartilhada com `treinapp` e o banco Supabase `trainer-flow`.

## Arquitetura e arquivos principais

- SPA em **JavaScript puro + Vite 5.4** (sem framework, sem TypeScript).
- `index.html` — shell único (gate de login/convite, sidebar/topbar, bottom nav, modal container). Carrega apenas `/src/main.js`.
- `src/main.js` (~1156 linhas) — toda a lógica da aplicação.
- **Atenção**: existe um `main.js` na **raiz** do repo (967 linhas) que é cópia antiga/morta — não é referenciado pelo `index.html` (que só carrega `/src/main.js`). Não editar o da raiz pensando que é o ativo; não remover sem confirmar com o usuário.
- `src/styles.css`, `styles.css` (raiz) — estilos.
- `public/` — PWA: ícones, `manifest.webmanifest`, `sw.js`.
- Não há pasta `supabase/`, `.sql` ou tipos gerados neste repositório — schema inteiramente externo (ver `../docs/ARQUITETURA-BANCO.md`).
- Sem README, sem lint, sem testes.

## Funcionalidades implementadas

- Navegação: Início, Aulas (força/funcional/cardio), Agenda, Solicitações, Financeiro, Avaliação, Perfil.
- Avaliação física (somente leitura — lançada pelo personal no `treinapp`): cards de destaque da última avaliação com delta neutro (nunca classifica variação como boa/ruim), gráfico único de evolução com seletor de métrica, comparativo de medidas e histórico expansível. Cabeçalho (desktop) com imagem de halteres (`public/img/halteres-avaliacao.webp`).
- Perfil: foto (crop via `cropperjs`, RPC `definir_foto_aluno`), alteração de senha.
- Notificações: sino com painel, Web Push (assinatura/cancelamento via `qrcode`-free VAPID flow, RPCs `salvar_push_subscription`/`remover_push_subscription`).
- PWA instalável com service worker registrado em `src/main.js`.

## Comandos de desenvolvimento

- `npm run dev` — Vite dev server (porta 5174).
- `npm run build` / `npm run preview`.
- **Não há script de teste ou lint configurado.**

## Fluxo de convite e autenticação

- Aluno é pré-cadastrado pelo personal no `treinapp` (tabela `alunos`); login usa Supabase Auth padrão (`signInWithPassword`).
- Fluxo de convite: flag `must_set_password` força o aluno a definir senha no primeiro acesso (`updateUser`).
- Sessão gerenciada via `getSession`/`onAuthStateChange`/`signOut` padrão do Supabase.

## Solicitações, contrapropostas e financeiro

- **Usa a tabela `solicitacoes` (fluxo ativo)** — não `solicitacoes_aluno` (não acessível ao aluno, ver `../CLAUDE.md`). Confirmar sempre contra esse nome antes de qualquer alteração de schema relacionada a solicitações.
- Contraproposta do personal é aceita/recusada pelo aluno via RPC `responder_contraproposta`, que aplica a remarcação (cria nova `aula`, marca a original como `remarcada`) só no aceite.
- Financeiro do aluno é somente leitura (`pagamentos`, filtrado por `alunos.auth_user_id`), exceto a confirmação de pagamento via RPC `informar_pagamento` (marca `pago_informado_em`, não altera `status` diretamente).

## Integração com o banco compartilhado

- Todas as RPCs chamadas por este portal (`definir_foto_aluno`, `informar_pagamento`, `remover_push_subscription`, `responder_contraproposta`, `salvar_push_subscription`) existem no projeto Supabase `trainer-flow` e foram **confirmadas por inspeção direta do banco** (não há `.sql` fonte em nenhum repositório — mantidas só no banco).
- Vínculo deste repo com o projeto `trainer-flow` é **inferido** (mesmas tabelas/RPCs), não confirmado via `.env` (este repo não tem `.env.example`).
- Avaliação física é lida direto das tabelas `metricas_catalogo`/`avaliacoes_fisicas`/`avaliacoes_fisicas_itens` (sem RPC própria, só SELECT sob RLS); carga tolerante — se as tabelas não existirem no servidor, a tela mostra vazio em vez de quebrar.
