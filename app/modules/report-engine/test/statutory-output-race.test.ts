import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createTestApp } from '@caiwu/testkit';
import reportServer from '../server';
import { statutoryRegistry } from '../server/statutory-registry';
import {
  statutoryIdentity,
  statutoryTestTemplate,
  statutoryTestConfiguration,
  seedStatutoryBook,
} from './statutory-fixture';

it('w_bb_saveas 双客户端配置及快照竞态均拒绝旧页面静默输出新结果', async () => {
  const mod = { ...reportServer, templates: [statutoryTestTemplate] };
  const app = await createTestApp({
    modules: [mod],
    templateId: statutoryTestTemplate.id,
    startYear: 2023,
    seed: false,
  });
  try {
    await seedStatutoryBook(app.svc);
    const a = app.call(mod, await app.login()).statutory;
    const b = app.call(mod, await app.login()).statutory;
    const configuration = await statutoryTestConfiguration(app.svc);
    const p1 = await a.save({
      ...statutoryIdentity,
      code: '201',
      name: '双客户端报表',
      configuration,
    });
    const first = await a.generate({
      id: p1.id,
      expectedRevision: p1.revision,
      period: 202512,
      requestId: randomUUID(),
    });
    if (first.kind !== 'generated') throw new Error('意外确认');
    const displayed = {
      id: p1.id,
      expectedRevision: p1.revision,
      snapshotId: first.snapshot.id,
      period: 202512,
    };
    const p2 = await b.save({
      ...statutoryIdentity,
      id: p1.id,
      expectedRevision: p1.revision,
      code: p1.code,
      name: p1.name,
      configuration: {
        ...configuration,
        adoption: { ...configuration.adoption, version: 'B窗口新版本' },
      },
    });
    const second = await b.generate({
      id: p2.id,
      expectedRevision: p2.revision,
      period: 202512,
      requestId: randomUUID(),
    });
    if (second.kind !== 'generated') throw new Error('意外确认');
    expect(second.snapshot.id).not.toBe(first.snapshot.id);
    const workbook = vi.spyOn(statutoryRegistry[0]!, 'workbook');
    const print = vi.spyOn(statutoryRegistry[0]!, 'print');
    for (const format of ['xlsx', 'print'] as const)
      await expect(a.output({ ...displayed, format })).rejects.toThrow('刷新');
    expect(workbook).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    const refreshed = await a.snapshot({ id: p1.id, period: 202512 });
    expect(refreshed?.id).toBe(second.snapshot.id);
    const selection = {
      ...displayed,
      expectedRevision: p2.revision,
      snapshotId: second.snapshot.id,
    };
    for (const format of ['xlsx', 'print'] as const) {
      const output = await a.output({ ...selection, format });
      expect(output).toMatchObject({
        snapshotId: second.snapshot.id,
        revision: p2.revision,
        period: 202512,
      });
    }
    // 即使配置版本相同，另一窗口重算后的新快照也不能替换旧页面所选快照。
    const third = await b.generate({
      id: p2.id,
      expectedRevision: p2.revision,
      period: 202512,
      requestId: randomUUID(),
    });
    if (third.kind !== 'generated') throw new Error('意外确认');
    for (const format of ['xlsx', 'print'] as const)
      await expect(a.output({ ...selection, format })).rejects.toThrow('生成结果已更新');
    const fresh = await a.output({ ...selection, snapshotId: third.snapshot.id, format: 'xlsx' });
    expect(fresh.snapshotId).toBe(third.snapshot.id);
    await expect(a.output({ ...selection, snapshotId: 999999, format: 'print' })).rejects.toThrow(
      '刷新',
    );
  } finally {
    vi.restoreAllMocks();
    await app.close();
  }
});
