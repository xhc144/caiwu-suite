import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import type * as PrintDriver from '@caiwu/print';

// 只在 Playwright 路由中编译实际 driver，不增加产品入口，也不替换原生 window.print。
async function serveDriver(page: Page) {
  const sources = new Map(
    await Promise.all(
      ['driver', 'preflight'].map(
        async (name) =>
          [
            name,
            transpileModule(
              await readFile(
                new URL(`../../../packages/print/src/${name}.ts`, import.meta.url),
                'utf8',
              ),
              { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ESNext } },
            ).outputText,
          ] as const,
      ),
    ),
  );
  await page.route('**/__print-driver-test__/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    await route.fulfill({
      contentType: name ? 'text/javascript' : 'text/html',
      body: name ? sources.get(name)! : '<!doctype html><html><body></body></html>',
    });
  });
  await page.goto('/__print-driver-test__/');
}

// 普通消费者的 W0 HTML 契约：宽表与毫米标签均没有 M19 的 print-sheet 预分页结构。
const cases: {
  name: string;
  job: PrintDriver.PrintJob;
  text: string;
  pages: number;
  size: number[];
}[] = [
  {
    name: '分析宽表',
    job: {
      title: '账龄分析',
      orientation: 'landscape',
      html: '<h1>账龄分析</h1><p>截止 2026-04-15</p><table><thead><tr><th>辅助项</th><th>同截止余额</th></tr></thead><tbody><tr><td>C001 合成客户</td><td>500.00</td></tr></tbody></table>',
    },
    text: '500.00',
    pages: 1,
    size: [297, 210],
  },
  {
    name: '资产毫米标签',
    job: {
      title: '资产标签',
      pageSize: { widthMm: 88, heightMm: 51 },
      marginMm: 4,
      css: 'section h2{font-size:12px;margin:0 0 2mm}section p{font-size:9px;line-height:1.25;margin:1mm 0;overflow-wrap:anywhere}',
      html: '<section class="cw-page-break"><h2>固定资产标签</h2><p>编号：1</p><p>名称：合成设备一</p></section><section ><h2>固定资产标签</h2><p>编号：2</p><p>名称：合成设备二</p></section>',
    },
    text: '合成设备一',
    pages: 2,
    size: [88, 51],
  },
];
for (const c of cases) {
  test(`w_print_root ${c.name}：原生打印事件、完成清理、再次输出与实际 PDF`, async ({
    page,
    context,
  }) => {
    await serveDriver(page);
    let html = '';
    for (const pdf of [false, true]) {
      const result = await page.evaluate(
        async ({ job, pdf }) => {
          const events: { phase: string; text: string; html: string }[] = [];
          let checks = 0;
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations)
              for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLIFrameElement)) continue;
                if (node.classList.contains('cw-print-check')) checks++;
                if (node.getAttribute('aria-label') !== '系统打印') continue;
                // 捕获阶段先于 driver 的 onload，记录瞬时打印内容而不延长 iframe 生命周期。
                node.addEventListener(
                  'load',
                  () => {
                    for (const phase of ['beforeprint', 'afterprint'])
                      node.contentWindow!.addEventListener(phase, () => {
                        events.push({
                          phase,
                          text: node.contentDocument!.body.textContent!,
                          html: node.srcdoc,
                        });
                      });
                  },
                  { capture: true, once: true },
                );
              }
          });
          observer.observe(document.body, { childList: true });
          try {
            const path = '/__print-driver-test__/driver';
            const driver = (await import(path)) as typeof PrintDriver;
            const value = pdf ? await driver.saveAsPdf(job) : await driver.printHtml(job);
            return { events, checks, value, frames: document.querySelectorAll('iframe').length };
          } finally {
            observer.disconnect();
          }
        },
        { job: c.job, pdf },
      );
      expect(result.events.map((event) => event.phase)).toEqual(['beforeprint', 'afterprint']);
      for (const event of result.events) expect(event.text).toContain(c.text);
      expect(result.checks).toBe(0);
      expect(result.frames).toBe(0);
      expect(result.value).toBe(pdf ? null : undefined);
      html = result.events[0]!.html;
    }
    const output = await context.newPage();
    try {
      await output.setContent(html, { waitUntil: 'load' });
      await output.emulateMedia({ media: 'print' });
      await output.evaluate(() => document.fonts.ready);
      const pdf = await output.pdf({ preferCSSPageSize: true, printBackground: true });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1')).toContain('%%EOF');
      const pages = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)];
      expect(pages).toHaveLength(c.pages);
      const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g)];
      expect(boxes).toHaveLength(c.pages);
      for (const box of boxes)
        for (const [i, mm] of c.size.entries())
          expect(Math.abs(Number(box[i + 1]) - (mm * 72) / 25.4)).toBeLessThan(1);
    } finally {
      await output.close();
    }
  });
}
