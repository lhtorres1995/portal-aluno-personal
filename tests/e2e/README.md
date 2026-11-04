# Testes E2E (Playwright) — portal-aluno-personal (Portal do Aluno)

> **Scaffold apenas.** Nenhuma interface foi modificada. Dependências do
> Playwright **não** instaladas; specs em `.skip`. Cenários reais na ETAPA 6+.

## Preparar (quando for implementar a UI)

```bash
cd portal-aluno-personal
npm i -D @playwright/test
npx playwright install chromium
```

O dev server do Vite deste portal roda na **porta 5174** (ver CLAUDE.md).

## Regras

- **Nunca** rodar contra produção nem com dados reais. Usar projeto Supabase de
  teste e um aluno de teste (pré-cadastrado por um personal de teste, com
  `auth_user_id` vinculado).
- Preservar a identidade visual aprovada (heros "Proposta 2", `#nav-drawer`).

## Cenários planejados (ETAPA 6+)

- Visualizar a política vigente do próprio personal (somente leitura) antes de
  solicitar e nos detalhes da aula, com o aviso de que o valor definitivo
  depende da análise do personal.
- Solicitar cancelamento: selecionar aula elegível, motivo, bloco "avisei por
  outro meio" (canal + quando), enviar.
- Impedir 2ª solicitação aberta para a mesma aula (feedback de duplicidade).
- Acompanhar o andamento (status) e ver a decisão financeira.
- Contestar um cancelamento (não reativa aula nem muda valor).
