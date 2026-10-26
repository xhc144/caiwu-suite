/** 检查实际字体排版。单独的估宽不能保证另一台机器的后备字体也能放下。 */
export function assertRenderedPrintFits(doc: Document): void {
  const fail = (reason: string) => {
    throw new Error(
      `打印内容超出纸张或凭证槽位，请调整纸张、每页张数、列宽或字体后重新预览（${reason}）`,
    );
  };
  for (const sheet of doc.querySelectorAll<HTMLElement>('.print-sheet')) {
    const bounds = sheet.getBoundingClientRect();
    for (const element of sheet.querySelectorAll<HTMLElement>(
      '.scaled, table, footer, .single-line',
    )) {
      const rect = element.getBoundingClientRect();
      if (
        rect.left < bounds.left - 1 ||
        rect.right > bounds.right + 1 ||
        rect.bottom > bounds.bottom + 1
      )
        fail('页框越界');
    }
    for (const slot of sheet.querySelectorAll<HTMLElement>('.voucher')) {
      if (
        slot.firstElementChild!.getBoundingClientRect().bottom >
        slot.getBoundingClientRect().bottom + 1
      )
        fail('凭证内容超出槽高');
    }
    for (const cell of sheet.querySelectorAll<HTMLElement>('th,td,.single-line,footer')) {
      if (cell.scrollWidth > cell.clientWidth + 1) fail('文字列过窄');
    }
    // 一条预分行文本再次折成两行，就不能继续使用预先分配的行高。
    for (const cell of sheet.querySelectorAll<HTMLElement>('tbody td')) {
      if (!cell.textContent) continue;
      const range = doc.createRange();
      range.selectNodeContents(cell);
      const tops: number[] = [];
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && !tops.some((y) => Math.abs(y - rect.top) < 1)) tops.push(rect.top);
      }
      if (tops.length > 1) fail('预分行文字再次折行');
    }
  }
}

/** 同一浏览器、同一 HTML 检查后才交给现有 bridge；不改变 bridge 参数。 */
export async function preflightPrintDocument(html: string): Promise<void> {
  if (!html.includes('class="print-sheet"')) return;
  const iframe = document.createElement('iframe');
  iframe.className = 'cw-print-check';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;border:0';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('打印排版检查超时，请重新预览')), 10_000);
      iframe.onerror = () => reject(new Error('打印排版检查加载失败，请重新预览'));
      iframe.onload = () => {
        void (async () => {
          try {
            const doc = iframe.contentDocument;
            if (!doc) throw new Error('无法读取打印排版，请重新预览');
            await doc.fonts?.ready;
            assertRenderedPrintFits(doc);
            resolve();
          } catch (error) {
            reject(error);
          }
        })();
      };
      iframe.srcdoc = html;
      document.body.appendChild(iframe);
    });
  } finally {
    clearTimeout(timer);
    iframe.remove();
  }
}
