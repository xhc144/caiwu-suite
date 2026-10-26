import { afterEach, describe, expect, test } from 'vitest';
import fc from 'fast-check';
import ExcelJS from 'exceljs';
import { centsToYuan, sumCents } from '@caiwu/core';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { FIELDS, TABLES, TABLE_NAMES, type PrepareInput, type TableKind } from '../shared';
import { syntheticInput, syntheticTables } from '../sample';
import server from '../server';
import { exactCents } from '../server/plan';
import { parseDelimited } from '../server/parse';

const apps: TestApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
async function setup() {
  const app = await createTestApp({ modules: [server], seed: false });
  apps.push(app);
  return { app, api: app.call(server) };
}
function edit(input: PrepareInput, kind: TableKind, transform: (rows: string[][]) => void) {
  const file = input.files.find((f) => f.kind === kind)!;
  const rows = parseDelimited(Buffer.from(file.base64, 'base64').toString('utf8'), ',');
  transform(rows);
  file.base64 = Buffer.from(
    rows.map((r) => r.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n'),
  ).toString('base64');
  return input;
}
async function state(app: TestApp) {
  return {
    accounts: await app.svc.accounts.list(),
    opening: await app.svc.opening.list(2026),
    vouchers: await app.svc.vouchers.list({ includeVoided: true }),
    lines: await app.svc.db.selectFrom('voucher_line').selectAll().execute(),
    logs: await app.svc.log.list(),
    periods: await app.svc.periods.list(),
  };
}
const confirmation = '导入 测试账套';

describe('w_pz_get / w_xt_kmbm_get / w_xt_ye 标准化导入', () => {
  test('真实新账：预检完全回滚；提交后逐字段、科目、期初、来源计数、余额一致并锁定来源', async () => {
    const { app, api } = await setup();
    const before = await state(app);
    const input = syntheticInput();
    const preview = await api.inspect({ files: input.files });
    expect(preview.files).toHaveLength(4);
    expect(preview.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    const plan = await api.prepare(input);
    expect(plan.preview?.counts).toEqual(input.expected);
    expect(await state(app)).toEqual(before);
    const report = await api.execute({ id: plan.id, confirmation });
    expect(report.counts).toEqual(input.expected);
    expect(report.debitTotal).toBe(12345);
    expect(report.creditTotal).toBe(12345);
    expect(report.openingTotal).toBe(0);
    expect(report.balances.map((r) => r.closing)).toEqual([112345, -112345]);
    const voucher = await app.svc.vouchers.get(report.voucherIds[0]!);
    expect(voucher).toMatchObject({
      number: 7,
      attachments: 2,
      status: 'pending',
      source: { module: 'legacy-import', type: 'batch', id: plan.id },
    });
    expect((await api.get({ id: plan.id })).plan.vouchers[0]?.sourceId).toBe('SYN-001');
    expect((await api.get({ id: plan.id })).status).toBe('completed');
    await expect(app.svc.vouchers.delete(voucher!.id)).rejects.toThrow('不能在这里删除');
    await expect(
      app.svc.vouchers.update(
        voucher!.id,
        {
          date: voucher!.date,
          voucherTypeId: voucher!.voucherTypeId,
          number: voucher!.number,
          lines: voucher!.lines.map((l) => ({
            accountId: l.accountId,
            summary: l.summary,
            debit: l.debit,
            credit: l.credit,
          })),
        },
        { expectedRevision: voucher!.revision },
      ),
    ).rejects.toThrow('不能在这里修改');
    await expect(app.svc.vouchers.setVoided(voucher!.id, true)).rejects.toThrow('不能在这里');
    await expect(api.execute({ id: plan.id, confirmation })).rejects.toThrow('禁止重复');
    const renamed = syntheticInput();
    renamed.files.forEach((f) => {
      f.name = `改名-${f.name}`;
    });
    await expect(api.prepare(renamed)).rejects.toThrow('禁止重复导入');
    expect(
      (
        await app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['9998'],
          rollup: false,
        })
      )[0]?.closing,
    ).toBe(100000);
  });

  test('共享缺口：core setNumbers 也必须保护来源凭证原编号（当前保留失败断言）', async () => {
    const { app, api } = await setup();
    const plan = await api.prepare(syntheticInput());
    const report = await api.execute({ id: plan.id, confirmation });
    const voucher = await app.svc.vouchers.get(report.voucherIds[0]!);
    await expect(app.svc.vouchers.setNumbers([{ id: voucher!.id, number: 8 }])).rejects.toThrow(
      '不能在这里',
    );
    expect((await app.svc.vouchers.get(voucher!.id))?.number).toBe(7);
  });

  test('事务最后写日志失败：科目、期初、凭证、编号、余额、批次完成标志全部回滚', async () => {
    const { app, api } = await setup();
    const plan = await api.prepare(syntheticInput());
    const before = await state(app);
    app.runtime.bookStore.open(app.book.id).raw
      .exec(`CREATE TRIGGER fail_import_log BEFORE INSERT ON operation_log
      WHEN NEW.action = 'legacy-import.execute' BEGIN SELECT RAISE(ABORT, 'synthetic late failure'); END;`);
    await expect(api.execute({ id: plan.id, confirmation })).rejects.toThrow(
      'synthetic late failure',
    );
    expect(await state(app)).toEqual(before);
    expect((await api.get({ id: plan.id })).status).toBe('prepared');
  });

  test('权限：查看不能预检/执行；无查看不能读取来源；预检人绑定防止借用他人计划', async () => {
    const { app, api } = await setup();
    const viewerToken = await app.addUser('viewer', { permissions: ['legacy-import.view'] });
    const viewer = app.call(server, viewerToken);
    await expect(viewer.inspect({ files: syntheticInput().files })).rejects.toThrow('没有');
    await expect(viewer.prepare(syntheticInput())).rejects.toThrow('没有');
    const plan = await api.prepare(syntheticInput());
    await expect(viewer.execute({ id: plan.id, confirmation })).rejects.toThrow('没有');
    const otherToken = await app.addUser('other', {
      permissions: ['legacy-import.view', 'legacy-import.execute'],
    });
    await expect(
      app.call(server, otherToken).execute({ id: plan.id, confirmation }),
    ).rejects.toThrow('执行预检的操作员');
    const none = app.call(server, await app.addUser('none'));
    await expect(none.get({ id: plan.id })).rejects.toThrow('没有');
    await expect(none.template()).rejects.toThrow('没有');
  });

  test('备份保护：有业务的目标禁止导入，原凭证与期初不变', async () => {
    const { app, api } = await setup();
    await seedVouchers(app.svc, [
      {
        date: '2026-01-02',
        lines: [
          { account: '1601', debit: 100 },
          { account: '4001', credit: 100 },
        ],
      },
    ]);
    const before = await state(app);
    await expect(api.prepare(syntheticInput())).rejects.toThrow('只' + '能向新空账');
    expect(await state(app)).toEqual(before);
  });

  test('其他模块、备份元数据与未知表有行时从严阻止，不改已有保护文件或记录', async () => {
    const { app, api } = await setup();
    app.runtime.bookStore
      .open(app.book.id)
      .raw.exec(
        "CREATE TABLE synthetic_backup_item(id INTEGER PRIMARY KEY, marker TEXT); INSERT INTO synthetic_backup_item VALUES(1, 'keep');",
      );
    await expect(api.prepare(syntheticInput())).rejects.toThrow('无法证明是新空账');
    expect(
      app.runtime.bookStore
        .open(app.book.id)
        .raw.prepare('SELECT marker FROM synthetic_backup_item')
        .get(),
    ).toEqual({ marker: 'keep' });
  });

  test('预检后目标基础资料变化、错误确认、计划过期均不能执行', async () => {
    const { app, api } = await setup();
    const plan = await api.prepare(syntheticInput());
    await expect(api.execute({ id: plan.id, confirmation: '同意' })).rejects.toThrow('确认文字');
    await app.svc.accounts.create(
      { code: '9997', name: '预检后新增', categoryId: 'asset' },
      app.book.codeScheme,
    );
    await expect(api.execute({ id: plan.id, confirmation })).rejects.toThrow('已变化');
    const current = await api.prepare(syntheticInput());
    await app.svc.db
      .withTables<{ legacy_import_batch: { id: string; expires_at: string } }>()
      .updateTable('legacy_import_batch')
      .set({ expires_at: '2000-01-01T00:00:00.000Z' })
      .where('id', '=', current.id)
      .execute();
    await expect(api.execute({ id: current.id, confirmation })).rejects.toThrow('已过期');
    expect((await app.svc.vouchers.list()).total).toBe(0);
  });

  test('并发重复提交只成功一次，另一个明确拒绝且无重复凭证', async () => {
    const { app, api } = await setup();
    const plan = await api.prepare(syntheticInput());
    const results = await Promise.allSettled([
      api.execute({ id: plan.id, confirmation }),
      api.execute({ id: plan.id, confirmation }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await app.svc.vouchers.list()).total).toBe(1);
  });

  test.each([
    [
      '历史已过账状态',
      'vouchers',
      (r: string[][]) => {
        r[1]![4] = '已过账';
      },
      '不能降级',
    ],
    [
      '手工编号过大',
      'vouchers',
      (r: string[][]) => {
        r[1]![3] = '10001';
      },
      '凭证编号',
    ],
    [
      '日期早于开账年份',
      'vouchers',
      (r: string[][]) => {
        r[1]![1] = '2025-12-31';
      },
      '启用年度',
    ],
    [
      '找不到的末级科目',
      'vouchers',
      (r: string[][]) => {
        r[1]![7] = '1234';
      },
      '不存在或不是',
    ],
    [
      '借贷不平',
      'vouchers',
      (r: string[][]) => {
        r[1]![9] = '123.46';
      },
      '借贷不平',
    ],
    [
      '重复分录',
      'vouchers',
      (r: string[][]) => {
        r[2]![6] = '1';
      },
      '分录序号',
    ],
    [
      '期初借贷不平',
      'opening',
      (r: string[][]) => {
        r[1]![1] = '1000.01';
      },
      '期初余额借贷不平',
    ],
    [
      '来源期末差一分',
      'balances',
      (r: string[][]) => {
        r[1]![4] = '1123.46';
      },
      '来源余额',
    ],
    [
      '小数第三位不可舍入',
      'opening',
      (r: string[][]) => {
        r[1]![1] = '1000.001';
      },
      '最多两位',
    ],
    [
      '非空来源辅助列',
      'vouchers',
      (r: string[][]) => {
        r[0]!.push('部门编码');
        r.slice(1).forEach((v) => v.push('01'));
      },
      '未覆盖字段',
    ],
    [
      '即使空来源列也不得默弃',
      'accounts',
      (r: string[][]) => {
        r[0]!.push('助记码');
        r.slice(1).forEach((v) => v.push(''));
      },
      '未覆盖字段',
    ],
    [
      '未知上级',
      'accounts',
      (r: string[][]) => {
        r[1]![0] = '999801';
      },
      '必须完整覆盖',
    ],
  ] as const)(
    'w_pz_get / w_xt_kmbm_get / w_xt_ye 阻止规则：%s',
    async (_label, kind, transform, message) => {
      const { app, api } = await setup();
      const before = await state(app);
      await expect(api.prepare(edit(syntheticInput(), kind, transform))).rejects.toThrow(message);
      expect(await state(app)).toEqual(before);
    },
  );

  test('w_xt_kmbm_get：缺上级、编码级次错误、科目定义冲突都不能调整成其它科目', async () => {
    const { app, api } = await setup();
    const input = syntheticInput();
    for (const f of input.files)
      f.base64 = Buffer.from(
        Buffer.from(f.base64, 'base64').toString('utf8').replaceAll('9998', '999801'),
      ).toString('base64');
    await expect(api.prepare(input)).rejects.toThrow('上级');
    const conflict = syntheticInput();
    for (const f of conflict.files)
      f.base64 = Buffer.from(
        Buffer.from(f.base64, 'base64').toString('utf8').replaceAll('9998', '1601'),
      ).toString('base64');
    await expect(api.prepare(conflict)).rejects.toThrow('禁止覆盖');
    expect((await app.svc.vouchers.list()).total).toBe(0);
  });

  test('来源总数漏填或与文件不一致，重复表头、缺文件、错误映射不能导入', async () => {
    const { api } = await setup();
    const missing = syntheticInput();
    missing.expected.lines = 3;
    await expect(api.prepare(missing)).rejects.toThrow('来源总数不一致');
    await expect(api.inspect({ files: syntheticInput().files.slice(1) })).rejects.toThrow(
      '缺少科目',
    );
    await expect(
      api.prepare(
        edit(syntheticInput(), 'opening', (r) => {
          r[0]![1] = r[0]![0]!;
        }),
      ),
    ).rejects.toThrow('表头');
    const mapping = syntheticInput();
    mapping.mappings.opening.balance = '不存在';
    await expect(api.prepare(mapping)).rejects.toThrow('映射');
  });

  test('Excel 文本模板可完整导入；数值单元格、公式、未知工作表和伪装 bak 被拒绝', async () => {
    const { api } = await setup();
    const template = await api.template();
    const input = syntheticInput();
    input.files = [{ name: '示例.xlsx', kind: 'workbook', base64: template.base64 }];
    const result = await api.prepare(input);
    expect(result.preview?.counts).toEqual(input.expected);
    for (const value of [123.45, { formula: '1+1', result: 2 }]) {
      const workbook = new ExcelJS.Workbook();
      for (const k of TABLES) workbook.addWorksheet(TABLE_NAMES[k]).addRows(syntheticTables()[k]);
      workbook.getWorksheet('期初')!.getCell('B2').value = value;
      const file = {
        ...input.files[0]!,
        base64: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64'),
      };
      await expect(api.inspect({ files: [file] })).rejects.toThrow('必须为文本');
    }
    await expect(
      api.inspect({ files: [{ ...input.files[0]!, name: '原账.bak' }] }),
    ).rejects.toThrow('xlsx');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('未支持表').addRows([['列'], ['值']]);
    await expect(
      api.inspect({
        files: [
          {
            ...input.files[0]!,
            base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
          },
        ],
      }),
    ).rejects.toThrow('禁止忽略');
  });

  test('文本 CSV/TSV 引号、UTF-8 BOM 与换行保真，GB18030 明确选择；损坏编码阻止', async () => {
    expect(parseDelimited('\uFEFFA,B\r\n"a,b","一\n二"\r\n', ',')).toEqual([
      ['A', 'B'],
      ['a,b', '一\n二'],
    ]);
    expect(() => parseDelimited('A\n"未闭合', ',')).toThrow('未闭合');
    expect(() => parseDelimited('A\n"a"x', ',')).toThrow('多余字符');
    const { api } = await setup();
    const input = syntheticInput();
    const tables = syntheticTables();
    input.files = TABLES.map((kind) => ({
      name: `${TABLE_NAMES[kind]}.tsv`,
      kind,
      base64: Buffer.from('\uFEFF' + tables[kind].map((r) => r.join('\t')).join('\n')).toString(
        'base64',
      ),
    }));
    expect((await api.prepare(input)).counts).toEqual(input.expected);
    const bad = syntheticInput();
    bad.files[0]!.base64 = Buffer.from([0xff]).toString('base64');
    await expect(api.inspect({ files: bad.files })).rejects.toThrow('字符编码');
  });

  test('整数金额属性：含红字的精确元文本往返，三位小数与科学计数永不舍入', () => {
    fc.assert(
      fc.property(fc.integer({ min: -2_000_000_000, max: 2_000_000_000 }), (cents) => {
        const absolute = Math.abs(cents);
        const text = `${cents < 0 ? '-' : ''}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
        expect(exactCents(text)).toBe(cents);
      }),
      { numRuns: 200 },
    );
    for (const text of ['1e3', '1.001', '1,000.00', '90071992547409.92'])
      expect(() => exactCents(text)).toThrow();
    expect(Object.keys(FIELDS.accounts)).toContain('direction');
  });

  test('明确选择 GB18030 后可读取中文方向；错误选择 UTF-8 拒绝乱码', async () => {
    const { api } = await setup();
    const input = syntheticInput();
    const bytes = Buffer.concat([
      Buffer.from('code,name,category,direction\n9998,DemoDebit,asset,'),
      Buffer.from([0xbd, 0xe8]),
      Buffer.from('\n9999,DemoCredit,equity,'),
      Buffer.from([0xb4, 0xfb]),
    ]);
    input.files[0] = {
      name: '科目.csv',
      kind: 'accounts',
      encoding: 'gb18030',
      base64: bytes.toString('base64'),
    };
    input.mappings.accounts = {
      code: 'code',
      name: 'name',
      category: 'category',
      direction: 'direction',
    };
    expect((await api.prepare(input)).counts).toEqual(input.expected);
    input.files[0].encoding = 'utf-8';
    await expect(api.prepare(input)).rejects.toThrow('字符编码');
  });

  test('记账不变量：随机正数/红字分录导入，借贷及逐科目余额与整数来源严格相同', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -10_000_000, max: 10_000_000 }).filter((v) => v !== 0),
        async (amount) => {
          const { app, api } = await setup();
          const input = edit(syntheticInput(), 'vouchers', (rows) => {
            rows[1]![9] = centsToYuan(amount);
            rows[2]![10] = centsToYuan(amount);
          });
          edit(input, 'balances', (rows) => {
            rows[1]![2] = rows[1]![5] = centsToYuan(amount);
            rows[1]![4] = centsToYuan(sumCents([100000, amount]));
            rows[2]![3] = rows[2]![6] = centsToYuan(amount);
            rows[2]![4] = centsToYuan(sumCents([-100000, -amount]));
          });
          const plan = await api.prepare(input);
          expect(await app.svc.accounts.getByCode('9998')).toBeNull();
          const report = await api.execute({ id: plan.id, confirmation });
          expect(report.debitTotal).toBe(amount);
          expect(report.creditTotal).toBe(amount);
          expect(sumCents(report.balances.map((b) => b.closing))).toBe(0);
          expect(report.balances.map((b) => b.closing)).toEqual([
            sumCents([100000, amount]),
            sumCents([-100000, -amount]),
          ]);
        },
      ),
      { numRuns: 12 },
    );
  });
});
