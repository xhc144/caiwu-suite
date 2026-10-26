import { expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  defaultLayout,
  planManualDuplex,
  runPrintBatch,
  manualDuplexPdfJob,
  type PrintView,
  type PrintJob,
} from './index';

function book(a: number, b: number, start = 1): PrintView {
  return {
    title: '合成账册',
    layout: { ...defaultLayout, continuousPage: false, startPage: start },
    pages: [a, b].flatMap((count, group) =>
      Array.from({ length: count }, (_, i) => ({
        html: `<p>${group ? 'B' : 'A'}${i + 1}</p>`,
        labels: [`${group ? 'B' : 'A'}${i + 1}`],
        account: group ? 'B' : 'A',
        pageNumber: start + i,
        entityIds: [],
      })),
    ),
  };
}
const all = (view: PrintView) => view.pages.map((_, i) => i + 1);

it('w_preview_zc 连续编号换科目仍独立走纸，偶码科目起点保留空白正面', () => {
  const view = book(3, 2);
  view.layout.continuousPage = true;
  view.pages.forEach((page, i) => {
    page.pageNumber = i + 1;
  });
  expect(planManualDuplex(view, all(view)).map((s) => s.slots)).toEqual([
    [1, 3],
    [2, null],
    [null, 5],
    [4, null],
  ]);
});

it.each([
  [3, 2, 1, [[1, 3], [2, null], [4], [5]]],
  [1, 2, 1, [[1], [null], [2], [3]]],
  [
    3,
    2,
    2,
    [
      [null, 2],
      [1, 3],
      [null, 5],
      [4, null],
    ],
  ],
  [3, 2, 5, [[1, 3], [2, null], [4], [5]]],
] as const)(
  'w_preview_zc A%s+B%s 起点%s：科目正反槽数量相同且不串背面',
  (a, b, start, expected) => {
    const view = book(a, b, start);
    const steps = planManualDuplex(view, all(view));
    expect(steps.map((s) => s.slots)).toEqual(expected);
    expect(steps.map((s) => `${s.account}:${s.side}`)).toEqual([
      'A:front',
      'A:back',
      'B:front',
      'B:back',
    ]);
  },
);

it('w_preview_zc 取消背面后显式恢复，仅发送未提交部分；不同查询/版式拒绝旧恢复点', async () => {
  const view = book(3, 2),
    send = vi.fn(async () => {});
  const first = await runPrintBatch(view, {
    pages: all(view),
    copies: 1,
    pause: 'none',
    duplex: true,
    send,
    confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
  });
  expect(first.sent).toEqual([1, 3]);
  expect(first.cancelled).toBe(true);
  expect(first.resume?.nextStep).toBe(1);
  expect(send).toHaveBeenCalledTimes(1);
  const resumed = await runPrintBatch(view, {
    pages: all(view),
    copies: 1,
    pause: 'none',
    duplex: true,
    resume: first.resume,
    send,
    confirm: async () => true,
  });
  expect(resumed).toEqual({ sent: [2, 4, 5], cancelled: false, blankPages: 1 });
  expect(send).toHaveBeenCalledTimes(4);
  await expect(
    runPrintBatch(
      { ...view, layout: { ...view.layout, offsetX: 1 } },
      {
        pages: all(view),
        copies: 1,
        pause: 'none',
        duplex: true,
        resume: first.resume,
        send,
        confirm: async () => true,
      },
    ),
  ).rejects.toThrow('恢复点');
  expect(send).toHaveBeenCalledTimes(4);
});

it('w_preview_zc 确认期间取消信号不提交，投递异常不自动重投', async () => {
  const view = book(1, 2),
    controller = new AbortController(),
    send = vi.fn(async () => {});
  const result = await runPrintBatch(view, {
    pages: all(view),
    copies: 1,
    pause: 'account',
    duplex: true,
    send,
    signal: controller.signal,
    confirm: async () => {
      controller.abort();
      return true;
    },
  });
  expect(result.resume?.nextStep).toBe(0);
  expect(result.sent).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  await expect(
    runPrintBatch(view, {
      pages: all(view),
      copies: 1,
      pause: 'page',
      duplex: true,
      send,
      confirm: async () => true,
    }),
  ).rejects.toThrow('关闭每页或每张暂停');
  expect(send).not.toHaveBeenCalled();
  const fail = vi.fn().mockRejectedValue(new Error('投递结果不确定'));
  await expect(
    runPrintBatch(view, {
      pages: all(view),
      copies: 1,
      pause: 'none',
      duplex: true,
      send: fail,
      confirm: async () => true,
    }),
  ).rejects.toThrow('投递结果不确定');
  expect(fail).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'w_preview_zc 恢复中间投递异常（接收端已接收=%s）保留成功边界并标记不确定步骤',
  async (acceptedBeforeFailure) => {
    const view = book(3, 2),
      accepted: string[] = [];
    const first = await runPrintBatch(view, {
      pages: all(view),
      copies: 1,
      pause: 'none',
      duplex: true,
      send: async (job) => {
        accepted.push(job.html);
      },
      confirm: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });
    expect(first.resume?.nextStep).toBe(1);
    const cause = new Error('投递连接中断');
    const send = vi.fn(async (job: PrintJob) => {
      if (send.mock.calls.length === 3) {
        if (acceptedBeforeFailure) accepted.push(job.html);
        throw cause;
      }
      accepted.push(job.html);
    });
    const error = await runPrintBatch(view, {
      pages: all(view),
      copies: 1,
      pause: 'none',
      duplex: true,
      resume: first.resume,
      send,
      confirm: async () => true,
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({
      name: 'DuplexDeliveryError',
      cause,
      completed: planManualDuplex(view, all(view)).slice(0, 3),
      uncertain: { account: 'B', copy: 1, side: 'back', slots: [5] },
    });
    expect(error).not.toHaveProperty('resume');
    expect((error as Error).message).toContain('已作废恢复点');
    expect((error as Error).message).toContain('系统打印队列与实际纸叠');
    expect(send).toHaveBeenCalledTimes(3);
    expect(accepted).toHaveLength(acceptedBeforeFailure ? 4 : 3);
  },
);

it('w_preview_zc 发送成功期间取消：仅在成功返回后推进恢复点，下一次不重投', async () => {
  const view = book(3, 2),
    controller = new AbortController(),
    send = vi.fn(async () => {
      controller.abort();
    });
  const first = await runPrintBatch(view, {
    pages: all(view),
    copies: 1,
    pause: 'none',
    duplex: true,
    signal: controller.signal,
    send,
    confirm: async () => true,
  });
  expect(first.sent).toEqual([1, 3]);
  expect(first.resume?.nextStep).toBe(1);
  const resumed = await runPrintBatch(view, {
    pages: all(view),
    copies: 1,
    pause: 'none',
    duplex: true,
    resume: first.resume,
    send,
    confirm: async () => true,
  });
  expect(resumed).toEqual({ sent: [2, 4, 5], cancelled: false, blankPages: 1 });
  expect(send).toHaveBeenCalledTimes(4);
});

it('w_preview_zc 选页缺口也保留对应纸槽；PDF 交错顺序保留空白背页', () => {
  const view = book(3, 2);
  expect(planManualDuplex(view, [2, 3, 5]).map((s) => s.slots)).toEqual([
    [null, 3],
    [2, null],
    [null],
    [5],
  ]);
  const html = manualDuplexPdfJob(view, all(view)).html;
  expect([...html.matchAll(/data-duplex-source="([^"]+)"/g)].map((m) => m[1])).toEqual([
    '1',
    '2',
    '3',
    'blank',
    '4',
    '5',
  ]);
  expect(() => planManualDuplex(view, [3, 1])).toThrow('原页序');
});

it('w_preview_zc 随机页数/起点/份数：每个纸槽正反配对，账页各一次且科目隔离', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 8 }),
      fc.integer({ min: 1, max: 8 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 3 }),
      (a, b, start, copies) => {
        const view = book(a, b, start),
          steps = planManualDuplex(view, all(view), copies);
        expect(steps).toHaveLength(copies * 4);
        for (let i = 0; i < steps.length; i += 2) {
          const front = steps[i]!,
            back = steps[i + 1]!;
          expect(front.account).toBe(back.account);
          expect(front.slots).toHaveLength(back.slots.length);
          for (let j = 0; j < front.slots.length; j++) {
            const f = front.slots[j],
              r = back.slots[j];
            if (f != null) expect(view.pages[f - 1]!.pageNumber! % 2).toBe(1);
            if (r != null) expect(view.pages[r - 1]!.pageNumber! % 2).toBe(0);
            if (f != null && r != null)
              expect(view.pages[r - 1]!.pageNumber).toBe(view.pages[f - 1]!.pageNumber! + 1);
          }
        }
        const sent = steps.flatMap((s) => s.slots.filter((p) => p != null));
        for (const p of all(view)) expect(sent.filter((x) => x === p)).toHaveLength(copies);
      },
    ),
    { numRuns: 80 },
  );
});
