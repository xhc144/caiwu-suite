import type { StatutoryPrintJob } from '../shared';

/** 制度渲染器返回完整文档；打印驱动接收分开的受检正文与样式。 */
export function statutoryPrintJob(title: string, document: string): StatutoryPrintJob {
  const css = [...document.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join('\n');
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(document)?.[1] ?? document;
  const html = body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  return { title, html, css, pageSize: 'A4', marginMm: 12 };
}
