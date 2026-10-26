import { expect, it } from 'vitest';
import { createTestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, errorData, rule, snapshot, zeroOpening } from './helpers';
it('权限：只读操作员直调每个mutation及组合流程均拒绝且数据库不变', async () => {
  const app = await createTestApp({ modules: [periodCloseServer] });
  try {
    await zeroOpening(app);
    const data = await rule(app);
    await call(app).saveRule({ data });
    const api = call(app, await app.addUser('viewer', { permissions: ['period-close.view'] }));
    const before = snapshot(app);
    const actions = [
      () => api.backupReverseYear({ year: 2026 }),
      () =>
        api.reverseYear({
          year: 2026,
          backupId: 'missing',
          confirmed: true,
          confirmText: '撤销2026年年结',
        }),
      () => api.saveRule({ data }),
      () => api.removeRule({ id: 1 }),
      () => api.post({ from: 202601, to: 202601 }),
      () => api.unpost({ from: 202601, to: 202601, confirmed: true }),
      () => api.generate({ period: 202601, ruleIds: [1], confirmed: true, previewToken: 'token' }),
      () => api.deleteGenerated({ period: 202601, ruleId: 1, confirmed: true }),
      () => api.close({ period: 202601, confirmed: true }),
      () => api.closeRange({ from: 202601, to: 202603, confirmed: true, previewToken: 'token' }),
      () => api.reopen({ from: 202601, to: 202601, confirmed: true }),
      () =>
        api.renumber({
          period: 202601,
          confirmed: true,
          confirmText: '影响已打印凭证和账册，编号不可直接恢复',
          previewToken: 'token',
        }),
      () => api.yearEnd({ year: 2026, confirmed: true }),
      () => api.workflow({ period: 202601, ruleIds: [1], confirmed: true }),
    ];
    for (const action of actions) {
      expect((await errorData(action())).code).toBe('FORBIDDEN');
      expect(snapshot(app)).toBe(before);
    }
    expect((await api.check({ period: 202601 })).items).toHaveLength(10);
  } finally {
    await app.close();
  }
});
it('取消：反过账、结账、反结账、年结及组合流程不改变任何行', async () => {
  const app = await createTestApp({ modules: [periodCloseServer] });
  try {
    await zeroOpening(app);
    const api = call(app);
    const before = snapshot(app);
    for (const action of [
      () => api.unpost({ from: 202601, to: 202601, confirmed: false }),
      () => api.close({ period: 202601, confirmed: false }),
      () => api.closeRange({ from: 202601, to: 202603, confirmed: false, previewToken: 'token' }),
      () => api.reopen({ from: 202601, to: 202601, confirmed: false }),
      () => api.yearEnd({ year: 2026, confirmed: false }),
      () => api.workflow({ period: 202601, ruleIds: [], confirmed: false }),
    ]) {
      await expect(action()).rejects.toThrow();
      expect(snapshot(app)).toBe(before);
    }
  } finally {
    await app.close();
  }
});
