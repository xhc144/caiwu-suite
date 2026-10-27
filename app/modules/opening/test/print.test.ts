import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { renderPrintDocument } from '@caiwu/print';
import openingServer from '../server';
import { PrintSchema, selectOpeningRows } from '../shared';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [openingServer], startMonth: 7 });
});
afterEach(async () => await app.close());
const api = () => app.call(openingServer);
async function seed() {
  const data = await api().list({ year: 2026 });
  const id = (code: string) => data.accounts.find((a) => a.code === code)!.id;
  const project = data.items.find((i) => i.typeId === 'project' && i.code === 'XM01')!.id;
  await api().save({
    year: 2026,
    changes: [
      { data: { year: 2026, accountId: id('1001'), balance: 10001, ytdDebit: -1 } },
      { data: { year: 2026, accountId: id('4001'), balance: -10001, ytdCredit: -1 } },
      {
        data: {
          year: 2026,
          accountId: id('100202'),
          currency: 'USD',
          balance: 711,
          fcBalance: 101,
        },
      },
      { data: { year: 2026, accountId: id('1403'), balance: 123, quantity: '1.234567' } },
      { data: { year: 2026, accountId: id('5001'), balance: 1, dimensions: { project } } },
    ],
  });
  return { id, project };
}

it('w_xt_ye/m_work_xt_01：打印真实已保存末级明细，保留一分、红字累计、外币和六位数量，不重加父级', async () => {
  await seed();
  const before = await api().list({ year: 2026 });
  const logs = await app.svc.log.list();
  const job = await api().print({ year: 2026 });
  expect(job).toMatchObject({ pageSize: 'A4', orientation: 'landscape' });
  expect(job.html.match(/data-opening-id=/g)).toHaveLength(5);
  expect(job.html).toContain('100202 银行存款/美元户');
  expect(job.html).toContain('1.234567 千克');
  expect(job.html).toContain('项目：XM01');
  expect(job.html).toContain('100.02');
  expect(job.html).toContain('-100.02');
  expect(job.html).toContain('-0.01');
  expect(job.html).toContain('1.01');
  expect(job.html).toContain('不混加');
  expect(job.html).toContain('本位币合计');
  expect(job.html).not.toContain('<td>1002 银行存款</td>');
  expect(job.html).toContain('<td class="num">8.35</td>');
  const doc = renderPrintDocument(job);
  expect(doc).toContain('A4 landscape');
  expect(doc).toContain("default-src 'none'");
  expect(await api().list({ year: 2026 })).toEqual(before);
  expect(await app.svc.log.list()).toEqual(logs);
});

it('w_xt_ye：打印按币种、数量、科目编码/名称/拼音交集筛选；无明细拒绝空白打印', async () => {
  await seed();
  const data = await api().list({ year: 2026 });
  for (const [input, count] of [
    [{ currency: 'USD' }, 1],
    [{ currency: 'base' }, 4],
    [{ quantity: true }, 1],
    [{ currency: 'USD', quantity: true }, 0],
    [{ account: '银行存款' }, 1],
    [{ account: 'kc' }, 1],
    [{ account: '1002' }, 1],
  ] as const) {
    const scope = PrintSchema.parse({ year: 2026, ...input });
    expect(selectOpeningRows(data.accounts, data.rows, scope)).toHaveLength(count);
    if (!count) await expect(api().print(scope)).rejects.toThrow('没有已保存');
    else expect((await api().print(scope)).html.match(/data-opening-id=/g)).toHaveLength(count);
  }
});

it('w_xt_xmnc/w_xt_xm_sc：按真实项目档案打印，与类型不符/不存在的档案拒绝；文本转义后安全渲染', async () => {
  const { id, project } = await seed();
  const special = await app.svc.dimensions.create({
    type: 'project',
    code: 'X02',
    name: '<img src=x onerror=alert(1)> & "项目"',
  });
  await api().save({
    year: 2026,
    changes: [
      {
        data: {
          year: 2026,
          accountId: id('5001'),
          balance: 2,
          dimensions: { project: special.id },
        },
      },
    ],
  });
  const first = await api().print({ year: 2026, dimension: 'project', item: String(project) });
  expect(first.html.match(/data-opening-id=/g)).toHaveLength(1);
  expect(first.html).not.toContain('X02');
  const second = await api().print({ year: 2026, dimension: 'project', item: String(special.id) });
  expect(second.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;项目&quot;');
  expect(second.html).not.toContain('<img');
  expect(() => renderPrintDocument(second)).not.toThrow();
  for (const dimension of ['partner', 'department', 'person', ''] as const)
    await expect(api().print({ year: 2026, dimension, item: String(project) })).rejects.toThrow(
      '不匹配',
    );
  await expect(api().print({ year: 2026, dimension: 'project', item: '999999' })).rejects.toThrow(
    '不匹配',
  );
});

it('w_xt_ye_nf/w_xt_ye：打印遵守年度和查看权限；锁定后的已保存数据仍可只读打印', async () => {
  await expect(api().print({ year: 2026 })).rejects.toThrow('没有已保存');
  await expect(api().print({ year: 2025 })).rejects.toThrow('早于开账');
  await expect(api().print({ year: 2027 })).rejects.toThrow('尚未建立');
  const data = await api().list({ year: 2026 });
  await api().save({
    year: 2026,
    changes: [
      {
        data: {
          year: 2026,
          accountId: data.accounts.find((a) => a.code === '1001')!.id,
          balance: 0,
        },
      },
    ],
  });
  await api().setLock({ year: 2026, locked: true });
  const viewer = app.call(
    openingServer,
    await app.addUser('print-view', { permissions: ['opening.view'] }),
  );
  expect((await viewer.print({ year: 2026 })).html).toContain('0.00');
  const denied = app.call(openingServer, await app.addUser('no-view'));
  await expect(denied.print({ year: 2026 })).rejects.toThrow('权限');
  expect((await api().list({ year: 2026 })).locked).toBe(true);
});
