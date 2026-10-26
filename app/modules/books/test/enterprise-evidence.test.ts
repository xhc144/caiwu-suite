import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseTemplate } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import legacy from '../templates/enterprise.json';
import {
  EnterpriseChartEvidenceSchema,
  parseSourcedEnterpriseTemplate,
  templateReviewWarning,
} from '../enterprise-evidence';

// 以下两行及摘要均为合成测试数据，不声称是官方科目或真实原文摘要。
const evidence = () => ({
  templateId: 'books-enterprise-synthetic',
  templateVersion: 'test-1',
  edition: '合成版本',
  publicationId: '合成文号',
  legalStatus: 'historical' as const,
  documentUrl: 'https://example.gov.cn/synthetic-test-only',
  documentSha256: '0'.repeat(64),
  tableAccountCount: 2,
  rows: [
    {
      ordinal: 1,
      code: '1002',
      name: '合成借方科目',
      category: 'asset' as const,
      tableLocator: '表第1行',
      scope: 'general' as const,
      scopeNote: '合成一般范围',
      direction: 'debit' as const,
      directionLocator: '合成说明第1项',
    },
    {
      ordinal: 2,
      code: '4001',
      name: '合成贷方科目',
      category: 'equity' as const,
      tableLocator: '表第2行',
      scope: 'general' as const,
      scopeNote: '合成一般范围',
      direction: 'credit' as const,
      directionLocator: '合成说明第2项',
    },
  ],
});
function template() {
  const source = evidence();
  return parseTemplate({
    ...legacy,
    id: source.templateId,
    version: source.templateVersion,
    name: '合成来源校验专用',
    sources: [
      {
        title: '合成测试原文（不存在真实文档）',
        file: source.documentUrl,
        note: `${source.edition}；${source.publicationId}；${source.documentSha256}`,
      },
    ],
    accounts: source.rows.map((row) => ({
      code: row.code,
      name: row.name,
      category: row.category,
      direction: row.direction,
      source: `${source.publicationId}；${source.edition}；${row.tableLocator}；${row.scopeNote}；适用:${row.scope}；${row.directionLocator}`,
    })),
  });
}

let book: TestBook | undefined;
afterEach(async () => {
  await book?.close();
  book = undefined;
});

describe('w_xt_kgzb_a2/a3 企业完整来源表结构（仅合成夹具）', () => {
  it('逐行覆盖、唯一编号、原表顺序、一级科目及方向证据完整时可解析', () => {
    expect(parseSourcedEnterpriseTemplate(template(), evidence()).template.accounts).toHaveLength(
      2,
    );
  });
  it.each([
    { tableAccountCount: 3 },
    { rows: [evidence().rows[0]] },
    { rows: [evidence().rows[1], evidence().rows[0]] },
    { rows: [evidence().rows[0], { ...evidence().rows[1], code: '1002' }] },
    { rows: [{ ...evidence().rows[0], code: '100201' }, evidence().rows[1]] },
    { rows: [{ ...evidence().rows[0], directionLocator: undefined }, evidence().rows[1]] },
    { documentUrl: 'https://example.com/table' },
    { documentUrl: 'https://mof.gov.cn.example.com/table' },
    { documentUrl: 'http://example.gov.cn/table' },
    { documentUrl: 'not-a-url' },
    { documentUrl: 'https://synthetic:test@example.gov.cn/table' },
    { documentSha256: '' },
  ])('拒绝缺行、重复、混级次或来源证据不全：%j', (change) => {
    expect(() => EnterpriseChartEvidenceSchema.parse({ ...evidence(), ...change })).toThrow();
  });
  it.each([
    { templateId: 'another-template' },
    { templateVersion: 'another-edition' },
    { legalStatus: 'draft' },
    { rows: [{ ...evidence().rows[0], name: '另一名称' }, evidence().rows[1]] },
    { rows: [{ ...evidence().rows[0], category: 'cost' }, evidence().rows[1]] },
    { rows: [{ ...evidence().rows[0], direction: 'credit' }, evidence().rows[1]] },
  ])('拒绝混版本/征求意见稿、名称、类别及方向不一致：%j', (change) => {
    expect(() =>
      parseSourcedEnterpriseTemplate(template(), { ...evidence(), ...change }),
    ).toThrow();
  });
  it('不能用类别默认方向代替逐项证据，也不能漏掉任何来源行', () => {
    const raw = template();
    delete raw.accounts[0]!.direction;
    expect(() => parseSourcedEnterpriseTemplate(raw, evidence())).toThrow(/不能沿用类别猜测/);
    expect(() =>
      parseSourcedEnterpriseTemplate({ ...template(), accounts: [] }, evidence()),
    ).toThrow();
    expect(() =>
      parseSourcedEnterpriseTemplate(
        { ...template(), accounts: [template().accounts[0]] },
        evidence(),
      ),
    ).toThrow(/完整来源表/);
  });
  it('不能将2019报表来源或另一份文档摘要冒充完整科目表来源', () => {
    expect(() =>
      parseSourcedEnterpriseTemplate({ ...template(), sources: legacy.sources }, evidence()),
    ).toThrow(/sources/);
    expect(() =>
      parseSourcedEnterpriseTemplate(template(), { ...evidence(), documentSha256: '1'.repeat(64) }),
    ).toThrow(/摘要/);
  });
  it.each(['both', 'no-closing-balance', 'unconfirmed'] as const)(
    '双向/结转/未知性质必须显式披露，未知保持needsReview：%s',
    (direction) => {
      const raw = template();
      const source = evidence();
      const changed = { ...source, rows: [{ ...source.rows[0]!, direction }, source.rows[1]!] };
      expect(() => parseSourcedEnterpriseTemplate(raw, changed)).toThrow();
      raw.accounts[0]!.source += `；性质:${direction}`;
      if (direction === 'unconfirmed') raw.accounts[0]!.needsReview = true;
      expect(parseSourcedEnterpriseTemplate(raw, changed).template.accounts[0]?.direction).toBe(
        'debit',
      );
    },
  );
  it('行业专用与未确认范围逐项标识，不能脱离source，也不能洗掉needsReview', () => {
    const raw = template();
    const source = evidence();
    const specialized = {
      ...source,
      rows: [
        { ...source.rows[0]!, scope: 'industry', scopeNote: '合成银行专用范围' },
        source.rows[1]!,
      ],
    };
    expect(() => parseSourcedEnterpriseTemplate(raw, specialized)).toThrow(/适用范围/);
    raw.accounts[0]!.source =
      raw.accounts[0]!.source!.replace('适用:general', '适用:industry') + '；合成银行专用范围';
    expect(parseSourcedEnterpriseTemplate(raw, specialized).evidence.rows[0]?.scope).toBe(
      'industry',
    );
    const unknown = {
      ...source,
      rows: [{ ...source.rows[0]!, scope: 'unconfirmed' }, source.rows[1]!],
    };
    expect(() => parseSourcedEnterpriseTemplate(raw, unknown)).toThrow(/needsReview/);
    raw.accounts[0]!.needsReview = true;
    raw.accounts[0]!.source = raw.accounts[0]!.source!.replace('适用:industry', '适用:unconfirmed');
    expect(parseSourcedEnterpriseTemplate(raw, unknown).template.accounts[0]?.needsReview).toBe(
      true,
    );
  });
  it('旧9项样例身份、2019报表范围及所有待核标志保留', () => {
    expect(legacy.id).toBe('books-enterprise-review');
    expect(legacy.name).toContain('9项待核工程样例');
    expect(legacy.accounts).toHaveLength(9);
    expect(legacy.accounts.every((row) => row.needsReview && row.source.includes('待核'))).toBe(
      true,
    );
    expect(templateReviewWarning(parseTemplate(legacy))).toMatch(
      /9项待核科目.*不是完整科目编码来源/,
    );
    expect(templateReviewWarning(undefined)).toBeNull();
  });
});

describe('w_xt_kgzb_1 企业模板新建隔离（真实SQLite、合成账套）', () => {
  it('注册另一版本并新建后，旧9科目账套数据、制度身份与凭证均保持；重开亦不补表', async () => {
    book = await createTestBook({ templates: [legacy], templateId: legacy.id, seed: false });
    await seedVouchers(book.svc, [
      {
        date: '2026-01-03',
        status: 'posted',
        lines: [
          { account: '1002', debit: 123_45 },
          { account: '4001', credit: 123_45 },
        ],
      },
    ]);
    const before = {
      info: await book.svc.book.info(),
      accounts: await book.svc.accounts.list(),
      vouchers: await book.svc.vouchers.list({}),
      balances: await book.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 }),
      log: await book.svc.log.list(),
    };
    const { template: next } = parseSourcedEnterpriseTemplate(template(), evidence());
    book.templates.register('books-synthetic', [next]);
    const created = await book.store.create({
      name: '合成新版本账套',
      orgName: '合成单位',
      templateId: next.id,
      product: 'qingsong',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'test',
    });
    expect(created.templateId).toBe(next.id);
    expect(
      book.store.open(created.id).raw.prepare('SELECT template_version FROM book_info').get(),
    ).toEqual({ template_version: next.version });
    expect(book.store.open(created.id).raw.prepare('SELECT COUNT(*) n FROM account').get()).toEqual(
      { n: 2 },
    );
    await book.store.close(book.info.id);
    const reopened = book.store.open(book.info.id);
    const svc = createCoreServices({
      ...book.svc.ctx,
      db: reopened.db,
      user: (await loadServiceUser(reopened.db, 1))!,
      moduleId: null,
    });
    expect({
      info: await svc.book.info(),
      accounts: await svc.accounts.list(),
      vouchers: await svc.vouchers.list({}),
      balances: await svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 }),
      log: await svc.log.list(),
    }).toEqual(before);
  });
  it('创建中途科目写入失败不遗留新文件，也不改变旧账套', async () => {
    book = await createTestBook({ seed: false });
    const broken = template();
    broken.accounts[1]!.dimensions = [
      { type: 'partner', required: true },
      { type: 'partner', required: true },
    ];
    book.templates.register('books-synthetic', [
      parseSourcedEnterpriseTemplate(broken, evidence()).template,
    ]);
    const files = readdirSync(book.store.booksDir).sort();
    const original = await book.svc.accounts.list();
    await expect(
      book.store.create({
        name: '失败合成账套',
        orgName: '合成单位',
        templateId: broken.id,
        product: 'qingsong',
        startYear: 2026,
        startMonth: 1,
      }),
    ).rejects.toThrow();
    expect(readdirSync(book.store.booksDir).sort()).toEqual(files);
    expect(await book.svc.accounts.list()).toEqual(original);
  });
  it('样例凭证整数金额、借贷平衡及报表基础取数保留（不代表完整表正确）', async () => {
    book = await createTestBook({ templates: [legacy], templateId: legacy.id, seed: false });
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10_000_00 }), async (amount) => {
        const [voucher] = await seedVouchers(book!.svc, [
          {
            date: '2026-01-05',
            status: 'posted',
            lines: [
              { account: '1002', debit: amount },
              { account: '6001', credit: amount },
            ],
          },
        ]);
        expect(voucher?.lines.reduce((sum, line) => sum + line.debit, 0)).toBe(amount);
        const rows = await book!.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
        const cash = rows.find((row) => row.accountCode === '1002')!;
        const revenue = rows.find((row) => row.accountCode === '6001')!;
        expect(cash.closing).toBe(-revenue.closing);
        expect(cash.ytdDebit).toBe(revenue.ytdCredit);
        expect(rows.reduce((sum, row) => sum + row.closing, 0)).toBe(0);
      }),
      { numRuns: 10 },
    );
  });
});
