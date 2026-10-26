export type PageSize = 'A4' | 'A5' | 'B5' | { widthMm: number; heightMm: number };
export interface PrintJob {
  title: string;
  html: string;
  pageSize?: PageSize;
  orientation?: 'portrait' | 'landscape';
  marginMm?: number;
  css?: string;
}
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
function pageSizeCss(size: PageSize = 'A4', orientation = 'portrait') {
  if (typeof size === 'string') {
    if (!['A4', 'A5', 'B5'].includes(size)) throw new Error('纸张类型无效');
    return `${size} ${orientation === 'landscape' ? 'landscape' : 'portrait'}`;
  }
  if (![size.widthMm, size.heightMm].every((v) => Number.isFinite(v) && v >= 40 && v <= 600))
    throw new Error('纸张尺寸必须为 40 至 600 毫米');
  return orientation === 'landscape'
    ? `${size.heightMm}mm ${size.widthMm}mm`
    : `${size.widthMm}mm ${size.heightMm}mm`;
}
/** HTML 仅用于受信任的模块渲染器；拒绝脚本、事件、网络资源及可执行样式。 */
export function assertSafePrintContent(html: string, css = ''): void {
  const tags = new Set(
    'article section div span p h1 h2 h3 h4 header footer table thead tbody tfoot tr th td colgroup col br hr b strong i em small caption'.split(
      ' ',
    ),
  );
  const unsafeCss =
    /(?:url\s*\(|@import|expression\s*\(|javascript\s*:|image-set\s*\(|-moz-binding|<|\\)/i;
  if (unsafeCss.test(css)) throw new Error('打印样式含不允许的链接或表达式');
  for (const token of html.matchAll(/<([^>]+)>/g)) {
    const tag = /^\/?\s*([a-z][a-z0-9]*)\b/i.exec(token[1]!);
    if (!tag || !tags.has(tag[1]!.toLowerCase())) throw new Error('打印内容含不允许的标签');
    const rest = token[1]!.slice(tag[0].length).replace(/\/$/, '');
    const attr = /\s+([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    let consumed = '';
    for (const a of rest.matchAll(attr)) {
      consumed += a[0];
      const key = a[1]!.toLowerCase();
      if (
        !['class', 'style', 'colspan', 'rowspan', 'id', 'scope'].includes(key) &&
        !key.startsWith('data-')
      )
        throw new Error('打印内容含不允许的属性');
      if (
        key === 'style' &&
        (unsafeCss.test(a[2] ?? a[3] ?? a[4] ?? '') || /&/.test(a[2] ?? a[3] ?? a[4] ?? ''))
      )
        throw new Error('打印样式含不允许的链接或表达式');
    }
    if (consumed.trim() !== rest.trim()) throw new Error('打印标签属性格式无效');
  }
}
export function renderPrintDocument(job: PrintJob): string {
  if (!job.html.trim()) throw new Error('无记录，无法预览/打印');
  assertSafePrintContent(job.html, job.css);
  const margin = job.marginMm ?? 10;
  if (!Number.isFinite(margin) || margin < 0 || margin > 100) throw new Error('页边距无效');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'"><title>${escapeHtml(job.title)}</title><style>
@page { size:${pageSizeCss(job.pageSize, job.orientation)}; margin:${margin}mm; }
html,body{margin:0;padding:0} body{font-family:serif;font-size:12px;color:#000}
table{border-collapse:collapse;width:100%;table-layout:fixed} th,td{border:1px solid;padding:2px 4px;overflow-wrap:anywhere} .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.cw-page-break{break-after:page}.cw-page-break:last-child{break-after:auto}
${job.css ?? ''}</style></head><body>${job.html}</body></html>`;
}
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.caiwuDesktop;
}
let active = false;
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (active) throw new Error('已有打印任务正在进行，请等待完成');
  active = true;
  try {
    return await fn();
  } finally {
    active = false;
  }
}
async function browserPrint(doc: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin allow-modals');
    iframe.setAttribute('aria-label', '系统打印');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      iframe.remove();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('打印对话框超时，请重试')), 60_000);
    iframe.onerror = () => finish(new Error('打印视图加载失败，请重新预览'));
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) return finish(new Error('无法打开打印视图'));
      win.addEventListener('afterprint', () => finish(), { once: true });
      void (async () => {
        try {
          await win.document.fonts?.ready;
          win.focus();
          win.print();
          // afterprint 在完成或取消后清理；没有事件的浏览器由超时兜底。
        } catch (e) {
          finish(new Error(`打印失败：${e instanceof Error ? e.message : String(e)}`));
        }
      })();
    };
    iframe.srcdoc = doc;
    document.body.appendChild(iframe);
  });
}
export async function printHtml(job: PrintJob): Promise<void> {
  return exclusive(async () => {
    const doc = renderPrintDocument(job);
    if (window.caiwuDesktop) return window.caiwuDesktop.print(doc, { title: job.title });
    await browserPrint(doc);
  });
}
export async function saveAsPdf(job: PrintJob): Promise<string | null> {
  return exclusive(async () => {
    const doc = renderPrintDocument(job);
    if (window.caiwuDesktop)
      return window.caiwuDesktop.printToPdf(doc, {
        title: job.title,
        landscape: job.orientation === 'landscape',
      });
    await browserPrint(doc);
    return null;
  });
}
