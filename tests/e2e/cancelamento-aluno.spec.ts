// Scaffold Playwright — portal-aluno-personal (Portal do Aluno).
// NÃO EXECUTÁVEL ainda: @playwright/test não instalado e a UI não existe.
// Testes em .skip de propósito. Preencher na ETAPA 6+.
//
// @ts-nocheck
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5174';

test.describe('Cancelamento (aluno)', () => {
  test.skip('vê a política do personal antes de solicitar', async ({ page }) => {
    // TODO ETAPA 6: política visível + disclaimer "valor depende da análise".
    await page.goto(BASE);
    expect(true).toBe(true);
  });

  test.skip('solicita cancelamento com aviso externo', async () => {
    // TODO ETAPA 6: aula elegível + motivo + canal/momento do aviso + enviar.
  });

  test.skip('é impedido de abrir 2ª solicitação para a mesma aula', async () => {
    // TODO ETAPA 6: feedback de duplicidade (índice único parcial no banco).
  });

  test.skip('acompanha decisão e contesta', async () => {
    // TODO ETAPA 6/7: status, decisão financeira, contestação.
  });
});
