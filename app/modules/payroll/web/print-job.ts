import { printHtml, renderPrintDocument, type PrintJob } from '@caiwu/print';

/** 工资资料允许自然换行；按浏览器真实排版检查页框，禁止遮住后续页或截断数字。 */
export function assertPayrollPrintFits(document: Document) {
  const fail = () => {
    throw new Error('工资打印内容超出纸张或栏目，请减少每页记录数、调整列宽或字号后重新预览');
  };
  for (const sheet of document.querySelectorAll<HTMLElement>('.payroll-sheet')) {
    const bounds = sheet.getBoundingClientRect();
    for (const element of sheet.querySelectorAll<HTMLElement>(
      'header, table, footer, .payroll-slip',
    )) {
      const rect = element.getBoundingClientRect();
      if (
        rect.left < bounds.left - 1 ||
        rect.right > bounds.right + 1 ||
        rect.bottom > bounds.bottom + 1
      )
        fail();
    }
    for (const cell of sheet.querySelectorAll<HTMLElement>('th,td,footer'))
      if (cell.scrollWidth > cell.clientWidth + 1) fail();
  }
}
async function preflightPayroll(job: PrintJob) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;border:0';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('工资打印排版检查超时，请重新预览')), 10000);
      frame.onerror = () => reject(new Error('工资打印预览加载失败，请重试'));
      frame.onload = () => {
        void (async () => {
          try {
            const doc = frame.contentDocument;
            if (!doc) throw new Error('无法读取工资打印预览，请重试');
            await doc.fonts?.ready;
            assertPayrollPrintFits(doc);
            resolve();
          } catch (error) {
            reject(error);
          }
        })();
      };
      frame.srcdoc = renderPrintDocument(job);
      document.body.appendChild(frame);
    });
  } finally {
    clearTimeout(timer);
    frame.remove();
  }
}
export async function printPayrollJob(job: PrintJob) {
  await preflightPayroll(job);
  return printHtml(job);
}
