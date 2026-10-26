import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Workbook } from 'exceljs';
import type { TRPCError } from '@trpc/server';
import type { Account, BusinessError, DimensionTypeId } from '@caiwu/core';
import { createTestApp, createTestBook, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { migrations } from '../server/migrations';
import { masterdataService } from '../server/service';
import { excelService } from '../server/excel';
import type { AccountInput, DimensionInput, ExcelInput } from '../shared';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(server, token);
let api: ReturnType<typeof caller>;
async function withPreview(input: ExcelInput): Promise<ExcelInput> {
  return { ...input, previewToken: (await api.excel.preview(input)).previewToken };
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  api = caller(app);
});
afterEach(async () => app.close());
const inputOf = (a: Account): AccountInput => ({
  ...a,
  dimensions: a.dimensions
    .filter((d) => d.type !== 'cashflow')
    .map((d) => ({ ...d, type: d.type as 'department' | 'project' | 'person' | 'partner' })),
});
async function save(input: AccountInput) {
  const p = await api.accounts.preview(input);
  return api.accounts.save({ ...input, confirmations: p.warnings.map((w) => w.key) });
}
async function errorData(work: Promise<unknown>) {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).not.toBeNull();
  return ((error as TRPCError).cause as BusinessError).data;
}
async function code(work: Promise<unknown>, expected: string) {
  expect((await errorData(work)).code).toBe(`MASTERDATA_${expected}`);
}
const base = { code: '1701', name: '测试设备', categoryId: 'asset', direction: 'debit' as const };
async function voucher(accountId: number, extra: Record<string, unknown> = {}) {
  const cash = (await app.svc.accounts.require('1001')).id;
  return app.svc.vouchers.create({
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    date: '2026-01-10',
    lines: [
      { accountId, summary: '发生', debit: 100, ...extra },
      { accountId: cash, summary: '发生', credit: 100 },
    ],
  });
}
async function file(
  edit: (rows: unknown[][]) => void,
  kind: 'accounts' | 'dimensions' = 'accounts',
  type?: DimensionTypeId,
): Promise<ExcelInput> {
  const out = await api.excel.export({ kind, type });
  const wb = new Workbook();
  await wb.xlsx.load(
    Buffer.from(out.content, 'base64') as unknown as Parameters<typeof wb.xlsx.load>[0],
  );
  const ws = wb.worksheets[0]!;
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  edit(rows);
  const edited = new Workbook();
  const sheet = edited.addWorksheet('基础档案');
  rows.forEach((r) => sheet.addRow(r));
  return {
    kind,
    type,
    fileName: out.fileName,
    content: Buffer.from(await edited.xlsx.writeBuffer()).toString('base64'),
  };
}

describe('科目维护与历史保护', () => {
  it('w_xt_kmwh_1：动态级次、重复编码、缺失父级、一级类别、两次方向确认及取消不落库', async () => {
    await code(api.accounts.save({ ...base, code: '17010' }), 'ACCOUNT_CODE');
    await code(api.accounts.save({ ...base, code: '1001' }), 'ACCOUNT_DUPLICATE');
    await code(api.accounts.save({ ...base, code: '170101' }), 'ACCOUNT_PARENT');
    await code(api.accounts.save({ ...base, categoryId: undefined }), 'ACCOUNT_CATEGORY');
    const preview = await api.accounts.preview(base);
    expect(preview.warnings).toHaveLength(2);
    await code(api.accounts.save(base), 'CONFIRM_REQUIRED');
    await code(
      api.accounts.save({ ...base, confirmations: [preview.warnings[0]!.key] }),
      'CONFIRM_REQUIRED',
    );
    expect(await app.svc.accounts.getByCode(base.code)).toBeNull();
    const root = await save(base);
    expect(root.fullName).toBe(root.name);
    const childInput = { code: '170101', name: '二级', direction: 'credit' as const };
    const p = await api.accounts.preview(childInput);
    expect(p.warnings[0]!.key).toContain('parentDirection');
    await code(api.accounts.save(childInput), 'CONFIRM_REQUIRED');
    const child = await save(childInput);
    expect(child).toMatchObject({
      parentId: root.id,
      categoryId: 'asset',
      direction: 'credit',
      fullName: '测试设备/二级',
    });
  });
  it('w_xt_kmwh_cfjc：相似项明示、重复名允许前取消不写、不合并', async () => {
    const first = await save(base);
    const other = { ...base, code: '1702' };
    const p = await api.accounts.preview(other);
    expect(p.similar.map((a) => a.id)).toContain(first.id);
    await code(
      api.accounts.save({
        ...other,
        confirmations: p.warnings
          .filter((w) => !w.key.startsWith('duplicateName'))
          .map((w) => w.key),
      }),
      'CONFIRM_REQUIRED',
    );
    expect(await app.svc.accounts.getByCode('1702')).toBeNull();
    const second = await save(other);
    expect(second.id).not.toBe(first.id);
  });
  it('w_xt_kmwh：定位空条件拒绝、空查询全部、拼音助记码、全名整理不改金额', async () => {
    await code(api.accounts.list({ keyword: '', locate: true }), 'SEARCH_EMPTY');
    const a = await save({ ...base, mnemonic: 'SBZJ' });
    expect((await api.accounts.list({ keyword: 'cssb' }))[0]!.id).toBe(a.id);
    expect((await api.accounts.list({ keyword: 'sbzj' }))[0]!.id).toBe(a.id);
    expect((await api.accounts.list({})).length).toBeGreaterThan(20);
    const v = await voucher(a.id);
    await api.accounts.rebuild();
    expect((await app.svc.vouchers.get(v.id))!.debitTotal).toBe(100);
  });
  it('w_xt_kmwh_1：默认项类型/存在/末级正确，资金范围不按固定编号或名称猜测', async () => {
    const dept = (await app.svc.dimensions.getByCode('department', '01'))!;
    await code(
      api.accounts.save({ ...base, dimensions: [{ type: 'project', defaultItemId: dept.id }] }),
      'DEFAULT_ITEM',
    );
    await code(
      api.accounts.save({ ...base, dimensions: [{ type: 'department', defaultItemId: 99999 }] }),
      'DEFAULT_ITEM',
    );
    await code(api.accounts.save({ ...base, isCash: true }), 'MONEY_ONLY');
    const a = await save({ ...base, name: '其他货币资金' });
    await code(api.accounts.save({ ...inputOf(a), isBank: true }), 'MONEY_ONLY');
    await code(
      api.accounts.confirmMoneyRoot({ accountId: a.id, kind: 'other', confirmed: false }),
      'CONFIRM_REQUIRED',
    );
    await api.accounts.confirmMoneyRoot({ accountId: a.id, kind: 'other', confirmed: true });
    expect(
      (await api.accounts.save({ ...inputOf(a), cashflowRequired: true })).cashflowRequired,
    ).toBe(true);
    const bank = await save({
      code: '100203',
      name: '新银行',
      direction: 'debit',
      isBank: true,
      cashflowRequired: true,
    });
    expect(bank.isBank).toBe(true);
  });
  it('w_xt_kmwh_1 / w_xt_kmbm_get：M03默认部门和项目回导后由core补入凭证，停用后拒绝写入且历史不变', async () => {
    const department = await api.dimensions.save({
      type: 'department',
      code: '03',
      name: '研发中心',
    });
    const project = await api.dimensions.save({
      type: 'project',
      code: 'XM02',
      name: '研发项目',
    });
    const account = await save({
      ...base,
      dimensions: [
        { type: 'department', required: true, defaultItemId: department.id },
        { type: 'project', required: true, defaultItemId: project.id },
      ],
    });
    const exported = await api.excel.export({ kind: 'accounts' });
    const imported = { ...exported, kind: 'accounts' as const };
    expect((await api.excel.preview(imported)).valid).toBe(true);
    await api.excel.commit(await withPreview({ ...imported, confirmations: ['import'] }));
    expect((await app.svc.accounts.require(account.id)).dimensions).toEqual(account.dimensions);

    const input = {
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      date: '2026-01-10',
      lines: [
        { accountId: account.id, summary: '默认辅助核算', debit: 100 },
        {
          accountId: (await app.svc.accounts.require('1001')).id,
          summary: '默认辅助核算',
          credit: 100,
        },
      ],
    };
    const expected = { department: department.id, project: project.id };
    const created = await app.svc.vouchers.create(input);
    expect(created.lines[0]!.dimensions).toMatchObject(expected);
    expect((await app.svc.vouchers.get(created.id))!.lines[0]!.dimensions).toMatchObject(expected);
    const otherDepartment = (await app.svc.dimensions.getByCode('department', '01'))!;
    const overridden = await app.svc.vouchers.update(
      created.id,
      {
        ...input,
        lines: [
          { ...input.lines[0]!, dimensions: { department: otherDepartment.id } },
          input.lines[1]!,
        ],
      },
      { expectedRevision: created.revision },
    );
    expect(overridden.lines[0]!.dimensions).toMatchObject({
      department: otherDepartment.id,
      project: project.id,
    });
    const restored = await app.svc.vouchers.update(created.id, input, {
      expectedRevision: overridden.revision,
    });
    expect(restored.lines[0]!.dimensions).toMatchObject(expected);

    await api.dimensions.save({ ...department, type: 'department', disabled: true });
    await expect(app.svc.vouchers.create(input)).rejects.toThrow(/研发中心.*已停用/);
    await expect(
      app.svc.vouchers.update(created.id, input, {
        expectedRevision: restored.revision,
      }),
    ).rejects.toThrow(/研发中心.*已停用/);
    expect((await app.svc.vouchers.list()).total).toBe(1);
    expect(await app.svc.vouchers.get(created.id)).toEqual(restored);
    await api.dimensions.save({ ...department, type: 'department', disabled: false });
    expect((await app.svc.vouchers.create(input)).lines[0]!.dimensions).toMatchObject(expected);
  });
  it('w_xt_kmwh_1：非资产负债外币需独立确认，正负外币数量发生抵销仍禁止移除/换币种/改单位', async () => {
    const p = await api.accounts.preview({
      ...base,
      code: '6701',
      categoryId: 'pnl',
      currency: 'USD',
    });
    expect(p.warnings.some((w) => w.key.startsWith('currencyCategory'))).toBe(true);
    await code(
      api.accounts.save({
        ...base,
        code: '6701',
        categoryId: 'pnl',
        currency: 'USD',
        confirmations: p.warnings
          .filter((w) => !w.key.startsWith('currencyCategory'))
          .map((w) => w.key),
      }),
      'CONFIRM_REQUIRED',
    );
    const a = await save({ ...base, currency: 'USD', quantityUnit: '件' });
    const type = (await app.svc.reference.voucherTypes())[0]!.id;
    const cash = (await app.svc.accounts.require('1001')).id;
    for (const sign of [1, -1])
      await app.svc.vouchers.create({
        voucherTypeId: type,
        date: '2026-01-10',
        lines: [
          {
            accountId: a.id,
            summary: '抵销',
            debit: sign * 100,
            currency: 'USD',
            exchangeRate: '1',
            fcAmount: sign * 100,
            quantity: String(sign),
          },
          { accountId: cash, summary: '抵销', credit: sign * 100 },
        ],
      });
    expect(
      (
        await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601, includeZero: true })
      ).find((r) => r.accountId === a.id)?.closing,
    ).toBe(0);
    for (const change of [
      { currency: null },
      { quantityUnit: null },
      { quantityUnit: '箱' },
      { direction: 'credit' as const },
      { categoryId: 'liability' },
      { code: '1702' },
      { dimensions: [{ type: 'department' as const, required: true }] },
    ])
      await code(api.accounts.save({ ...inputOf(a), ...change }), 'ACCOUNT_USED');
    await code(api.accounts.remove({ id: a.id, confirmed: true }), 'ACCOUNT_USED');
    expect((await api.accounts.save({ ...inputOf(a), disabled: true })).disabled).toBe(true);
    expect((await app.svc.vouchers.list()).total).toBe(2);
  });
  it('w_xt_kmwh：含辅助、账前累计、外币、数量的逐条期初抵销后仍禁止删改', async () => {
    const a = await save({
      ...base,
      currency: 'USD',
      quantityUnit: '件',
      dimensions: [{ type: 'department' }],
    });
    for (const [i, sign] of [1, -1].entries())
      await app.svc.opening.upsert({
        year: 2026,
        accountId: a.id,
        dimensions: {
          department: (await app.svc.dimensions.getByCode('department', i === 0 ? '01' : '02'))!.id,
        },
        currency: 'USD',
        balance: sign * 100,
        fcBalance: sign * 50,
        quantity: String(sign),
        ytdDebit: 200,
        ytdCredit: 200,
      });
    await code(api.accounts.remove({ id: a.id, confirmed: true }), 'ACCOUNT_USED');
    await code(api.accounts.save({ ...inputOf(a), quantityUnit: '箱' }), 'ACCOUNT_USED');
    await code(api.accounts.save({ ...inputOf(a), currency: null }), 'ACCOUNT_USED');
    await code(
      api.accounts.batchPreview({ parentId: a.id, start: 1, names: ['下级'] }),
      'ACCOUNT_PARENT_USED',
    );
  });
  it('w_xt_kmwh：最后下级影响确认、取消不写、删除故障父级/子级原子回滚', async () => {
    const root = await save(base);
    const child = await save({ code: '170101', name: '下级', direction: 'debit' });
    expect((await api.accounts.deleteImpact({ id: child.id })).message).toContain('恢复为末级');
    await code(api.accounts.remove({ id: child.id, confirmed: false }), 'CONFIRM_REQUIRED');
    expect((await app.svc.accounts.require(root.id)).isLeaf).toBe(false);
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TRIGGER deny_parent_restore BEFORE UPDATE OF is_leaf ON account WHEN OLD.code='1701' AND NEW.is_leaf=1 BEGIN SELECT RAISE(ABORT,'测试故障'); END",
    );
    await expect(api.accounts.remove({ id: child.id, confirmed: true })).rejects.toThrow();
    expect(await app.svc.accounts.get(child.id)).not.toBeNull();
    expect((await app.svc.accounts.require(root.id)).isLeaf).toBe(false);
    raw.exec('DROP TRIGGER deny_parent_restore');
    await api.accounts.remove({ id: child.id, confirmed: true });
    expect((await app.svc.accounts.require(root.id)).isLeaf).toBe(true);
  });
  it('w_xt_kmwh_1：批量下级容量、停用、重复、默认继承、整批中途故障回滚', async () => {
    const root = await save({
      ...base,
      dimensions: [
        {
          type: 'department',
          required: true,
          defaultItemId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
        },
      ],
    });
    await code(
      api.accounts.batchPreview({ parentId: root.id, start: 99, names: ['A', 'B'] }),
      'ACCOUNT_CAPACITY',
    );
    await code(
      api.accounts.batch({ parentId: root.id, start: 1, names: ['A'], confirmations: [] }),
      'CONFIRM_REQUIRED',
    );
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TRIGGER deny_second BEFORE INSERT ON account WHEN NEW.code='170102' BEGIN SELECT RAISE(ABORT,'测试故障'); END",
    );
    await expect(
      api.accounts.batch({
        parentId: root.id,
        start: 1,
        names: ['A', 'B'],
        confirmations: ['batch'],
      }),
    ).rejects.toThrow();
    expect(await app.svc.accounts.getByCode('170101')).toBeNull();
    expect((await app.svc.accounts.require(root.id)).isLeaf).toBe(true);
    raw.exec('DROP TRIGGER deny_second');
    expect(
      await api.accounts.batch({
        parentId: root.id,
        start: 1,
        names: ['A', 'B'],
        confirmations: ['batch'],
      }),
    ).toBe(2);
    expect((await app.svc.accounts.require('170101')).dimensions).toEqual(root.dimensions);
    await code(
      api.accounts.batch({
        parentId: root.id,
        start: 1,
        names: ['重复'],
        confirmations: ['batch'],
      }),
      'ACCOUNT_DUPLICATE',
    );
    const leaf = await app.svc.accounts.require('170101');
    await api.accounts.save({ ...inputOf(leaf), disabled: true });
    await code(
      api.accounts.batchPreview({ parentId: leaf.id, start: 1, names: ['C'] }),
      'ACCOUNT_PARENT_DISABLED',
    );
  });
});

describe('五类共享辅助档案', () => {
  it.each(['project', 'partner', 'department', 'person', 'cashflow'] as const)(
    'w_xt_fhwh / w_xt_wh：%s 真实 core 新增、改编号保ID、重复、确认取消、停用与删除',
    async (type) => {
      const codes = {
        project: 'XM02',
        partner: 'C002',
        department: '03',
        person: 'P02',
        cashflow: 'CF03',
      };
      const data: DimensionInput = {
        type,
        code: codes[type],
        name: '研发中心',
        attrs:
          type === 'partner'
            ? {
                role: 'both',
                shortName: '研发',
                contact: '张三',
                taxNumber: '9131',
                bankAccount: '001002',
              }
            : type === 'cashflow'
              ? { cashflowDirection: 'inflow', category: '经营' }
              : {},
      };
      const a = await api.dimensions.save(data);
      expect(await app.svc.dimensions.getByCode(type, data.code)).toMatchObject({
        id: a.id,
        pinyin: 'yfzx',
        attrs: data.attrs,
      });
      await code(api.dimensions.save(data), 'DIMENSION_DUPLICATE');
      const newCode =
        type === 'department' ? '04' : type === 'person' ? 'P03' : data.code.slice(0, -1) + '4';
      const b = await api.dimensions.save({ ...data, id: a.id, code: newCode, disabled: true });
      expect(b.id).toBe(a.id);
      expect(b.disabled).toBe(true);
      expect((await api.dimensions.list({ type, keyword: 'yfzx' }))[0]!.id).toBe(a.id);
      await code(api.dimensions.list({ type, keyword: '', locate: true }), 'SEARCH_EMPTY');
      await code(api.dimensions.remove({ id: a.id, confirmed: false }), 'CONFIRM_REQUIRED');
      await api.dimensions.remove({ id: a.id, confirmed: true });
      expect(await app.svc.dimensions.get(a.id)).toBeNull();
    },
  );
  it('w_xt_xmwh / w_xt_bmwh / w_xt_grwh / w_xt_dwwh_fj：五级十位、空名、格式、现存数据验证、自指/成环/跨类型拒绝', async () => {
    await expect(
      api.dimensions.setScheme({ type: 'department', scheme: [3, 3, 3, 3] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await code(
      api.dimensions.setScheme({ type: 'department', scheme: [3, 2, 2] }),
      'DIMENSION_SCHEME',
    );
    await expect(
      api.dimensions.save({ type: 'department', code: '03', name: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await code(
      api.dimensions.save({ type: 'department', code: '003', name: '错长' }),
      'DIMENSION_CODE',
    );
    const root = await api.dimensions.save({ type: 'department', code: '03', name: '研发' });
    const child = await api.dimensions.save({
      type: 'department',
      code: '0301',
      name: '子分类',
      parentId: root.id,
    });
    await code(
      api.dimensions.save({
        id: root.id,
        type: 'department',
        code: '03',
        name: '研发',
        parentId: child.id,
      }),
      'DIMENSION_CYCLE',
    );
    await code(
      api.dimensions.save({
        id: root.id,
        type: 'department',
        code: '03',
        name: '研发',
        parentId: root.id,
      }),
      'DIMENSION_CYCLE',
    );
    const project = (await app.svc.dimensions.getByCode('project', 'XM01'))!;
    await code(
      api.dimensions.save({
        type: 'department',
        code: '0302',
        name: '跨类型',
        parentId: project.id,
      }),
      'DIMENSION_PARENT',
    );
    await code(api.dimensions.remove({ id: root.id, confirmed: true }), 'DIMENSION_CHILDREN');
    await api.dimensions.remove({ id: child.id, confirmed: true });
    expect((await app.svc.dimensions.get(root.id))!.isLeaf).toBe(true);
  });
  it.each([false, true])(
    'w_xt_bmwh / w_xt_dwwh_fj：分级规则不能将根档案移到第二级，已有下级=%s；拒绝无变化且可恢复维护',
    async (withChildren) => {
      const type = 'department' as const;
      const originalScheme = [2, 2, 2];
      const incompatibleScheme = [1, 1, 2, 2, 2];
      await api.dimensions.setScheme({ type, scheme: originalScheme });
      const root = (await app.svc.dimensions.getByCode(type, '01'))!;
      const otherRoot = (await app.svc.dimensions.getByCode(type, '02'))!;
      if (withChildren) {
        const child = await api.dimensions.save({
          type,
          code: '0101',
          name: '行政一部',
          parentId: root.id,
        });
        await api.dimensions.save({
          type,
          code: '010101',
          name: '行政一组',
          parentId: child.id,
        });
      }
      const itemsBefore = await app.svc.dimensions.items(type);
      const settingsBefore = await app.svc.db
        .selectFrom('book_setting')
        .selectAll()
        .where('scope', '=', 'masterdata')
        .orderBy('key')
        .execute();
      await code(
        api.dimensions.setScheme({ type, scheme: incompatibleScheme }),
        'DIMENSION_SCHEME',
      );
      expect(await api.dimensions.scheme({ type })).toEqual(originalScheme);
      expect(await app.svc.dimensions.items(type)).toEqual(itemsBefore);
      expect(
        await app.svc.db
          .selectFrom('book_setting')
          .selectAll()
          .where('scope', '=', 'masterdata')
          .orderBy('key')
          .execute(),
      ).toEqual(settingsBefore);

      // 模拟修复前已保存的不兼容配置；恢复只检查目标规则，不改动已有档案。
      await app.svcFor('masterdata').settings.set('scheme:department', incompatibleScheme);
      await code(
        api.dimensions.save({ ...otherRoot, type, name: '待恢复部门' }),
        'DIMENSION_PARENT',
      );
      await api.dimensions.setScheme({ type, scheme: originalScheme });
      expect(await app.svc.dimensions.items(type)).toEqual(itemsBefore);
      const renamed = await api.dimensions.save({ ...root, type, name: '行政管理部' });
      expect(renamed).toMatchObject({ id: root.id, parentId: null, name: '行政管理部' });
      const disabled = await api.dimensions.save({ ...otherRoot, type, disabled: true });
      expect(disabled).toMatchObject({ id: otherRoot.id, parentId: null, disabled: true });
      await api.dimensions.save({ ...disabled, type, disabled: false });

      const beforeImport = await app.svc.dimensions.items(type);
      const exported = await api.excel.export({ kind: 'dimensions', type });
      const input = { ...exported, kind: 'dimensions' as const, type };
      expect((await api.excel.preview(input)).valid).toBe(true);
      await api.excel.commit(await withPreview({ ...input, confirmations: ['import'] }));
      expect(await app.svc.dimensions.items(type)).toEqual(beforeImport);
      expect(await api.dimensions.scheme({ type })).toEqual(originalScheme);
    },
  );
  it.each(['project', 'partner', 'department', 'person', 'cashflow'] as const)(
    'w_xt_xmwh / w_xt_bmwh / w_xt_grwh / w_xt_dwwh / w_xt_xjwh：%s 被凭证引用时余额为零也不能删除',
    async (type) => {
      const codeByType = {
        project: 'XM01',
        partner: 'C001',
        department: '01',
        person: 'P01',
        cashflow: 'CF01',
      };
      const item = (await app.svc.dimensions.getByCode(type, codeByType[type]))!;
      const a = await save({
        ...base,
        dimensions: type === 'cashflow' ? [] : [{ type, required: true }],
      });
      await voucher(a.id, { dimensions: { [type]: item.id } });
      await code(api.dimensions.remove({ id: item.id, confirmed: true }), 'DIMENSION_USED');
      if (type !== 'cashflow')
        await app.svc.opening.upsert({
          year: 2026,
          accountId: a.id,
          balance: 0,
          dimensions: { [type]: item.id },
        });
      await api.dimensions.save({ ...item, type, disabled: true });
      await expect(voucher(a.id, { dimensions: { [type]: item.id } })).rejects.toThrow(/停用/);
    },
  );
  it('w_xt_dwwh：零期初仍保护删除、保存失败不报告成功；w_xt_xjwh 方向本地验证且历史不猜测', async () => {
    const partner = (await app.svc.dimensions.getByCode('partner', 'C001'))!;
    await app.svc.opening.upsert({
      year: 2026,
      accountId: (await app.svc.accounts.require('1122')).id,
      balance: 0,
      dimensions: { partner: partner.id },
    });
    await code(api.dimensions.remove({ id: partner.id, confirmed: true }), 'DIMENSION_USED');
    await code(
      api.dimensions.save({ type: 'cashflow', code: 'CF03', name: '新现金流' }),
      'CASHFLOW_DIRECTION',
    );
    await expect(
      api.dimensions.save({
        type: 'cashflow',
        code: 'CF03',
        name: '方向错',
        attrs: { cashflowDirection: 'wrong' as 'inflow' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const old = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!;
    expect(old.attrs.cashflowDirection).toBeUndefined();
    const a = await save(base);
    await voucher(a.id, { dimensions: { cashflow: old.id } });
    await code(
      api.dimensions.save({ ...old, type: 'cashflow', attrs: { cashflowDirection: 'inflow' } }),
      'DIMENSION_USED',
    );
    expect((await app.svc.dimensions.get(old.id))!.attrs.cashflowDirection).toBeUndefined();
  });
});

describe('参考档案与Excel', () => {
  it('w_xt_pzlx_zj：独立类型代码、简称和全称持久化，凭证头取简称，已用简称不可改', async () => {
    await api.reference.save({
      kind: 'voucherTypes',
      code: '01',
      shortName: '收',
      name: '收款凭证',
      sort: 2,
    });
    const row = (await api.reference.list({ kind: 'voucherTypes' })).find((r) => r.code === '01')!;
    expect(row).toMatchObject({ shortName: '收', name: '收款凭证', sort: 2 });
    expect((await app.svc.reference.voucherTypes()).find((r) => r.id === row.id)).toMatchObject({
      code: '收',
      name: '收款凭证',
      rule: null,
    });
    const cash = (await app.svc.accounts.require('1001')).id;
    const finance = (await app.svc.accounts.require('6603')).id;
    const v = await app.svc.vouchers.create({
      voucherTypeId: row.id,
      date: '2026-01-05',
      lines: [
        { accountId: cash, summary: '收款', debit: 100 },
        { accountId: finance, summary: '收款', credit: 100 },
      ],
    });
    expect(v.displayNo).toBe('收-0001');
    await code(
      api.reference.save({ kind: 'voucherTypes', ...row, shortName: '付' }),
      'REFERENCE_USED',
    );
    await code(
      api.reference.save({ kind: 'voucherTypes', code: '01', shortName: '新', name: '重复代码' }),
      'REFERENCE_DUPLICATE',
    );
    await code(
      api.reference.save({ kind: 'voucherTypes', code: '02', shortName: '收', name: '重复简称' }),
      'REFERENCE_DUPLICATE',
    );
  });
  it('w_xt_pzlx / w_xt_pzlx_zj / w_xt_jslb：重复、末个可用类型、被引用、取消删除保护', async () => {
    const type = (await api.reference.list({ kind: 'voucherTypes' }))[0]!;
    await code(
      api.reference.save({ kind: 'voucherTypes', code: type.code, name: '重复' }),
      'REFERENCE_DUPLICATE',
    );
    await code(
      api.reference.remove({ kind: 'voucherTypes', id: type.id, code: type.code, confirmed: true }),
      'REFERENCE_LAST',
    );
    await code(
      api.reference.save({ kind: 'voucherTypes', ...type, disabled: true }),
      'REFERENCE_LAST',
    );
    await api.reference.save({ kind: 'voucherTypes', code: '转', name: '转账凭证' });
    const a = await save(base);
    await voucher(a.id);
    await code(
      api.reference.remove({ kind: 'voucherTypes', id: type.id, code: type.code, confirmed: true }),
      'REFERENCE_USED',
    );
    const settle = (await api.reference.list({ kind: 'settlementMethods' }))[0]!;
    for (const row of (await api.reference.list({ kind: 'settlementMethods' })).slice(1))
      await api.reference.remove({
        kind: 'settlementMethods',
        id: row.id,
        code: row.code,
        confirmed: true,
      });
    await code(
      api.reference.remove({
        kind: 'settlementMethods',
        id: settle.id,
        code: settle.code,
        confirmed: true,
      }),
      'REFERENCE_LAST',
    );
    await api.reference.save({ kind: 'settlementMethods', code: '09', name: '测试结算' });
    await voucher(a.id, { settlementMethodId: settle.id });
    await code(
      api.reference.remove({
        kind: 'settlementMethods',
        id: settle.id,
        code: settle.code,
        confirmed: true,
      }),
      'REFERENCE_USED',
    );
    const other = (await api.reference.list({ kind: 'settlementMethods' })).find(
      (r) => r.code === '09',
    )!;
    await code(
      api.reference.remove({
        kind: 'settlementMethods',
        id: other.id,
        code: other.code,
        confirmed: false,
      }),
      'CONFIRM_REQUIRED',
    );
  });
  it('w_xt_fbwh / w_xt_fbwh_1：本位币/已用币种不能删，正数合法期间、最近适用率字符串精度', async () => {
    const rows = await api.reference.list({ kind: 'currencies' });
    const cny = rows.find((r) => r.isBase)!;
    const usd = rows.find((r) => r.code === 'USD')!;
    await code(
      api.reference.remove({ kind: 'currencies', id: cny.id, code: cny.code, confirmed: true }),
      'BASE_CURRENCY',
    );
    await code(
      api.reference.remove({ kind: 'currencies', id: usd.id, code: 'USD', confirmed: true }),
      'CURRENCY_USED',
    );
    await code(
      api.reference.saveRate({ currency: 'USD', period: 202613, rate: '7.1', accountId: null }),
      'PERIOD',
    );
    for (const rate of ['0', '-1', 'NaN', '1e4'])
      await code(
        api.reference.saveRate({ currency: 'USD', period: 202602, rate, accountId: null }),
        'RATE',
      );
    const rate = '7.1234567890123456789';
    await api.reference.saveRate({
      currency: 'USD',
      period: 202602,
      rate,
      accountId: (await app.svc.accounts.require('6603')).id,
    });
    expect(await api.reference.applicableRate({ currency: 'USD', period: 202603 })).toBe(rate);
    expect(await app.svc.reference.exchangeRate('USD', 202603)).toBe(rate);
    expect(await app.svc.reference.exchangeRate('USD', 202601)).toBe('7.1');
    await api.reference.save({ kind: 'currencies', code: 'EUR', name: '欧元', symbol: '€' });
    const eur = (await api.reference.list({ kind: 'currencies' })).find((r) => r.code === 'EUR')!;
    await api.reference.remove({ kind: 'currencies', id: eur.id, code: eur.code, confirmed: true });
  });
  it('w_xt_zy：摘要编码唯一、拼音共享、分类快捷检索、次数保存不丢', async () => {
    const row = (await api.reference.list({ kind: 'summaries' }))[0]!;
    await app.svc.db
      .updateTable('summary_phrase')
      .set({ use_count: 13 })
      .where('id', '=', row.id)
      .execute();
    await api.reference.save({
      kind: 'summaries',
      ...row,
      name: '收到货款',
      category: '收款',
      shortcut: 'sk',
    });
    expect((await app.svc.reference.summaries()).find((r) => r.id === row.id)).toMatchObject({
      text: '收到货款',
      pinyin: 'sdhk',
      useCount: 13,
    });
    await code(
      api.reference.save({ kind: 'summaries', code: row.code, name: '重复' }),
      'REFERENCE_DUPLICATE',
    );
  });
  it('w_xt_kmbm_get：无文件/不可解析/空数据/超长/缺上级逐行报告，坏后行整批回滚，重复上传不新增', async () => {
    await code(api.excel.preview({ kind: 'accounts', fileName: '', content: '' }), 'FILE_REQUIRED');
    await code(
      api.excel.preview({ kind: 'accounts', fileName: 'bad.xlsx', content: 'x' }),
      'FILE_INVALID',
    );
    const empty = await file((rows) => rows.splice(1));
    await code(api.excel.preview(empty), 'FILE_EMPTY');
    const bad = await file((rows) => {
      const template = [...rows[1]!];
      rows.splice(1);
      template[0] = '1701';
      template[1] = '导入设备';
      template[5] = 0;
      template[7] = 0;
      rows.push(template);
      rows.push([...template.slice(0, 0), '17019999', '过长缺父', ...template.slice(2)]);
    });
    const before = (await app.svc.accounts.list()).length;
    const p = await api.excel.preview(bad);
    expect(p.valid).toBe(false);
    expect(p.rows.some((r) => r.error.includes('上级'))).toBe(true);
    expect(await app.svc.accounts.getByCode('1701')).toBeNull();
    await expect(
      api.excel.commit(
        await withPreview({
          ...bad,
          confirmations: [...p.confirmations.map((w) => w.key), 'import'],
        }),
      ),
    ).rejects.toThrow();
    expect((await app.svc.accounts.list()).length).toBe(before);
    const good = await file((rows) => {
      const row = [...rows[1]!];
      rows.splice(1);
      row[0] = '1701';
      row[1] = '导入设备';
      row[5] = 0;
      row[7] = 0;
      rows.push(row);
    });
    const preview = await api.excel.preview(good);
    expect(preview.valid).toBe(true);
    await api.excel.commit(
      await withPreview({
        ...good,
        confirmations: [...preview.confirmations.map((w) => w.key), 'import'],
      }),
    );
    await api.excel.commit(await withPreview({ ...good, confirmations: ['import'] }));
    expect((await app.svc.accounts.list()).length).toBe(before + 1);
  });
  it('w_xt_kmbm_get：已使用科目不能借导入改变方向，辅助导入坏行撤销整批', async () => {
    const a = await save(base);
    await voucher(a.id);
    const input = await file((rows) => {
      const header = rows[0]!;
      const r = rows.find((r) => r[0] === a.code)!;
      r[header.indexOf('方向')] = 'credit';
    });
    const p = await api.excel.preview(input);
    expect(p.valid).toBe(false);
    expect(p.rows.find((r) => r.code === a.code)?.error).toContain('已有凭证');
    const dimFile = await file(
      (rows) => {
        rows.push(['03', '新部门', '', 0, '{}'], ['0301', '错父级', '99', 0, '{}']);
      },
      'dimensions',
      'department',
    );
    expect((await api.excel.preview(dimFile)).valid).toBe(false);
    await expect(
      api.excel.commit(await withPreview({ ...dimFile, confirmations: ['import'] })),
    ).rejects.toThrow();
    expect(await app.svc.dimensions.getByCode('department', '03')).toBeNull();
  });
  it('w_xt_kmbm_get：超限编码与不合法标志逐行报错；父子顺序预览后一次事务导入', async () => {
    const root = await save(base);
    const out = await file((rows) => {
      const header = rows[0]!;
      const template = [...rows.find((r) => r[0] === root.code)!];
      rows.splice(1);
      const child = [...template];
      child[0] = '170101';
      child[1] = '导入子级';
      const parent = [...template];
      parent[1] = '测试设备';
      const bad = [...template];
      bad[0] = '1701010101';
      bad[1] = '超限';
      const invalid = [...template];
      invalid[0] = '1702';
      invalid[1] = '错误标志';
      invalid[header.indexOf('停用')] = '是';
      rows.push(child, parent, bad, invalid);
    });
    const p = await api.excel.preview(out);
    expect(p.valid).toBe(false);
    expect(p.rows.filter((r) => r.error)).toHaveLength(2);
    expect(p.rows.find((r) => r.code === '1701010101')!.error).toContain('编码');
    expect(await app.svc.accounts.getByCode('170101')).toBeNull();
    const valid = await file((rows) => {
      const source = rows.find((r) => r[0] === root.code)!;
      rows.splice(1);
      rows.push([...source.slice(0, 0), '170101', '导入子级', ...source.slice(2)], source);
    });
    const preview = await api.excel.preview(valid);
    expect(preview.valid).toBe(true);
    expect(preview.rows.map((r) => r.code)).toEqual(['1701', '170101']);
    await api.excel.commit(await withPreview({ ...valid, confirmations: ['import'] }));
    expect((await app.svc.accounts.require('170101')).fullName).toBe('测试设备/导入子级');
  });
});

it('权限：只读用户直接调用每类写接口及导入预览均FORBIDDEN，核心数据无变化', async () => {
  const viewer = caller(app, await app.addUser('viewer', { permissions: ['masterdata.view'] }));
  const before = await app.svc.accounts.list();
  const department = (await app.svc.dimensions.getByCode('department', '01'))!;
  const ref = (await api.reference.list({ kind: 'voucherTypes' }))[0]!;
  const actions = [
    () => viewer.accounts.save(base),
    () => viewer.accounts.remove({ id: before[0]!.id, confirmed: true }),
    () => viewer.accounts.rebuild(),
    () =>
      viewer.accounts.batch({
        parentId: before[0]!.id,
        start: 1,
        names: ['A'],
        confirmations: ['batch'],
      }),
    () =>
      viewer.accounts.confirmMoneyRoot({ accountId: before[0]!.id, kind: 'cash', confirmed: true }),
    () => viewer.dimensions.save({ type: 'department', code: '03', name: '新部门' }),
    () => viewer.dimensions.remove({ id: department.id, confirmed: true }),
    () => viewer.dimensions.setScheme({ type: 'department', scheme: [2, 2] }),
    () => viewer.reference.save({ kind: 'voucherTypes', code: '新', name: '新的' }),
    () => viewer.reference.save({ kind: 'settlementMethods', code: '09', name: '新的结算' }),
    () => viewer.reference.save({ kind: 'currencies', code: 'EUR', name: '欧元' }),
    () => viewer.reference.save({ kind: 'summaries', code: '09', name: '新摘要' }),
    () =>
      viewer.reference.remove({
        kind: 'voucherTypes',
        id: ref.id,
        code: ref.code,
        confirmed: true,
      }),
    () =>
      viewer.reference.saveRate({ currency: 'USD', period: 202602, rate: '7', accountId: null }),
    () => viewer.excel.commit({ kind: 'accounts', fileName: 'x', content: 'x' }),
    () => viewer.excel.preview({ kind: 'accounts', fileName: 'x', content: 'x' }),
  ];
  for (const action of actions) expect((await errorData(action())).code).toBe('FORBIDDEN');
  expect(await app.svc.accounts.list()).toEqual(before);
  expect(await app.svc.dimensions.getByCode('department', '03')).toBeNull();
});

it('w_xt_kmwh：未知外键引用仍保护删除并给中文下一步，整笔事务无变化', async () => {
  const a = await save(base);
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  raw.exec('CREATE TABLE masterdata_test_ref(account_id INTEGER REFERENCES account(id))');
  raw.prepare('INSERT INTO masterdata_test_ref(account_id) VALUES (?)').run(a.id);
  const error = await errorData(api.accounts.remove({ id: a.id, confirmed: true }));
  expect(error.code).toBe('MASTERDATA_REFERENCE');
  expect(error.hint).toContain('停用');
  expect(error.message).not.toContain('SQL');
  expect(await app.svc.accounts.get(a.id)).not.toBeNull();
});

it('fast-check：不同合法科目级次的父子/全名一致、分类无环、Excel核算元数据与数量字符串无损', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 999999 }),
      async (width, tail, fraction) => {
        const codeScheme = `4-${width}-${tail}`;
        const t = await createTestBook({
          templateId: 'masterdata-property',
          templates: [
            {
              schemaVersion: 1,
              id: 'masterdata-property',
              version: '1',
              name: '科目属性测试',
              regime: 'enterprise',
              codeScheme,
              categories: [{ id: 'asset', name: '资产', direction: 'debit' }],
              accounts: [{ code: '1001', name: '库存现金', category: 'asset', cash: true }],
              voucherTypes: [{ code: '记', name: '记账凭证' }],
              sources: [{ title: '测试数据' }],
            },
          ],
          codeScheme,
          migrationSets: [{ scope: 'masterdata', migrations }],
          seed: false,
        });
        try {
          const s = masterdataService(t.forModule('masterdata'));
          const root = await s.saveAccount({
            ...base,
            confirmations: [`direction:1701:借:1`, `direction:1701:借:2`],
          });
          const childCode = '1701' + '1'.padStart(width, '0');
          const child = await s.saveAccount({ code: childCode, name: '父级', direction: 'debit' });
          const leaf = await s.saveAccount({
            code: childCode + '1'.padStart(tail, '0'),
            name: '末级',
            direction: 'debit',
            quantityUnit: '件',
            mnemonic: String(fraction),
          });
          expect(child.parentId).toBe(root.id);
          expect(leaf.parentId).toBe(child.id);
          expect(leaf.fullName).toBe('测试设备/父级/末级');
          const a = await s.saveDimension({
            type: 'department',
            code: '01',
            name: '根',
            attrs: {
              quantity: `1.${String(fraction).padStart(6, '0')}`,
              rate: '7.1234567890123456789',
            },
          });
          await s.saveDimension({ type: 'department', code: '0101', name: '子', parentId: a.id });
          await expect(
            s.saveDimension({
              id: a.id,
              type: 'department',
              code: '01',
              name: '根',
              parentId: a.id,
            }),
          ).rejects.toThrow(/自身/);
          expect((await t.svc.accounts.require(root.id)).isLeaf).toBe(false);
          expect((await t.svc.dimensions.get(a.id))!.attrs.quantity).toBe(
            `1.${String(fraction).padStart(6, '0')}`,
          );
          const excel = excelService(t.forModule('masterdata'));
          const out = await excel.export('accounts');
          const imported = { kind: 'accounts' as const, ...out };
          const accountPreview = await excel.process(imported, false);
          expect(accountPreview.valid).toBe(true);
          await excel.process(
            { ...imported, previewToken: accountPreview.previewToken, confirmations: ['import'] },
            true,
          );
          expect(await t.svc.accounts.require(leaf.id)).toMatchObject({
            quantityUnit: '件',
            mnemonic: String(fraction),
            fullName: '测试设备/父级/末级',
          });
          const dimOut = await excel.export('dimensions', 'department');
          const dimensionInput = {
            kind: 'dimensions' as const,
            type: 'department' as const,
            ...dimOut,
          };
          const dimensionPreview = await excel.process(dimensionInput, false);
          await excel.process(
            {
              ...dimensionInput,
              previewToken: dimensionPreview.previewToken,
              confirmations: ['import'],
            },
            true,
          );
          expect((await t.svc.dimensions.get(a.id))!.attrs).toEqual({
            quantity: `1.${String(fraction).padStart(6, '0')}`,
            rate: '7.1234567890123456789',
          });
        } finally {
          await t.close();
        }
      },
    ),
    { numRuns: 8 },
  );
});
