import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { defineManifest } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, voucherInputFromSpec } from '@caiwu/testkit';
import { buildVoucherView, defaultLayout } from '@caiwu/print';
import server from '../server';
import { defaultSettings } from '../shared';

it('w_pz_prn_1 打印来源凭证不解锁、不改状态，现存在线备份不被覆盖', async () => {
  const sourceManifest = defineManifest({
    id: 'print-source-fixture',
    name: '测试来源单据',
    products: 'all',
    permissions: [],
    menu: [],
    sources: [{ type: 'document', name: '测试单据', path: '/document?id={id}' }],
  });
  const source = defineServerModule(sourceManifest, {
    router: moduleKit(sourceManifest).router({}),
  });
  const app = await createTestApp({ modules: [server, source] });
  try {
    const owner = app.svcFor(sourceManifest.id);
    const input = await voucherInputFromSpec(owner, {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: 12345 },
        { account: '6603', credit: 12345 },
      ],
    });
    const voucher = await owner.vouchers.create({
      ...input,
      source: { type: 'document', id: 'synthetic-1' },
    });
    const before = await owner.vouchers.get(voucher.id);
    const opened = app.runtime.bookStore.open(app.book.id);
    const backup = path.join(path.dirname(opened.file), 'synthetic-print-safety.sqlite');
    await opened.raw.backup(backup);
    const savedBackup = readFileSync(backup);
    const api = app.call(server);
    const model = await api.vouchers({ from: 202601, to: 202601, voucherId: voucher.id });
    expect(buildVoucherView(model, defaultLayout).pages[0]!.html).toContain('123.45');
    expect(model.vouchers[0]!.source).toEqual({
      module: sourceManifest.id,
      type: 'document',
      id: 'synthetic-1',
    });
    await api.saveSettings({
      ...defaultSettings,
      voucher: { ...defaultSettings.voucher, offsetX: 2 },
    });
    await expect(app.svcFor('print-settings').vouchers.delete(voucher.id)).rejects.toThrow('生成');
    expect(await owner.vouchers.get(voucher.id)).toEqual(before);
    expect(readFileSync(backup)).toEqual(savedBackup);
  } finally {
    await app.close();
  }
});
