import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import backupServer from '../server';
import { waitForJobs } from '../server/service';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(backupServer, token);
let api: ReturnType<typeof caller>;
beforeEach(async () => {
  app = await createTestApp({ modules: [backupServer] });
  api = caller(app);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await waitForJobs(app.runtime);
  await app.close();
});
async function seed(amount: number) {
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: amount },
        { account: '6603', credit: amount },
      ],
    },
  ]);
}
async function create(name: string) {
  const row = await api.create({ requestId: randomUUID(), name });
  await waitForJobs(app.runtime);
  return (await api.list()).find((r) => r.id === row.id)!;
}
function fileOf(row: { id: string; directory: string }) {
  return path.join(
    app.runtime.dataDir,
    'backups',
    app.book.id,
    row.directory,
    `${row.id}.caiwubak`,
  );
}
function amounts() {
  return app.runtime.bookStore
    .open(app.book.id)
    .raw.prepare('SELECT debit_total FROM voucher ORDER BY id')
    .all();
}
async function restore(plan: { id: string; confirmation: string }) {
  await api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' });
  api = caller(app, await app.login());
}

it.each(['missing-manual', 'missing-protection', 'corrupt', 'incompatible'] as const)(
  'w_hf：历史包%s阻止准备；独立校验标失效后重新预览可恢复，旧文件不被删除',
  async (fault) => {
    await seed(12345);
    const source = await create('本次完好来源');
    let historical;
    if (fault === 'missing-protection') {
      const oldPlan = await api.preview({ id: source.id, purpose: 'overwrite' });
      const protection = await api.prepareOverwrite({ planId: oldPlan.id });
      await api.cancelPlan({ id: oldPlan.id });
      historical = (await api.list()).find((r) => r.id === protection.protectionId)!;
    } else historical = await create('待检查历史包');
    const file = fileOf(historical);
    if (fault.startsWith('missing-')) await rm(file);
    else if (fault === 'corrupt') await writeFile(file, '合成损坏旧包');
    else {
      const original = await readFile(file);
      const length = original.readUInt32BE(8);
      const metadata = JSON.parse(original.subarray(12, 12 + length).toString()) as {
        appVersion: string;
      };
      metadata.appVersion = '999.0.0';
      const json = Buffer.from(JSON.stringify(metadata));
      const header = Buffer.from(original.subarray(0, 12));
      header.writeUInt32BE(json.length, 8);
      const changed = Buffer.concat([header, json, original.subarray(12 + length)]);
      await writeFile(file, changed);
      app.runtime.bookStore
        .open(app.book.id)
        .raw.prepare('UPDATE backup_item SET digest=? WHERE id=?')
        .run(createHash('sha256').update(changed).digest('hex'), historical.id);
    }
    const damagedBytes = fault.startsWith('missing-') ? null : await readFile(file);
    await seed(67890);
    const plan = await api.preview({ id: source.id, purpose: 'overwrite' });
    const stage = vi.spyOn(app.runtime.bookStore, 'prepareReplacement');
    await expect(api.prepareOverwrite({ planId: plan.id })).rejects.toMatchObject({
      cause: { data: { code: 'BACKUP_HISTORY', hint: expect.stringContaining('点击「校验」') } },
    });
    expect(stage).not.toHaveBeenCalled();
    expect((await api.list()).find((r) => r.id === historical.id)?.status).toBe('valid');
    const protection = (await api.list()).find(
      (r) => r.kind === 'pre-restore' && r.id !== historical.id,
    )!;
    expect(await api.verify({ id: protection.id })).toMatchObject({ type: 'pre-restore' });
    expect(amounts()).toEqual([{ debit_total: 12345 }, { debit_total: 67890 }]);
    await expect(api.verify({ id: historical.id })).rejects.toThrow();
    expect((await api.list()).find((r) => r.id === historical.id)).toMatchObject({
      status: 'invalid',
      reason: expect.any(String),
    });
    await api.cancelPlan({ id: plan.id });
    const next = await api.preview({ id: source.id, purpose: 'overwrite' });
    const prepared = await api.prepareOverwrite({ planId: next.id });
    expect(prepared.available).toBe(true);
    await restore(next);
    expect(amounts()).toEqual([{ debit_total: 12345 }]);
    const retained = await api.list();
    expect(retained.find((r) => r.id === source.id)?.status).toBe('valid');
    expect(retained.find((r) => r.id === prepared.protectionId)?.status).toBe('valid');
    if (damagedBytes) expect(await readFile(file)).toEqual(damagedBytes);
  },
);

it('w_hf：本次保护创建失败仍阻止恢复，不能以历史保护代替；重新准备成功后才恢复', async () => {
  await seed(12345);
  const source = await create('来源');
  const previous = await api.preview({ id: source.id, purpose: 'overwrite' });
  const oldProtection = await api.prepareOverwrite({ planId: previous.id });
  await api.cancelPlan({ id: previous.id });
  await seed(67890);
  const plan = await api.preview({ id: source.id, purpose: 'overwrite' });
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  const snapshot = vi
    .spyOn(raw, 'backup')
    .mockRejectedValueOnce(new Error('合成：当前保护快照写入失败'));
  const stage = vi.spyOn(app.runtime.bookStore, 'prepareReplacement');
  await expect(api.prepareOverwrite({ planId: plan.id })).rejects.toThrow('恢复前保护备份失败');
  expect(stage).not.toHaveBeenCalled();
  await expect(
    api.restore({ planId: plan.id, text: plan.confirmation, password: 'admin' }),
  ).rejects.toThrow('尚未完成恢复前保护备份');
  expect((await api.list()).find((r) => r.id === oldProtection.protectionId)?.status).toBe('valid');
  expect((await api.list()).some((r) => r.kind === 'pre-restore' && r.status === 'failed')).toBe(
    true,
  );
  expect(amounts()).toHaveLength(2);
  snapshot.mockRestore();
  await api.cancelPlan({ id: plan.id });
  const next = await api.preview({ id: source.id, purpose: 'overwrite' });
  await api.prepareOverwrite({ planId: next.id });
  await restore(next);
  expect(amounts()).toEqual([{ debit_total: 12345 }]);
  expect(await api.verify({ id: oldProtection.protectionId })).toMatchObject({
    type: 'pre-restore',
  });
});

it('w_hf：有效历史普通包和保护包在覆盖后保留原字节与目录，可继续下载和恢复', async () => {
  await seed(12345);
  const source = await create('来源');
  const manual = await create('历史普通包');
  const previous = await api.preview({ id: source.id, purpose: 'overwrite' });
  const oldProtection = await api.prepareOverwrite({ planId: previous.id });
  await api.cancelPlan({ id: previous.id });
  const history = (await api.list()).filter((r) =>
    [manual.id, oldProtection.protectionId].includes(r.id),
  );
  const before = await Promise.all(
    history.map(async (r) => ({ row: r, bytes: await readFile(fileOf(r)) })),
  );
  await seed(67890);
  const plan = await api.preview({ id: source.id, purpose: 'overwrite' });
  await api.prepareOverwrite({ planId: plan.id });
  await restore(plan);
  expect(amounts()).toEqual([{ debit_total: 12345 }]);
  const retained = await api.list();
  for (const { row, bytes } of before) {
    expect(retained.find((r) => r.id === row.id)).toMatchObject({
      owner_id: app.book.id,
      directory: row.directory,
      status: 'valid',
      digest: row.digest,
    });
    expect(await readFile(fileOf(row))).toEqual(bytes);
    const downloaded = await api.download({ id: row.id });
    expect(Buffer.from(downloaded.base64, 'base64')).toEqual(bytes);
    const copy = await api.preview({ id: row.id, purpose: 'copy' });
    await restore(copy);
    expect(
      app.runtime.bookStore
        .open(copy.target_id)
        .raw.prepare('SELECT debit_total FROM voucher')
        .all(),
    ).toEqual([{ debit_total: 12345 }]);
  }
});
