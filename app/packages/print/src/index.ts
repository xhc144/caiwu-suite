/**
 * 打印：输入一段 HTML（由各模块按自己的格式生成），输出到打印机或 PDF。
 * 这里是最简实现：浏览器里用隐藏 iframe 调 window.print()；在桌面版里走 Electron（可选打印机、存 PDF）。
 * 凭证套打、账簿承前页/过次页、打印格式设置等由打印模块完善。
 */

export type PageSize = 'A4' | 'A5' | 'B5' | { widthMm: number; heightMm: number };

export interface PrintJob {
  title: string;
  /** 页面主体 HTML（不含 <html>）。分页用 <div class="cw-page-break"></div>。 */
  html: string;
  pageSize?: PageSize;
  orientation?: 'portrait' | 'landscape';
  /** 页边距（毫米），默认 10 */
  marginMm?: number;
  /** 额外 CSS */
  css?: string;
}

/** 桌面版（Electron preload）暴露的接口；浏览器里不存在。 */
export interface DesktopBridge {
  print(html: string, opts: { title: string; silent?: boolean }): Promise<void>;
  printToPdf(html: string, opts: { title: string; landscape?: boolean }): Promise<string | null>;
}

declare global {
  interface Window {
    caiwuDesktop?: DesktopBridge;
  }
}

export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pageSizeCss(size: PageSize = 'A4', orientation: 'portrait' | 'landscape' = 'portrait') {
  return typeof size === 'string'
    ? `${size} ${orientation}`
    : `${size.widthMm}mm ${size.heightMm}mm`;
}

/** 生成完整的可打印 HTML 文档（带 @page 设置和基础样式）。 */
export function renderPrintDocument(job: PrintJob): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(job.title)}</title>
<style>
@page { size: ${pageSizeCss(job.pageSize, job.orientation)}; margin: ${job.marginMm ?? 10}mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "SimSun", "宋体", "Songti SC", serif; font-size: 12px; color: #000; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #000; padding: 2px 4px; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cw-page-break { page-break-after: always; break-after: page; }
${job.css ?? ''}
</style></head><body>${job.html}</body></html>`;
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.caiwuDesktop;
}

/** 打印。桌面版弹系统打印对话框；浏览器用隐藏 iframe。 */
export async function printHtml(job: PrintJob): Promise<void> {
  const doc = renderPrintDocument(job);
  if (window.caiwuDesktop) return window.caiwuDesktop.print(doc, { title: job.title });
  await new Promise<void>((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    iframe.srcdoc = doc;
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        iframe.remove();
        resolve();
      }, 500);
    };
    document.body.appendChild(iframe);
  });
}

/** 存为 PDF（仅桌面版），返回保存路径；用户取消返回 null。浏览器里退化为打印（可选"另存为 PDF"）。 */
export async function saveAsPdf(job: PrintJob): Promise<string | null> {
  const doc = renderPrintDocument(job);
  if (window.caiwuDesktop)
    return window.caiwuDesktop.printToPdf(doc, {
      title: job.title,
      landscape: job.orientation === 'landscape',
    });
  await printHtml(job);
  return null;
}
