import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { parseTemplate, templateProblems, type BookInfo } from '@caiwu/core';
import { CopySchema, filterBooks, validateScheme, WizardSchema } from '../shared';
import booksServer from '../server';
import { booksService, type FileHooks } from '../server/service';
import small from '../templates/small-business.json';
import enterprise from '../templates/enterprise.json';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [booksServer], seed: false });
});
afterEach(async () => {
  await app.close();
});
const create = (overrides = {}) =>
  app.core(null).books.create({
    name: '目标账套',
    orgName: '目标单位',
    templateId: small.id,
    product: 'qingsong',
    startYear: 2026,
    startMonth: 7,
    adminPassword: 'target-pass',
    ...overrides,
  });
const auth = (b: BookInfo, overrides = {}) => ({
  targetId: b.id,
  userCode: 'admin',
  password: 'target-pass',
  ...overrides,
});
const copyInput = (b: BookInfo, overrides = {}) => ({
  ...auth(b),
  name: '新副本',
  requestId: randomUUID(),
  confirmed: true as const,
  ...overrides,
});
const files = () => readdirSync(app.runtime.bookStore.booksDir).sort();
async function service(hooks: FileHooks = {}) {
  const token = await app.login();
  const actor = app.runtime.sessions.get(token)!;
  return booksService(app.runtime, app.svcFor('books'), actor, hooks);
}
async function targetSvc(b: BookInfo) {
  const opened = app.runtime.bookStore.open(b.id);
  return createCoreServices({
    ...app.svc.ctx,
    db: opened.db,
    user: (await loadServiceUser(opened.db, 1))!,
    moduleId: 'books',
  });
}

describe('w_tzjl_1 / w_xt_kgzb_1 / w_xt_kgzb_3 新建账套', () => {
  it.each([
    { name: ' ' },
    { orgName: '  ' },
    { name: '字'.repeat(61) },
    { orgName: '字'.repeat(101) },
    { templateId: '' },
    { templateId: 'missing' },
    { codeScheme: '' },
    { codeScheme: '3-2-2' },
    { codeScheme: '4-0' },
    { codeScheme: '4-7' },
    { codeScheme: '4-1-1-1-1-1-1-1-1' },
    { startYear: 1999 },
    { startYear: 2101 },
    { startMonth: 0 },
    { startMonth: 13 },
    { startMonth: 1.5 },
  ])('阻止非法参数且无半成品：%j', async (bad) => {
    const before = files();
    await expect(create(bad)).rejects.toThrow();
    expect(files()).toEqual(before);
  });
  it('w_tzjl / w_login 没有任何账套时仍可从登记模板创建首个账套', async () => {
    await app.runtime.bookStore.close(app.book.id);
    rmSync(app.runtime.bookStore.pathOf(app.book.id));
    expect(await app.core(null).books.list()).toEqual([]);
    const first = await create();
    expect((await app.core(null).books.list()).map((b) => b.id)).toEqual([first.id]);
    expect(await (await targetSvc(first)).accounts.list()).toHaveLength(66);
  });
  it('w_xt_kgzb_1 创建中途失败回滚，无假账套且能重试', async () => {
    const before = files();
    await expect(create({ adminCode: '' })).rejects.toThrow();
    expect(files()).toEqual(before);
    const book = await create();
    expect((await app.core(null).books.list()).some((b) => b.id === book.id)).toBe(true);
  });
  it('w_tzjl_1_new trim名称/单位，UUID替代两位代码和保留字，不设许可数量限制', async () => {
    for (const name of [' ID ', 'XL', 'ZC', 'CS']) {
      const b = await create({ name, orgName: ' 单位 ' });
      expect(b.name).toBe(name.trim());
      expect(b.orgName).toBe('单位');
      expect(b.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect((await app.runtime.bookStore.list()).length).toBe(5);
  });
  it('w_xt_kgzb_a4/a5 仅CNY；年中启用仍为公历年度，期间从启用月起', async () => {
    expect('baseCurrency' in WizardSchema.shape).toBe(false);
    const b = await create();
    const svc = await targetSvc(b);
    expect(b.baseCurrency).toBe('CNY');
    expect((await svc.reference.currencies()).filter((c) => c.isBase).map((c) => c.code)).toEqual([
      'CNY',
    ]);
    expect((await svc.periods.list()).map((p) => p.month)).toEqual([7, 8, 9, 10, 11, 12]);
    expect((await svc.periods.years())[0]).toMatchObject({ year: 2026, opening_period: 202607 });
    expect((await svc.accounts.list()).length).toBe(66);
  });
  it('w_xt_kgzb_a2/a3 无空白制度、空级次，兼容级次提示指向具体科目', () => {
    const t = parseTemplate(small);
    expect(() => validateScheme(t, '3-2-2')).toThrow(/1001/);
    expect(() => validateScheme(t, '')).toThrow(/1–6/);
    expect(WizardSchema.safeParse({}).success).toBe(false);
    expect(() => parseTemplate({ ...small, accounts: [] })).toThrow();
  });
});

describe('w_xt_tz 账套信息', () => {
  it('当前账套信息真实保存，制度/级次/启用期间不被客户端附加字段改变', async () => {
    const original = await app.call(booksServer).info();
    const saved = await app.call(booksServer).update({
      name: ' 新名称 ',
      orgName: ' 新单位 ',
      ...{ templateId: 'fake', codeScheme: '1', startPeriod: 199901 },
    });
    expect(saved).toMatchObject({ ...original, name: '新名称', orgName: '新单位' });
    expect((await app.runtime.bookStore.list()).find((b) => b.id === saved.id)?.name).toBe(
      '新名称',
    );
    expect((await app.svc.log.list()).some((l) => l.action === 'books.edit')).toBe(true);
  });
  it('日志失败时名称和单位全部回滚', async () => {
    app.runtime.bookStore
      .open(app.book.id)
      .raw.exec(
        "CREATE TRIGGER books_test_log_fail BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT, 'injected log failure'); END;",
      );
    await expect(
      app.call(booksServer).update({ name: '失败名称', orgName: '失败单位' }),
    ).rejects.toThrow();
    expect(await app.svc.book.info()).toMatchObject({
      name: app.book.name,
      orgName: app.book.orgName,
    });
  });
  it('查看用户不能修改、复制或删除，未登录不能调用模块过程', async () => {
    const viewer = app.call(
      booksServer,
      await app.addUser('viewer', { permissions: ['books.view'] }),
    );
    expect((await viewer.info()).id).toBe(app.book.id);
    await expect(viewer.update({ name: 'x', orgName: 'x' })).rejects.toThrow(/权限/);
    await expect(viewer.copy(copyInput(app.book))).rejects.toThrow(/权限/);
    await expect(viewer.prepareDelete(auth(app.book))).rejects.toThrow(/权限/);
    await expect(app.call(booksServer, null).info()).rejects.toThrow(/登录/);
  });
});

describe('w_tzjl_2 / w_tzjl_kl 复制', () => {
  it('先确认来源；在线快照包含WAL新写入，复制新身份、全部数据和管理员，源不变', async () => {
    const b = await create();
    const src = await targetSvc(b);
    await src.settings.set('live-data', { value: 123 });
    const before = await src.book.info();
    const logBefore = await src.log.list();
    expect(CopySchema.safeParse({ ...copyInput(b), confirmed: false }).success).toBe(false);
    const result = await app.call(booksServer).copy(copyInput(b));
    expect(result.id).not.toBe(b.id);
    expect(result.name).toBe('新副本');
    const dst = await targetSvc(result);
    expect(await dst.settings.get('live-data', null)).toEqual({ value: 123 });
    expect((await dst.accounts.list()).map((a) => a.code)).toEqual(
      (await src.accounts.list()).map((a) => a.code),
    );
    expect(await src.book.info()).toEqual(before);
    expect(await src.log.list()).toEqual(logBefore);
    const login = await app
      .core(null)
      .auth.login({ bookId: result.id, userCode: 'admin', password: 'target-pass' });
    expect(login.book.id).toBe(result.id);
  });
  it('并发重试只生成一个复制品；重启式新服务复用持久收据；同请求不同名称拒绝', async () => {
    const b = await create();
    const input = copyInput(b);
    const [a, c] = await Promise.all([
      app.call(booksServer).copy(input),
      app.call(booksServer).copy(input),
    ]);
    expect(a.id).toBe(c.id);
    expect(files().filter((f) => f.endsWith('.caiwu'))).toHaveLength(3);
    expect((await (await service()).copy(input)).id).toBe(a.id);
    await expect(app.call(booksServer).copy({ ...input, name: '不同名称' })).rejects.toThrow(
      /其它名称/,
    );
  });
  it.each([{ userCode: '' }, { password: 'admin' }, { userCode: 'missing' }])(
    '目标空代码/错密码/不存在用户均拒绝，不能用A身份复制B %j',
    async (bad) => {
      const b = await create();
      const before = files();
      await expect(app.call(booksServer).copy(copyInput(b, bad))).rejects.toThrow();
      expect(files()).toEqual(before);
    },
  );
  it('目标用户没有books.copy权限拒绝，即使请求账套管理员有权限', async () => {
    const b = await create();
    await (await targetSvc(b)).users.create({ code: 'clerk', name: '无权用户', password: 'pw' });
    await expect(
      app.call(booksServer).copy(copyInput(b, { userCode: 'clerk', password: 'pw' })),
    ).rejects.toThrow(/权限/);
  });
  it('发布前故障清理临时文件，源和既有账套不变，恢复后同请求能重试', async () => {
    const b = await create();
    const before = files();
    const input = copyInput(b);
    await expect(
      (
        await service({
          beforePublish: () => {
            throw new Error('inject');
          },
        })
      ).copy(input),
    ).rejects.toThrow(/复制失败/);
    expect(files()).toEqual(before);
    await expect((await targetSvc(b)).book.info()).resolves.toMatchObject({ id: b.id });
    expect((await app.call(booksServer).copy(input)).id).not.toBe(b.id);
  });
  it('w_tzjl_2 原子发布拒绝覆盖已占用UUID文件', async () => {
    const b = await create();
    let occupied = '';
    const svc = await service({
      beforePublish: () => {
        const tmp = files().find((name) => name.endsWith('.copying'))!;
        occupied = app.runtime.bookStore.pathOf(tmp.slice(1, -8));
        writeFileSync(occupied, '已占用，不能覆盖');
      },
    });
    await expect(svc.copy(copyInput(b))).rejects.toThrow(/复制失败/);
    expect(readFileSync(occupied, 'utf8')).toBe('已占用，不能覆盖');
    expect((await (await targetSvc(b)).book.info()).name).toBe(b.name);
  });
  it('快照失败不留下可见副本，不声称成功', async () => {
    const b = await create();
    const before = files();
    await expect(
      (
        await service({
          snapshot: async () => {
            throw new Error('disk full');
          },
        })
      ).copy(copyInput(b)),
    ).rejects.toThrow(/复制失败/);
    expect(files()).toEqual(before);
  });
});

describe('w_tzjl / w_tzjl_kl 安全删除', () => {
  it('不能删除当前正在使用账套，并给切换下一步', async () => {
    await expect(
      app.call(booksServer).prepareDelete(auth(app.book, { password: 'admin' })),
    ).rejects.toThrow(/当前正在使用/);
    expect(app.runtime.bookStore.exists(app.book.id)).toBe(true);
  });
  it.each([{ userCode: '' }, { password: 'admin' }, { userCode: 'missing' }])(
    '空代码/错误目标密码/身份不符零破坏 %j',
    async (bad) => {
      const b = await create();
      const before = files();
      await expect(app.call(booksServer).prepareDelete(auth(b, bad))).rejects.toThrow();
      expect(files()).toEqual(before);
    },
  );
  it('目标账套无删除权限拒绝', async () => {
    const b = await create();
    await (
      await targetSvc(b)
    ).users.create({ code: 'clerk', name: 'clerk', password: 'pw', permissions: ['books.view'] });
    await expect(
      app.call(booksServer).prepareDelete(auth(b, { userCode: 'clerk', password: 'pw' })),
    ).rejects.toThrow(/权限/);
    expect(app.runtime.bookStore.exists(b.id)).toBe(true);
  });
  it('先备份再强确认；取消、错误名称、未备份票据、票据跨会话均不删除', async () => {
    const b = await create();
    const api = app.call(booksServer);
    const p = await api.prepareDelete(auth(b));
    expect(existsSync(path.join(app.runtime.dataDir, 'books-backups', p.backupId))).toBe(true);
    await expect(api.remove({ ...auth(b), ticket: p.ticket, confirmName: '错误' })).rejects.toThrow(
      /名称不一致/,
    );
    await expect(
      api.remove({ ...auth(b), ticket: randomUUID(), confirmName: b.name }),
    ).rejects.toThrow(/失效/);
    const other = app.call(booksServer, await app.login());
    await expect(
      other.remove({ ...auth(b), ticket: p.ticket, confirmName: b.name }),
    ).rejects.toThrow(/失效/);
    await api.cancelDelete({ ticket: p.ticket });
    await expect(api.remove({ ...auth(b), ticket: p.ticket, confirmName: b.name })).rejects.toThrow(
      /失效/,
    );
    expect(app.runtime.bookStore.exists(b.id)).toBe(true);
  });
  it('备份失败零破坏，原会话仍有效', async () => {
    const b = await create();
    const login = await app
      .core(null)
      .auth.login({ bookId: b.id, userCode: 'admin', password: 'target-pass' });
    await expect(
      (
        await service({
          snapshot: async () => {
            throw new Error('disk full');
          },
        })
      ).prepareDelete(auth(b)),
    ).rejects.toThrow(/备份失败/);
    expect(app.runtime.bookStore.exists(b.id)).toBe(true);
    expect(app.runtime.sessions.get(login.token)).not.toBeNull();
  });
  it('最终快照失败不删除，移动后故障补偿回原文件，可重试成功且目标全部会话失效', async () => {
    const b = await create();
    const login = await app
      .core(null)
      .auth.login({ bookId: b.id, userCode: 'admin', password: 'target-pass' });
    let failBackup = false;
    let failMove = false;
    const svc = await service({
      snapshot: async (raw, file) => {
        if (failBackup) throw new Error('backup');
        await raw.backup(file);
      },
      afterArchive: () => {
        if (failMove) throw new Error('move');
      },
    });
    const p = await svc.prepareDelete(auth(b));
    const input = { ...auth(b), ticket: p.ticket, confirmName: b.name };
    failBackup = true;
    await expect(svc.remove(input)).rejects.toThrow(/备份失败/);
    expect(app.runtime.bookStore.exists(b.id)).toBe(true);
    failBackup = false;
    failMove = true;
    await expect(svc.remove(input)).rejects.toThrow(/未完成/);
    expect(app.runtime.bookStore.exists(b.id)).toBe(true);
    expect(app.runtime.sessions.get(login.token)).not.toBeNull();
    failMove = false;
    const result = await svc.remove(input);
    expect(result.ok).toBe(true);
    expect(app.runtime.bookStore.exists(b.id)).toBe(false);
    expect(app.runtime.sessions.get(login.token)).toBeNull();
    expect(existsSync(path.join(app.runtime.dataDir, 'books-trash', result.archiveId))).toBe(true);
    expect(existsSync(path.join(app.runtime.dataDir, 'books-backups', result.backupId))).toBe(true);
    expect(await svc.remove(input)).toEqual(result);
    await expect(app.core(login.token).auth.me()).rejects.toThrow(/登录/);
  });
  it('w_tzjl 删除审计事务失败时移回原文件，备份保留且可重试', async () => {
    const b = await create();
    const api = app.call(booksServer);
    const p = await api.prepareDelete(auth(b));
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TRIGGER books_test_delete_log BEFORE INSERT ON operation_log WHEN NEW.action='books.delete' BEGIN SELECT RAISE(ABORT, 'audit failure'); END;",
    );
    await expect(api.remove({ ...auth(b), ticket: p.ticket, confirmName: b.name })).rejects.toThrow(
      /未完成/,
    );
    expect(app.runtime.bookStore.exists(b.id)).toBe(true);
    expect(existsSync(path.join(app.runtime.dataDir, 'books-backups', p.backupId))).toBe(true);
    raw.exec('DROP TRIGGER books_test_delete_log');
    expect((await api.remove({ ...auth(b), ticket: p.ticket, confirmName: b.name })).ok).toBe(true);
  });
  it('w_tzjl 无法建立备份目录时返回中文业务错误且零破坏', async () => {
    const b = await create();
    writeFileSync(path.join(app.runtime.dataDir, 'books-backups'), 'occupied');
    await expect(app.call(booksServer).prepareDelete(auth(b))).rejects.toThrow(/备份失败/);
    expect(app.runtime.bookStore.exists(b.id)).toBe(true);
  });
  it('确认时重新验证密码和目标名称；备份后改密或改名则不删除', async () => {
    const b = await create();
    const api = app.call(booksServer);
    const p = await api.prepareDelete(auth(b));
    const svc = await targetSvc(b);
    await svc.users.setPassword(1, 'new-pass');
    await expect(api.remove({ ...auth(b), ticket: p.ticket, confirmName: b.name })).rejects.toThrow(
      /密码/,
    );
    await svc.db.updateTable('book_info').set({ name: '已改名' }).where('id', '=', 1).execute();
    await expect(
      api.remove({ ...auth(b, { password: 'new-pass' }), ticket: p.ticket, confirmName: b.name }),
    ).rejects.toThrow(/名称已变更/);
    expect(app.runtime.bookStore.exists(b.id)).toBe(true);
  });
});

describe('w_login / w_xt_tz_find 查找和文件异常', () => {
  it('名称、单位、制度文字可查；空结果明确，损坏文件诊断不静默卡住', async () => {
    await create();
    const list = await app.core(null).books.list();
    expect(filterBooks(list, '目标账套')).toHaveLength(1);
    expect(filterBooks(list, '目标单位')).toHaveLength(1);
    expect(filterBooks(list, '小企业')).toHaveLength(1);
    expect(filterBooks(list, '不存在')).toEqual([]);
    const id = randomUUID();
    writeFileSync(app.runtime.bookStore.pathOf(id), 'damaged');
    expect(await app.call(booksServer).diagnostics()).toEqual([
      { id, message: expect.stringMatching(/损坏/) },
    ]);
    await expect(
      app.call(booksServer).copy({ ...copyInput(app.book), targetId: id }),
    ).rejects.toThrow(/损坏/);
    await expect(
      app.call(booksServer).copy({ ...copyInput(app.book), targetId: randomUUID() }),
    ).rejects.toThrow(/移走/);
  });
});

describe('w_xt_kgzb_a2/a3 模板', () => {
  it.each([small, enterprise])('schema/重复/父链/类别/币种/source自洽：$id', (raw) => {
    const t = parseTemplate(raw);
    expect(templateProblems(t)).toEqual([]);
    expect(new Set(t.accounts.map((a) => a.code)).size).toBe(t.accounts.length);
    for (const a of t.accounts) expect(a.source).toMatch(/\.pdf|待核/);
    expect(validateScheme(t, '4-2-2')).toEqual([4, 2, 2]);
    expect(validateScheme(t, '4-3-3')).toEqual([4, 3, 3]);
  });
  it('66项逐项编码和名称对照附录；资产备抵和损益正常方向明确', () => {
    expect(small.accounts).toHaveLength(66);
    const expected =
      '1001库存现金 1002银行存款 1012其他货币资金 1101短期投资 1121应收票据 1122应收账款 1123预付账款 1131应收股利 1132应收利息 1221其他应收款 1401材料采购 1402在途物资 1403原材料 1404材料成本差异 1405库存商品 1407商品进销差价 1408委托加工物资 1411周转材料 1421消耗性生物资产 1501长期债券投资 1511长期股权投资 1601固定资产 1602累计折旧 1604在建工程 1605工程物资 1606固定资产清理 1621生产性生物资产 1622生产性生物资产累计折旧 1701无形资产 1702累计摊销 1801长期待摊费用 1901待处理财产损溢 2001短期借款 2201应付票据 2202应付账款 2203预收账款 2211应付职工薪酬 2221应交税费 2231应付利息 2232应付利润 2241其他应付款 2401递延收益 2501长期借款 2701长期应付款 3001实收资本 3002资本公积 3101盈余公积 3103本年利润 3104利润分配 4001生产成本 4101制造费用 4301研发支出 4401工程施工 4403机械作业 5001主营业务收入 5051其他业务收入 5111投资收益 5301营业外收入 5401主营业务成本 5402其他业务成本 5403营业税金及附加 5601销售费用 5602管理费用 5603财务费用 5711营业外支出 5801所得税费用'.split(
        ' ',
      );
    expect(small.accounts.map((a) => a.code + a.name)).toEqual(expected);
    for (const code of ['1407', '1602', '1622', '1702', '5001', '5111'])
      expect(small.accounts.find((a) => a.code === code)?.direction).toBe('credit');
    expect(small.accounts.find((a) => a.code === '1702')?.needsReview).toBe(true);
    expect(enterprise.accounts.every((a) => a.needsReview && a.source.includes('待核'))).toBe(true);
  });
  it.each([small.id, enterprise.id])('两种兼容级次真实建账科目集一致：%s', async (templateId) => {
    const a = await create({ templateId, codeScheme: '4-2-2' });
    const b = await create({ templateId, codeScheme: '4-3-3' });
    const read = async (book: BookInfo) =>
      (await (await targetSvc(book)).accounts.list()).map((a) => ({
        code: a.code,
        name: a.name,
        direction: a.direction,
        categoryId: a.categoryId,
      }));
    expect(await read(a)).toEqual(await read(b));
  });
});
