import { afterEach, describe, expect, it, vi } from 'vitest';
import { printHtml, saveAsPdf, isDesktop, renderPrintDocument } from './index';
const job = { title: '凭证', html: '<p>123.45</p>', orientation: 'landscape' as const };
afterEach(() => {
  delete window.caiwuDesktop;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});
describe('W0 桥接与浏览器生命周期', () => {
  it('w_print_root 原签名 print(html,{title}) 兼容', async () => {
    const print = vi.fn(async () => {});
    window.caiwuDesktop = { print, printToPdf: async () => null };
    expect(isDesktop()).toBe(true);
    await printHtml(job);
    expect(print).toHaveBeenCalledExactlyOnceWith(renderPrintDocument(job), { title: '凭证' });
  });
  it('w_preview PDF 取消返回 null，不伪造路径；桥接失败可重试', async () => {
    const printToPdf = vi
      .fn()
      .mockRejectedValueOnce(new Error('保存失败'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('C:/凭证.pdf');
    window.caiwuDesktop = { print: async () => {}, printToPdf };
    await expect(saveAsPdf(job)).rejects.toThrow('保存失败');
    expect(await saveAsPdf(job)).toBeNull();
    expect(await saveAsPdf(job)).toBe('C:/凭证.pdf');
    expect(printToPdf.mock.calls[0]![1]).toEqual({ title: '凭证', landscape: true });
  });
  it('w_pz_prn_2 重复点击不启动重叠作业', async () => {
    let finish!: () => void;
    const print = vi.fn(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    window.caiwuDesktop = { print, printToPdf: async () => null };
    const pending = printHtml(job);
    await expect(printHtml(job)).rejects.toThrow('已有打印任务');
    expect(print).toHaveBeenCalledTimes(1);
    finish();
    await pending;
  });
  it('w_preview 完成或取消 afterprint 后清理 iframe；没有桥接的 PDF 返回 null', async () => {
    const pending = saveAsPdf(job);
    const iframe = document.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-modals');
    const win = iframe.contentWindow!;
    vi.spyOn(win, 'focus').mockImplementation(() => {});
    vi.spyOn(win, 'print').mockImplementation(() => win.dispatchEvent(new Event('afterprint')));
    iframe.dispatchEvent(new Event('load'));
    expect(await pending).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('w_print_root iframe 加载失败清理且报告原因', async () => {
    const pending = printHtml(job);
    const failed = expect(pending).rejects.toThrow('加载失败');
    document.querySelector('iframe')!.dispatchEvent(new Event('error'));
    await failed;
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('w_print_root iframe 超时不永久挂起并清理', async () => {
    vi.useFakeTimers();
    const pending = printHtml(job);
    const failed = expect(pending).rejects.toThrow('超时');
    document.querySelector('iframe')!.onload = null;
    await vi.advanceTimersByTimeAsync(60000);
    await failed;
    expect(document.querySelector('iframe')).toBeNull();
  });
});
it('w_pz_prn_1 实际排版越界时不调用 W0 bridge，并清理检查 iframe', async () => {
  const print = vi.fn(async () => {});
  window.caiwuDesktop = { print, printToPdf: async () => null };
  const pending = printHtml({
    title: '越界',
    html: '<article class="print-sheet"><div class="scaled">宽字</div></article>',
  });
  const rejected = expect(pending).rejects.toThrow('打印内容超出纸张');
  const iframe = document.querySelector<HTMLIFrameElement>('.cw-print-check')!;
  iframe.contentDocument!.body.innerHTML =
    '<article class="print-sheet"><div class="scaled">宽字</div></article>';
  vi.spyOn(
    iframe.contentDocument!.querySelector('.print-sheet')!,
    'getBoundingClientRect',
  ).mockReturnValue({ left: 0, right: 100, bottom: 100 } as DOMRect);
  vi.spyOn(
    iframe.contentDocument!.querySelector('.scaled')!,
    'getBoundingClientRect',
  ).mockReturnValue({ left: 0, right: 200, bottom: 200 } as DOMRect);
  iframe.dispatchEvent(new Event('load'));
  await rejected;
  expect(print).not.toHaveBeenCalled();
  expect(document.querySelector('.cw-print-check')).toBeNull();
});
it('w_print_root 排版检查超时清理并释放作业锁', async () => {
  vi.useFakeTimers();
  const print = vi.fn(async () => {});
  window.caiwuDesktop = { print, printToPdf: async () => null };
  const pending = printHtml({
    title: '检查超时',
    html: '<article class="print-sheet">内容</article>',
  });
  const rejected = expect(pending).rejects.toThrow('打印排版检查超时');
  document.querySelector<HTMLIFrameElement>('.cw-print-check')!.onload = null;
  await vi.advanceTimersByTimeAsync(10000);
  await rejected;
  expect(document.querySelector('.cw-print-check')).toBeNull();
  expect(print).not.toHaveBeenCalled();
  await printHtml(job);
  expect(print).toHaveBeenCalledTimes(1);
});
