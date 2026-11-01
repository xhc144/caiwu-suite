import { readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createTestApp } from '@caiwu/testkit';
import server from '../server';
import { integrationModules } from './template-fixtures';
import type { TemplateBookInput, TemplateFacts } from '../shared';

const cas22: TemplateFacts = {
  guaranteeStandard: 'cas22',
  financialGuaranteeContract: true,
  designatedAtFairValue: false,
};
const cas25: TemplateFacts = {
  ...cas22,
  guaranteeStandard: 'cas25',
  previouslyAssertedInsurance: true,
  usedInsuranceAccounting: true,
  irrevocableContractElection: true,
};
const bookInput = (templateId: string, facts?: TemplateFacts): TemplateBookInput => ({
  name: '适用性测试',
  orgName: '合成单位',
  product: 'chengben',
  templateId,
  startYear: 2026,
  startMonth: 1,
  adminPassword: 'admin',
  facts,
});

it.each(['core', 'module'] as const)(
  'w_xt_kgzb_a2 / a5 / 3：%s入口拒绝不写文件，同一请求修正后可成功、重试及重开',
  async (entry) => {
    const app = await createTestApp({ modules: [...integrationModules], seed: false });
    try {
      const api = app.call(server, null);
      const create = entry === 'core' ? app.core(null).books.create : api.createBook;
      const catalog = await api.originalCatalog();
      expect(catalog).toHaveLength(44);
      expect(catalog.find((r) => r.file === 'a05.acd')?.registered).toEqual([
        'books-small-business',
      ]);
      const before = readdirSync(app.runtime.bookStore.booksDir).sort();
      const input = {
        ...bookInput('financing-guarantee-cas25-2026', cas25),
        requestKey: 'eligibility-retry-001',
      };
      for (const invalid of [
        { ...input, startYear: 2025 },
        { ...input, facts: undefined },
        { ...input, facts: { ...cas25, previouslyAssertedInsurance: false } },
        { ...input, facts: { ...cas25, guaranteeStandard: 'cas22' as const } },
        bookInput('party-dues-jining-port-2021'),
      ]) {
        await expect(create(invalid)).rejects.toThrow();
        expect(readdirSync(app.runtime.bookStore.booksDir).sort()).toEqual(before);
      }
      const preview = await api.checkCreation(input);
      expect(preview.allowed).toBe(true);
      const [book, retry] = await Promise.all([create(input), create(input)]);
      expect(book.id).toBe(retry.id);
      expect(book).toMatchObject({ templateId: input.templateId, startPeriod: 202601 });
      const { token } = await app
        .core(null)
        .auth.login({ bookId: book.id, userCode: 'admin', password: 'admin' });
      const rows = await app.core(token).accounts.list();
      expect(rows.find((a) => a.code === '2603')?.disabled).toBe(false);
      await app.runtime.bookStore.close(book.id);
      expect(await app.core(token).accounts.list()).toEqual(rows);
      expect(await create(input)).toEqual(book);
      const otherEntry = entry === 'core' ? api.createBook : app.core(null).books.create;
      expect(
        await otherEntry({ ...input, facts: Object.fromEntries(Object.entries(cas25).reverse()) }),
      ).toEqual(book);
      await expect(create({ ...input, orgName: '不同单位' })).rejects.toThrow();
    } finally {
      await app.close();
    }
  },
);

it('w_xt_kgzb_a2：金融工具和保险合同分别显式选择，错误模板ID不因预检成功而创建', async () => {
  const app = await createTestApp({ modules: [...integrationModules], seed: false });
  try {
    const api = app.call(server, null);
    for (const [id, facts] of [
      ['financing-guarantee-cas22-2026', cas22],
      ['financing-guarantee-cas25-2026', cas25],
    ] as const) {
      const selected = bookInput(id, facts);
      expect((await api.checkCreation(selected)).allowed).toBe(true);
      expect((await api.createBook(selected)).templateId).toBe(id);
    }
    await expect(api.checkCreation(bookInput('missing-template'))).rejects.toThrow('不存在');
    await expect(api.createBook(bookInput('missing-template'))).rejects.toThrow('不存在');
    expect((await api.creationPolicies()).map((p) => p.templateId)).toContain(
      'resident-medical-insurance-2026',
    );
  } finally {
    await app.close();
  }
});
