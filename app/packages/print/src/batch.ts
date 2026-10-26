import type { PrintView } from './models';
import { viewToPrintJob } from './models';
import { printHtml, type PrintJob } from './driver';

export type PrintBatchOptions = {
  pages: number[];
  copies: number;
  pause: 'none' | 'page' | 'voucher';
  duplex?: boolean;
  confirm: (message: string) => Promise<boolean>;
  send?: (job: PrintJob) => Promise<void>;
  signal?: AbortSignal;
};
/** 成功提交后才推进；取消停止后续，不重试已提交部分。物理打印结果由系统对话框决定。 */
export async function runPrintBatch(view: PrintView, options: PrintBatchOptions) {
  const { pages, copies, confirm, signal } = options;
  if (!Number.isInteger(copies) || copies < 1 || copies > 99)
    throw new Error('份数必须为 1 至 99 的整数');
  viewToPrintJob(view, pages);
  if (options.pause === 'voucher' && pages.some((p) => view.pages[p - 1]!.entityIds.length !== 1))
    throw new Error('每张暂停需要每页一张凭证，请先调整版式');
  const sent: number[] = [];
  const send = options.send ?? printHtml;
  // 连续模式将所有份数放在同一次系统作业内；取消对话框就不会启动下一份作业。
  if (options.pause === 'none' && !options.duplex) {
    if (signal?.aborted) return { sent, cancelled: true };
    if (pages.length * copies > 100000) throw new Error('打印总页数过多，请减少份数后分批打印');
    const job = viewToPrintJob(view, pages);
    await send({ ...job, html: job.html.repeat(copies) });
    return { sent: Array.from({ length: copies }, () => pages).flat(), cancelled: false };
  }
  const passes = options.duplex
    ? [
        pages.filter((p) => (view.layout.startPage + p - 1) % 2 === 1),
        pages.filter((p) => (view.layout.startPage + p - 1) % 2 === 0),
      ]
    : [pages];
  for (let copy = 0; copy < copies; copy++)
    for (let pass = 0; pass < passes.length; pass++) {
      const selected = passes[pass]!;
      if (!selected.length) continue;
      if (signal?.aborted) return { sent, cancelled: true };
      if (
        options.duplex &&
        !(await confirm(
          `${pass === 0 ? '现在打印奇页账册' : '请翻面，现在打印偶页账册'}（第 ${copy + 1} 份）。系统打印机的双面能力需自行设置，是否继续？`,
        ))
      )
        return { sent, cancelled: true };
      const groups: number[][] = options.pause === 'none' ? [selected] : [];
      if (options.pause !== 'none')
        for (const p of selected) {
          const last = groups.at(-1);
          if (
            options.pause === 'voucher' &&
            last &&
            view.pages[last[0]! - 1]!.entityIds[0] === view.pages[p - 1]!.entityIds[0]
          )
            last.push(p);
          else groups.push([p]);
        }
      for (const group of groups) {
        if (signal?.aborted) return { sent, cancelled: true };
        if (
          options.pause !== 'none' &&
          !(await confirm(
            `下面打印：${group.flatMap((p) => view.pages[p - 1]!.labels).join('；')}（第 ${copy + 1} 份）`,
          ))
        )
          return { sent, cancelled: true };
        if (signal?.aborted) return { sent, cancelled: true };
        await send(viewToPrintJob(view, group));
        sent.push(...group);
      }
    }
  return { sent, cancelled: false };
}
