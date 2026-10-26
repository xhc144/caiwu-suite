import type { PrintJob } from './driver';
import { viewToPrintJob, type PrintView } from './models';

export type DuplexStep = {
  account: string;
  copy: number;
  side: 'front' | 'back';
  slots: (number | null)[];
};
export type DuplexResume = { key: string; nextStep: number };
export type DuplexResult = {
  sent: number[];
  cancelled: boolean;
  blankPages?: number;
  resume?: DuplexResume;
};

/** 每科目独立完成正反两次走纸。偶码起点补空白正面，末尾奇页补空白背面。 */
export function planManualDuplex(view: PrintView, pages: number[], copies = 1): DuplexStep[] {
  viewToPrintJob(view, pages);
  if (pages.some((p, i) => i > 0 && p < pages[i - 1]!))
    throw new Error('手动双面须按原页序打印，请按从小到大的顺序选择页码');
  if (!Number.isInteger(copies) || copies < 1 || copies > 99)
    throw new Error('份数必须为 1 至 99 的整数');
  const selected = new Set(pages);
  const sections: { account: string; pairs: Map<number, [number | null, number | null]> }[] = [];
  for (const [i, page] of view.pages.entries()) {
    const account = page.account ?? '当前账册';
    let section = sections.at(-1);
    if (!section || section.account !== account) {
      section = { account, pairs: new Map() };
      sections.push(section);
    }
    if (!selected.has(i + 1)) continue;
    const number = page.pageNumber ?? view.layout.startPage + i;
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('账册印刷页码无效');
    const key = Math.floor((number - 1) / 2);
    const pair = section.pairs.get(key) ?? [null, null];
    const side = number % 2 === 1 ? 0 : 1;
    if (pair[side] != null) throw new Error('同一科目印刷页码重复，无法确定双面纸槽');
    pair[side] = i + 1;
    section.pairs.set(key, pair);
  }
  const steps: DuplexStep[] = [];
  for (let copy = 1; copy <= copies; copy++)
    for (const section of sections) {
      const pairs = [...section.pairs.values()];
      if (!pairs.length) continue;
      steps.push(
        { account: section.account, copy, side: 'front', slots: pairs.map((p) => p[0]) },
        { account: section.account, copy, side: 'back', slots: pairs.map((p) => p[1]) },
      );
    }
  if (steps.reduce((n, s) => n + s.slots.length, 0) > 100000)
    throw new Error('含空白纸槽的打印总页数过多，请缩小范围后分批打印');
  return steps;
}

/** 空白槽仍是实际物理页，不能过滤或依赖打印机的“跳过空白页”。 */
export function duplexStepToPrintJob(view: PrintView, step: DuplexStep): PrintJob {
  if (!step.slots.length) throw new Error('双面纸槽不能为空');
  const pages = step.slots.map((p) => {
    if (p !== null && (!Number.isInteger(p) || p < 1 || p > view.pages.length))
      throw new Error('双面纸槽页码无效');
    const source = p == null ? undefined : view.pages[p - 1];
    return {
      html: `<section data-duplex-source="${p ?? 'blank'}" style="min-height:1mm">${source?.html ?? ''}</section>`,
      labels: source?.labels ?? ['空白纸槽'],
      entityIds: source?.entityIds ?? [],
    };
  });
  return viewToPrintJob({ ...view, pages });
}

/** PDF 按每张纸的正面、背面交错排列，可交给支持双面的 PDF 阅读器。 */
export function manualDuplexPdfJob(view: PrintView, pages: number[]): PrintJob {
  const steps = planManualDuplex(view, pages);
  const slots: (number | null)[] = [];
  for (let i = 0; i < steps.length; i += 2) {
    const front = steps[i]!,
      back = steps[i + 1]!;
    for (let j = 0; j < front.slots.length; j++) slots.push(front.slots[j]!, back.slots[j]!);
  }
  return duplexStepToPrintJob(view, { account: '双面账册', copy: 1, side: 'front', slots });
}

export async function runManualDuplex(
  view: PrintView,
  options: {
    pages: number[];
    copies: number;
    confirm: (message: string) => Promise<boolean>;
    send: (job: PrintJob) => Promise<void>;
    signal?: AbortSignal;
    resume?: DuplexResume;
  },
): Promise<DuplexResult> {
  const steps = planManualDuplex(view, options.pages, options.copies);
  // 精确匹配当前内容、版式与纸槽，不把别的查询或版式的恢复点应用到当前纸叠。
  const key = JSON.stringify([view, steps]);
  const start = options.resume?.nextStep ?? 0;
  if (
    options.resume &&
    (options.resume.key !== key || !Number.isInteger(start) || start < 0 || start >= steps.length)
  )
    throw new Error('双面恢复点与当前内容或版式不一致，请重新核对纸叠后新建作业');
  const sent: number[] = [];
  let blankPages = 0;
  const cancel = (nextStep: number): DuplexResult => ({
    sent,
    blankPages,
    cancelled: true,
    resume: { key, nextStep },
  });
  for (let i = start; i < steps.length; i++) {
    const step = steps[i]!;
    if (options.signal?.aborted) return cancel(i);
    const instruction =
      step.side === 'front'
        ? '现在打印奇页账册（正面）。取走上一科目整叠成品，放入新纸。'
        : '请翻面，现在打印偶页账册（背面）。把本轮正面输出的第1张至最后1张，整理成同序逐张进纸，仅翻面、不反序；进纸朝向须按机型校准。';
    if (
      !(await options.confirm(
        `${step.account}，第 ${step.copy} 份：${instruction}本次 ${step.slots.length} 个纸槽，含 ${step.slots.filter((p) => p == null).length} 个空白。系统须选单面、原序、每张1页，关闭反序、自动双面和跳过空白页。空白槽也必须走纸；不确定朝向时先用两张草稿校准。`,
      ))
    )
      return cancel(i);
    if (options.signal?.aborted) return cancel(i);
    // 桥接失败的投递结果不确定，抛错且不自动重投；恢复点只覆盖尚未提交的作业。
    await options.send(duplexStepToPrintJob(view, step));
    sent.push(...step.slots.filter((p): p is number => p != null));
    blankPages += step.slots.filter((p) => p == null).length;
  }
  return { sent, blankPages, cancelled: false };
}
