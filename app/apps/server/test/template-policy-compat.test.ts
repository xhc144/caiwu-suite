import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseCodeScheme } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { coreRouter, createRuntime, defineServerModule, t } from '@caiwu/server-kit';
import books from '../../../modules/books/server';
import templates from '../../../modules/templates/server';
import systemAdmin from '../../../modules/system-admin/server';

it('w_xt_kgzb / w_tzjl：旧账打开与复制不重载模板，新建规则不阻止既有受管初始化及取消保护', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-template-compat-'));
  // 模拟接线前实际可建出的旧账；仅此历史 fixture 不注册新建校验。
  const historicalTemplates = defineServerModule(templates.manifest, {
    ...templates,
    validateBookCreation: undefined,
  });
  const prior = createRuntime({
    dataDir,
    modules: [books, historicalTemplates, systemAdmin],
    devMode: false,
  });
  const oldInput = {
    name: '接线前旧账',
    orgName: '合成民非单位',
    templateId: 'nonprofit-2026',
    product: 'minfei' as const,
    startYear: 2025,
    startMonth: 1,
    adminPassword: 'legacy-password',
  };
  let old;
  let original;
  try {
    old = await prior.bookStore.create(oldInput);
    const opened = prior.bookStore.open(old.id);
    const svc = createCoreServices({
      db: opened.db,
      user: (await loadServiceUser(opened.db, 1))!,
      moduleId: null,
      modules: prior.modules.lookup,
      now: prior.now,
    });
    await svc.accounts.create(
      {
        code: '1999',
        name: '历史自设科目',
        categoryId: 'asset',
        direction: 'debit',
        sourceVersion: 'historical-custom',
      },
      parseCodeScheme('4-2-2'),
    );
    original = await svc.accounts.list();
  } finally {
    await prior.lifecycle.stop();
  }
  const app = createRuntime({ dataDir, modules: [books, templates, systemAdmin], devMode: false });
  const core = (token: string | null = null) => t.createCallerFactory(coreRouter)({ app, token });
  try {
    await expect(core().books.create(oldInput)).rejects.toThrow('不能用于');
    const login = await core().auth.login({
      bookId: old.id,
      userCode: 'admin',
      password: 'legacy-password',
    });
    expect(login.book).toEqual(old);
    expect(await core(login.token).accounts.list()).toEqual(original);
    await app.bookStore.close(old.id);
    expect(await core(login.token).accounts.list()).toEqual(original);

    const bookApi = t.createCallerFactory(books.router)({ app, token: login.token });
    const copy = await bookApi.copy({
      targetId: old.id,
      name: '旧账独立复制',
      userCode: 'admin',
      password: 'legacy-password',
      requestId: randomUUID(),
      confirmed: true,
    });
    expect(copy).toMatchObject({
      templateId: old.templateId,
      startPeriod: 202501,
      codeScheme: old.codeScheme,
    });
    const copiedLogin = await core().auth.login({
      bookId: copy.id,
      userCode: 'admin',
      password: 'legacy-password',
    });
    expect(await core(copiedLogin.token).accounts.list()).toEqual(original);
    expect(await core(login.token).accounts.list()).toEqual(original);

    const reset = t.createCallerFactory(systemAdmin.router)({ app, token: login.token }).reset;
    const parameters = {
      name: '旧账明确重新初始化',
      orgName: old.orgName,
      templateId: old.templateId,
      codeScheme: '4-2-2',
      startYear: 2025,
      startMonth: 1,
      numbering: 'automatic' as const,
    };
    const cancelled = await reset.prepare({ parameters, password: 'legacy-password' });
    await reset.cancel({ planId: cancelled.planId });
    expect(await core(login.token).accounts.list()).toEqual(original);
    const plan = await reset.prepare({ parameters, password: 'legacy-password' });
    await reset.execute({
      planId: plan.planId,
      confirmBookName: old.name,
      password: 'legacy-password',
      confirmed: true,
      confirmation: '重新初始化',
    });
    await expect(core(login.token).auth.me()).rejects.toThrow('登录已失效');
    const reopened = await core().auth.login({
      bookId: old.id,
      userCode: 'admin',
      password: 'legacy-password',
    });
    expect(reopened.book).toMatchObject({
      id: old.id,
      name: parameters.name,
      templateId: old.templateId,
      startPeriod: 202501,
    });
    const resetRows = await core(reopened.token).accounts.list();
    expect(resetRows).toHaveLength(app.templates.get(old.templateId).accounts.length);
    expect(resetRows.some((row) => row.code === '1999')).toBe(false);
    expect(await core(copiedLogin.token).accounts.list()).toEqual(original);
  } finally {
    await app.lifecycle.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
