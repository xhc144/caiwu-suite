import type { PrintView } from './models';
import { viewToPrintJob } from './models';
import { printHtml, type PrintJob } from './driver';
import { runManualDuplex, type DuplexResume, type DuplexResult } from './manual-duplex';

export type PrintBatchOptions = {
  pages: number[];
  copies: number;
  pause: 'none' | 'page' | 'voucher' | 'account';
  duplex?: boolean;
  confirm: (message: string) => Promise<boolean>;
  send?: (job: PrintJob) => Promise<void>;
  signal?: AbortSignal;
  resume?: DuplexResume;
};
/** 成功提交后才推进；取消停止后续，不重试已提交部分。物理打印结果由系统对话框决定。 */
export async function runPrintBatch(
  view: PrintView,
  options: PrintBatchOptions,
): Promise<DuplexResult> {
  const { pages, copies, confirm, signal } = options;
  if (!Number.isInteger(copies) || copies < 1 || copies > 99)
    throw new Error('份数必须为 1 至 99 的整数');
  viewToPrintJob(view, pages);
  if (options.pause === 'voucher' && pages.some((p) => view.pages[p - 1]!.entityIds.length !== 1))
    throw new Error('每张暂停需要每页一张凭证，请先调整版式');
  if (options.pause === 'account' && pages.some((p) => !view.pages[p - 1]!.account))
    throw new Error('逐科目提示需要账册科目分组，请重新查询账册');
  if (pages.length * copies > 100000) throw new Error('打印总页数过多，请减少份数后分批打印');
  const sent: number[] = [];
  const send = options.send ?? printHtml;
  if (options.duplex) {
    if (options.pause === 'page' || options.pause === 'voucher')
      throw new Error('手动双面按科目分正反两轮走纸，请关闭每页或每张暂停');
    return runManualDuplex(view, { ...options, send });
  }
  if (options.resume) throw new Error('恢复点只适用于原手动双面作业');
  // 连续模式将所有份数放在同一次系统作业内；取消对话框就不会启动下一份作业。
  if (options.pause === 'none' && !options.duplex) {
    if (signal?.aborted) return { sent, cancelled: true };
    const job = viewToPrintJob(view, pages);
    await send({ ...job, html: job.html.repeat(copies) });
    return { sent: Array.from({ length: copies }, () => pages).flat(), cancelled: false };
  }
  const passes = [pages];
  for (let copy = 0; copy < copies; copy++)
    for (let pass = 0; pass < passes.length; pass++) {
      const selected = passes[pass]!;
      if (!selected.length) continue;
      if (signal?.aborted) return { sent, cancelled: true };
      const groups: number[][] = options.pause === 'none' ? [selected] : [];
      if (options.pause !== 'none')
        for (const p of selected) {
          const last = groups.at(-1);
          if (
            last &&
            ((options.pause === 'voucher' &&
              view.pages[last[0]! - 1]!.entityIds[0] === view.pages[p - 1]!.entityIds[0]) ||
              (options.pause === 'account' &&
                view.pages[last[0]! - 1]!.account === view.pages[p - 1]!.account))
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
