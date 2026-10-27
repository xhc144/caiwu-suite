import { expect } from '@playwright/test';
import { callApi } from '@caiwu/testkit/e2e';
import type { StatutoryProfile } from '../shared';
import { statutoryIdentity } from '../test/statutory-fixture';
import { test } from './fixture';

test('w_frame 法定配置真实关闭守卫：取消、成功保存及校验失败保留', async ({ page, isolated }) => {
  const { bookId, configuration } = await isolated.prepareStatutoryBook();
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    isolated.request,
    'core.auth.login',
    { bookId, userCode: 'admin', password: 'admin' },
    { method: 'POST' },
  );
  await page.addInitScript(
    (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
    { token: login.token, bookId, user: login.user, book: login.book },
  );
  const p = await callApi<StatutoryProfile>(
    isolated.request,
    'm.report-engine.statutory.save',
    { ...statutoryIdentity, code: '201', name: '守卫合成报表', configuration },
    { token: login.token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/statutory?id=${p.id}`);
  const source = () => page.getByRole('textbox', { name: '依据来源', exact: true }).first();
  await source().fill('壳守卫保存的真实来源编辑');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await expect(dialog).toContainText('法定报表：守卫合成报表');
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(source()).toHaveValue('壳守卫保存的真实来源编辑');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '有未保存内容' });
  await dialog.getByRole('button', { name: '保存并继续' }).click();
  await expect(page).toHaveURL(/\/home$/);
  const saved = await callApi<StatutoryProfile>(
    isolated.request,
    'm.report-engine.statutory.get',
    { id: p.id },
    { token: login.token, method: 'GET' },
  );
  expect(saved.revision).toBe(2);
  expect((saved.configuration as typeof configuration).adoption.source).toBe(
    '壳守卫保存的真实来源编辑',
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/statutory?id=${p.id}`);
  await source().fill('');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有未保存内容' })
    .getByRole('button', { name: '保存并继续' })
    .click();
  await expect(page).toHaveURL(/\/statutory\?id=/);
  await expect(source()).toHaveValue('');
  await expect(page.getByText(/配置尚未完整或格式无效/)).toBeVisible();
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有未保存内容' })
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await expect(source()).toHaveValue('');
  await page.getByRole('button', { name: '关闭所有', exact: true }).click();
  await page
    .getByRole('dialog', { name: '有未保存内容' })
    .getByRole('button', { name: '放弃修改并继续' })
    .click();
  await expect(page).toHaveURL(/\/home$/);
});
