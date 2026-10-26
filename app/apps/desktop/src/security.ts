/** 桌面权限只授予当前本地主窗口的顶层 frame。纯函数供适配层和测试共用。 */
export function isLocalUrl(raw: string, origin: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === origin && url.protocol === 'http:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function safeExternalUrl(raw: string): string | null {
  try {
    if (raw.length > 4096 || Array.from(raw).some((c) => c.charCodeAt(0) <= 32)) return null;
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** 保留现有 Excel 等 Blob 导出，仅本地服务 URL 或该 origin 的 Blob 可以进入保存对话框。 */
export function isLocalDownload(raw: string, origin: string): boolean {
  if (isLocalUrl(raw, origin)) return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'blob:' && isLocalUrl(url.pathname, origin);
  } catch {
    return false;
  }
}

export function assertSender(
  event: { sender: unknown; senderFrame: unknown },
  owner: { webContents: unknown; mainFrame: unknown; url: string } | null,
  frameUrl: string,
  origin: string,
): void {
  if (
    !owner ||
    event.sender !== owner.webContents ||
    event.senderFrame !== owner.mainFrame ||
    !isLocalUrl(frameUrl, origin) ||
    !isLocalUrl(owner.url, origin)
  ) {
    throw new Error('此页面无权使用桌面功能，请返回财务软件主窗口');
  }
}

function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('桌面参数不合法');
  return raw as Record<string, unknown>;
}

export function textInput(raw: unknown, max: number, label: string): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max || raw.includes('\0')) {
    throw new Error(`${label}为空、过长或含有不支持的字符，请检查后重试`);
  }
  return raw;
}

export function printInput(html: unknown, raw: unknown, flag: 'silent' | 'landscape') {
  const opts = object(raw);
  if (Object.keys(opts).some((key) => key !== 'title' && key !== flag)) {
    throw new Error('打印参数不合法');
  }
  const title = textInput(opts.title, 120, '打印标题');
  if (/[\r\n]/u.test(title) || (opts[flag] !== undefined && typeof opts[flag] !== 'boolean')) {
    throw new Error('打印参数不合法');
  }
  return { html: textInput(html, 2_000_000, '打印内容'), title, enabled: opts[flag] === true };
}

export function fileName(raw: unknown): string {
  const name = textInput(raw, 120, '文件名').trim();
  if (
    /[<>:"/\\|?*]/u.test(name) ||
    Array.from(name).some((c) => c.charCodeAt(0) < 32) ||
    /[. ]$/u.test(name) ||
    name === '..'
  ) {
    throw new Error('文件名含有不支持的字符，请只填写文件名，不要填写路径');
  }
  return name;
}

export function pdfName(title: string): string {
  return `${
    Array.from(title)
      .map((c) => (/[<>:"/\\|?*]/u.test(c) || c.charCodeAt(0) < 32 ? '_' : c))
      .join('')
      .replace(/[. ]+$/u, '') || '打印'
  }.pdf`;
}

export const PRINT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function printDocument(html: string): string {
  // 策略位于用户 HTML 之前；后续 meta 只能增加限制，不能解除此策略。
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">${html}`;
}

export function printWasCancelled(reason: string): boolean {
  return /^(cancelled|canceled|print job cancel(?:led|ed))\.?$/iu.test(reason.trim());
}

export function desktopMessage(error: unknown, fallback: string): string {
  return error instanceof Error &&
    (/^[\u4e00-\u9fff]/u.test(error.message) || error.message.startsWith('PDF 未保存成功，'))
    ? error.message
    : fallback;
}
