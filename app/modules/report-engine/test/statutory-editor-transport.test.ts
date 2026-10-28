import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import reportServer from '../server';
import type { StatutoryProfile } from '../shared';
import type { EnterpriseConfig, SourceData } from '../templates/enterprise/model';
import {
  seedStatutoryBook,
  statutoryIdentity,
  statutoryTestConfiguration,
  statutoryTestTemplate,
} from './statutory-fixture';

const mod = { ...reportServer, templates: [statutoryTestTemplate] };
let app: TestApp;
let saved: StatutoryProfile;
const admin = () => app.call(mod).statutory;

beforeEach(async () => {
  app = await createTestApp({
    modules: [mod],
    templateId: statutoryTestTemplate.id,
    startYear: 2023,
    seed: false,
  });
  await seedStatutoryBook(app.svc);
  saved = await admin().save({
    ...statutoryIdentity,
    code: '201',
    name: '合成企业资产负债表',
    configuration: await statutoryTestConfiguration(app.svc),
  });
});
afterEach(async () => {
  await app.close();
});

async function input() {
  const configuration = await statutoryTestConfiguration(app.svc);
  configuration.adoption.source = '';
  configuration.eps[0]!.preference = '-';
  configuration.cashPolicies[0]!.source = '未保存的完整来源说明'.repeat(600);
  return {
    ...statutoryIdentity,
    id: saved.id,
    period: 202512,
    scope: 'annual' as const,
    options: { enterpriseDraft: { configuration, sourcePeriod: 202512 } },
  };
}

type EditorResponse = {
  result?: { data: { configuration: EnterpriseConfig; source: SourceData } };
  error?: { message: string; data: { code: string } };
};
async function editorPost(token: string, body: Awaited<ReturnType<typeof input>>) {
  const response = await fetchRequestHandler({
    endpoint: '/trpc',
    req: new Request('http://127.0.0.1/trpc/m.report-engine.statutory.editorDraft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    router: app.router,
    createContext: () => ({ app: app.runtime, token }),
  });
  return { status: response.status, body: (await response.json()) as EditorResponse };
}

describe('w_bb_def 法定报表大草稿只读 POST', () => {
  it('只有查看权限可通过请求体读取超过4000字符的完整暂存草稿和真实来源，原配置及版本不变', async () => {
    const token = await app.addUser('draft-viewer', { permissions: ['report-engine.view'] });
    const viewer = app.call(mod, token).statutory;
    const before = await viewer.list();
    const request = await input();
    expect(JSON.stringify(request).length).toBeGreaterThan(4000);

    const response = await editorPost(token, request);

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    const result = response.body.result!.data;
    expect(result.configuration).toEqual(request.options.enterpriseDraft.configuration);
    expect(result.configuration.adoption.source).toBe('');
    expect(result.configuration.eps[0]?.preference).toBe('-');
    expect(result.source.bookId).toBe(app.book.id);
    expect(result.source.accounts).toEqual(await app.svc.accounts.list());
    expect(result.source.periods).toContain(202512);
    const cash = await app.svc.accounts.require('1001');
    expect(result.source.balances[202512]).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: cash.id, closing: 100000 })]),
    );
    expect(await viewer.get({ id: saved.id })).toEqual(saved);
    expect(await viewer.list()).toEqual(before);
  });

  it('缺少查看权限时 POST 被拒绝，不能借只读 mutation 读取配置或来源', async () => {
    const token = await app.addUser('no-draft-view');
    const before = await admin().list();
    const response = await editorPost(token, await input());
    expect(response.status).toBe(403);
    expect(response.body.error?.data.code).toBe('FORBIDDEN');
    expect(response.body.result).toBeUndefined();
    expect(await admin().get({ id: saved.id })).toEqual(saved);
    expect(await admin().list()).toEqual(before);
  });

  it('读回暂存草稿不授予编辑权限，也不能绕过管理员保存时的严格金额和来源校验', async () => {
    const token = await app.addUser('readonly-draft', { permissions: ['report-engine.view'] });
    const viewer = app.call(mod, token).statutory;
    const response = await editorPost(token, await input());
    expect(response.status).toBe(200);
    const save = {
      ...statutoryIdentity,
      id: saved.id,
      expectedRevision: saved.revision,
      code: saved.code,
      name: saved.name,
      configuration: response.body.result!.data.configuration,
    };

    await expect(viewer.save(save)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(admin().save(save)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await admin().get({ id: saved.id })).toEqual(saved);
    expect(await admin().list()).toEqual([saved]);
  });
});
