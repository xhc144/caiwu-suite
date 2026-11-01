import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { coreRouter, createRuntime, t } from '@caiwu/server-kit';
import { integrationModules } from './template-fixtures';
import type { TemplateBookInput, TemplateFacts } from '../shared';

const facts: TemplateFacts = {
  guaranteeStandard: 'cas25',
  financialGuaranteeContract: true,
  designatedAtFairValue: false,
  previouslyAssertedInsurance: true,
  usedInsuranceAccounting: true,
  irrevocableContractElection: true,
};
const input: TemplateBookInput = {
  name: '宿主建账校验',
  orgName: '合成担保单位',
  templateId: 'financing-guarantee-cas25-2026',
  startYear: 2026,
  startMonth: 1,
  product: 'qingsong',
  adminPassword: 'admin',
  facts,
  requestKey: 'host-creation-policy-001',
};

it('w_xt_kgzb_a2 / a5：core真实入口和运行时建账在创建文件前拒绝日期、范围、担保事实，不能用预检结果绕过', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-template-host-'));
  const app = createRuntime({ dataDir, modules: integrationModules, devMode: false });
  const api = t.createCallerFactory(coreRouter)({ app, token: null });
  try {
    await app.lifecycle.start();
    const before = readdirSync(app.bookStore.booksDir).sort();
    const invalid = [
      { ...input, startYear: 2025 },
      { ...input, startMonth: 0 },
      { ...input, facts: undefined },
      { ...input, facts: { ...facts, usedInsuranceAccounting: false } },
      { ...input, facts: { ...facts, guaranteeStandard: 'cas22' as const } },
      { ...input, facts: { ...facts, designatedAtFairValue: true } },
      { ...input, facts: { usedInsuranceAccounting: 'true' } },
      { ...input, templateId: 'school-canteen-anhui-2021', facts: undefined },
      { ...input, templateId: 'party-dues-jining-port-2021', facts: undefined },
    ];
    for (const rejected of invalid) {
      const attempt = api.books.create(rejected);
      await expect(attempt).rejects.toThrow();
      if (rejected.facts?.usedInsuranceAccounting === 'true')
        await expect(attempt).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: '制度适用条件格式不正确，不能新建账套',
        });
      await expect(app.bookStore.create(rejected)).rejects.toThrow();
      expect(readdirSync(app.bookStore.booksDir).sort()).toEqual(before);
      expect(await api.books.list()).toEqual([]);
    }
    expect(
      app.templates.list().find((t) => t.id === 'resident-medical-insurance-2026')?.accountCount,
    ).toBe(59);
  } finally {
    await app.lifecycle.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

it('w_xt_kgzb_a2：静态制度在生命周期启动前同样有建账校验', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-template-static-'));
  const app = createRuntime({ dataDir, modules: integrationModules, devMode: false });
  try {
    await expect(
      app.bookStore.create({
        ...input,
        templateId: 'nonprofit-2026',
        startYear: 2025,
        facts: undefined,
      }),
    ).rejects.toThrow('不能用于');
    expect(readdirSync(app.bookStore.booksDir)).toEqual([]);
  } finally {
    await app.bookStore.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
