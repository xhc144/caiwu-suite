import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { coreRouter, createRuntime, t } from '@caiwu/server-kit';
import analysis from '../server';
import { seedReferenceData } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';

describe('w_fx_nd_1/w_fx_def 关闭账套后恢复', () => {
  it('冻结版迁移升级后，整分/六位结果和取数原值跨运行环境回读，旧合同备注不丢失', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'analysis-reopen-'));
    let runtime = createRuntime({
      dataDir,
      modules: [{ ...analysis, migrations: analysis.migrations.slice(0, 3) }],
      devMode: true,
    });
    try {
      const book = await runtime.bookStore.create({
        name: '合成恢复账套',
        orgName: '合成单位',
        templateId: 'demo-enterprise',
        product: 'chengben',
        startYear: 2026,
        startMonth: 1,
        adminPassword: 'test-only',
      });
      const login = async () =>
        (
          await t
            .createCallerFactory(coreRouter)({ app: runtime, token: null })
            .auth.login({ bookId: book.id, userCode: 'admin', password: 'test-only' })
        ).token;
      let token = await login();
      let api = t.createCallerFactory(analysis.router)({ app: runtime, token });
      const definition = await api.definitions.save({
        code: '1',
        name: '精确结果',
        expectedRevision: 0,
        rows: [
          { key: 1, name: '金额', formula: '90071992547409.91', unit: 'money' },
          { key: 2, name: '数量', formula: '1.234567', unit: 'number', decimalPlaces: 6 },
        ],
      });
      // 不将最大金额和其它项相加；每个项目独立校验安全范围。
      const sheet = await api.definitions.calculate({
        definitionId: definition.id,
        periodFrom: 202601,
        periodTo: 202601,
      });
      const saved = await api.results.save({ expectedRevision: 0, name: '可恢复精确稿', sheet });
      await runtime.bookStore.withBook(book.id, async (opened) => {
        await seedReferenceData(
          createCoreServices({
            db: opened.db,
            user: (await loadServiceUser(opened.db, 1))!,
            moduleId: null,
            now: runtime.now,
            modules: runtime.modules.lookup,
          }),
          202601,
        );
        opened.raw
          .exec(`INSERT INTO analysis_contract(code,name,partner_id,account_id,signed_date,kind,amount,opening,description,remark,created_by,reviewed_by,revision)
          SELECT 'OLD','旧合同',d.id,a.id,'2026-01-01','receipt',12345,0,'旧说明','旧备注',1,NULL,1 FROM dimension_item d,account a WHERE d.type_id='partner' AND d.code='C001' AND a.code='1122';`);
      });
      await runtime.bookStore.dispose();
      runtime = createRuntime({ dataDir, modules: [analysis], devMode: true });
      token = await login();
      api = t.createCallerFactory(analysis.router)({ app: runtime, token });
      const reopened = await api.results.get({ id: saved.id });
      expect(reopened.sheet.rows.map((r) => r.values[0])).toEqual([
        Number.MAX_SAFE_INTEGER,
        1234567,
      ]);
      expect(reopened.sheet.rows.map((r) => r.originalValues[0])).toEqual([
        Number.MAX_SAFE_INTEGER,
        1234567,
      ]);
      expect(reopened.sheet.rows[1]!.decimalPlaces).toBe(6);
      expect((await api.definitions.get({ id: definition.id })).rows[1]!.formula).toBe('1.234567');
      // 升级仅增加第二备注列，不改旧列。
      await runtime.bookStore.withBook(book.id, async (opened) => {
        const columns = opened.raw.prepare('PRAGMA table_info(analysis_contract)').all() as {
          name: string;
        }[];
        expect(columns.map((c) => c.name)).toContain('remark2');
        const old = opened.raw
          .prepare('SELECT remark,remark2 FROM analysis_contract WHERE code=?')
          .get('OLD');
        expect(old).toEqual({ remark: '旧备注', remark2: '' });
      });
    } finally {
      await runtime.bookStore.dispose();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
