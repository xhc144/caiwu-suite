import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '@caiwu/db';
import { createTestBook } from '@caiwu/testkit';
import { mapTemplateScheme, parseCodeScheme, parseTemplate } from '../src';
import { createCoreServices, loadServiceUser } from '../src/server';
import { coreMigrations } from '../src/server/migrations';

const template = {
  schemaVersion: 1,
  id: 'closing-semantics-test',
  version: '1',
  name: '合成结转语义测试',
  regime: 'enterprise',
  codeScheme: '4-2-2',
  categories: [{ id: 'pnl', name: '损益', direction: 'credit', isPnl: true }],
  accounts: [
    { code: '6001', name: '主营业务收入', category: 'pnl', closingRule: 'profit' },
    { code: '6901', name: '以前年度损益调整', category: 'pnl', closingRule: 'retained-earnings' },
  ],
  voucherTypes: [{ code: '记', name: '记账凭证' }],
};

it('w_xt_kgzb：结转用途枚举校验，不接受来源文字或未声明的值替代', () => {
  expect(() =>
    parseTemplate({
      ...template,
      accounts: [{ ...template.accounts[0], closingRule: '转本年利润' }],
    }),
  ).toThrow(/closingRule/);
  expect(parseTemplate(template).accounts[1]?.closingRule).toBe('retained-earnings');
  expect(
    mapTemplateScheme(parseTemplate(template), parseCodeScheme('4-3-3')).accounts[1]?.closingRule,
  ).toBe('retained-earnings');
});

describe.each(['4-2-2', '4-3-3'])('w_xt_kgzb / w_xt_kmwh：%s', (scheme) => {
  it('创建、读取、来源查询和重开保留机器结转用途，新增明细继承而非变回普通损益', async () => {
    const book = await createTestBook({
      templates: [template],
      templateId: template.id,
      codeScheme: scheme,
      seed: false,
    });
    try {
      expect((await book.svc.accounts.require('6001')).closingRule).toBe('profit');
      const child = await book.svc.accounts.create(
        {
          code: scheme === '4-2-2' ? '690101' : '6901001',
          name: '合成调整明细',
        },
        parseCodeScheme(scheme),
      );
      expect(child.closingRule).toBe('retained-earnings');
      expect(await book.svc.accounts.provenance(child.id)).toMatchObject({
        closingRule: 'retained-earnings',
      });
      await book.store.close(book.info.id);
      const opened = book.store.open(book.info.id);
      const svc = createCoreServices({
        ...book.svc.ctx,
        db: opened.db,
        user: (await loadServiceUser(opened.db, 1))!,
      });
      expect((await svc.accounts.get(child.id))?.closingRule).toBe('retained-earnings');
      expect((await svc.accounts.require('6901')).categoryId).toBe('pnl');
    } finally {
      await book.close();
    }
  });
});

it('旧账新增迁移只加可空字段，不按6901编码、名称或中文source推断语义', async () => {
  const opened = openDatabase(':memory:');
  try {
    runMigrations(opened.raw, [{ scope: 'core', migrations: coreMigrations.slice(0, 2) }]);
    opened.raw.exec(`
      INSERT INTO account_category (id,name,direction,is_pnl,sort) VALUES ('pnl','损益','credit',1,0);
      INSERT INTO account (code,name,full_name,parent_id,level,category_id,direction,is_leaf,disabled,is_cash,is_bank,cashflow_required,is_partner,currency_code,quantity_unit,pinyin,mnemonic,sort,created_at,updated_at,source)
      VALUES ('6901','以前年度损益调整','以前年度损益调整',NULL,1,'pnl','credit',1,0,0,0,0,0,NULL,NULL,'yqnd',NULL,0,'2026-01-01','2026-01-01','结转未分配利润后无余额');
    `);
    const before = opened.raw.prepare('SELECT * FROM account').get();
    runMigrations(opened.raw, [{ scope: 'core', migrations: coreMigrations }]);
    expect(opened.raw.prepare('SELECT * FROM account').get()).toEqual({
      ...(before as object),
      closing_rule: null,
    });
    expect(() => opened.raw.prepare("UPDATE account SET closing_rule='转本年利润'").run()).toThrow(
      /CHECK/,
    );
    expect(opened.raw.prepare('SELECT closing_rule FROM account').get()).toEqual({
      closing_rule: null,
    });
  } finally {
    await opened.close();
  }
});
