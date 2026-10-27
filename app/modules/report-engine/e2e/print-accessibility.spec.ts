import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { balanceFormula, emptyTemplate, type Report } from '../shared';
import { test } from './fixture';

test('w_bb_saveas 导出后loading退场图标保留时，AX名称稳定且真实点击仍提交原生打印', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 1250, dims: { cashflow: 'CF01' } },
        { account: '6001', credit: 1250 },
      ],
    },
  ]);
  const template = emptyTemplate({ code: '191', name: '合成打印可访问名称', rows: 2, cols: 2 });
  template.cells = [
    {
      address: 'A1',
      kind: 'formula',
      unit: 'cents',
      currency: 'CNY',
      source: balanceFormula({
        account: '1001',
        metric: 'closing',
        unit: 'cents',
        currency: 'CNY',
        direction: 'signed',
        dimension: 'none',
        item: '',
      }),
    },
  ];
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await callApi(
    isolated.request,
    'm.report-engine.generate',
    { id: report.id, expectedRevision: 1, period: 202601, requestId: randomUUID() },
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202601`);
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '1250',
  );
  const print = page.getByRole('button', { name: '打印', exact: true });
  const probe = await print.evaluateHandle((button) => {
    const state = {
      animations: [] as Animation[],
      icon: null as HTMLElement | null,
      events: [] as {
        phase: string;
        trusted: boolean;
        text: string;
        heading: string;
        pageCss: string;
      }[],
    };
    // 只在合成回归中暂停真实退场transition，保留原trace所见的零尺寸loading DOM。
    // 不改动画配置、可见性、定位器、按钮事件或打印实现；finally恢复动画。
    const leaving = new MutationObserver(() => {
      const icon = button.querySelector<HTMLElement>('.ant-btn-loading-icon-motion-leave-active');
      if (!icon || state.icon) return;
      const animations = icon.getAnimations();
      if (!animations.length) return;
      state.icon = icon;
      state.animations = animations;
      for (const animation of animations) {
        animation.pause();
        const duration = animation.effect?.getComputedTiming().duration;
        if (typeof duration === 'number' && Number.isFinite(duration))
          animation.currentTime = Math.max(0, duration - 0.1);
      }
      leaving.disconnect();
    });
    leaving.observe(button, { attributes: true, childList: true, subtree: true });
    const frames = new MutationObserver((mutations) => {
      for (const mutation of mutations)
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLIFrameElement)) continue;
          node.addEventListener(
            'load',
            () => {
              for (const phase of ['beforeprint', 'afterprint'])
                node.contentWindow!.addEventListener(
                  phase,
                  (event) => {
                    const doc = node.contentDocument!;
                    state.events.push({
                      phase,
                      trusted: event.isTrusted,
                      text: doc.body.textContent!,
                      heading: doc.querySelector('h1')!.textContent!,
                      pageCss: Array.from(doc.styleSheets)
                        .flatMap((sheet) => Array.from(sheet.cssRules))
                        .filter((rule) => rule.type === CSSRule.PAGE_RULE)
                        .map((rule) => rule.cssText)
                        .join('\n'),
                    });
                  },
                  { once: true },
                );
            },
            { once: true, capture: true },
          );
        }
    });
    frames.observe(document.body, { childList: true });
    return {
      state,
      button,
      release() {
        leaving.disconnect();
        frames.disconnect();
        for (const animation of state.animations) animation.play();
      },
    };
  });
  let releaseResponse!: () => void;
  let received!: () => void;
  const responseHeld = new Promise<void>((resolve) => (releaseResponse = resolve));
  const responseRead = new Promise<void>((resolve) => (received = resolve));
  let first = true;
  await page.route(/\/trpc\/.*m\.report-engine\.exportResult/, async (route) => {
    const response = await route.fetch();
    if (first) {
      first = false;
      received();
      await responseHeld;
    }
    await route.fulfill({ response });
  });
  const cdp = await page.context().newCDPSession(page);
  const outputNames = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    return nodes
      .filter((node) => node.role?.value === 'button')
      .map((node) => String(node.name?.value ?? ''))
      .filter((name) => /打印|导出 Excel/.test(name));
  };
  try {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
    await responseRead;
    await expect(
      page.getByRole('button', { name: /打印/ }).locator('[role="img"][aria-label="loading"]'),
    ).toBeAttached();
    const busyNames = await outputNames();
    await expect(page.getByRole('button', { name: /打印/ })).toHaveAttribute('aria-busy', 'true');
    releaseResponse();
    const file = await (await download).path();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file!);
    expect(wb.worksheets[0]!.getCell('A1').value).toBe(12.5);
    await expect.poll(() => probe.evaluate((p) => p.state.animations.length)).toBeGreaterThan(0);
    const dom = await probe.evaluate((p) => ({
      disabled: p.button.hasAttribute('disabled'),
      loading: p.button.classList.contains('ant-btn-loading'),
      busy: p.button.getAttribute('aria-busy'),
      iconClass: p.state.icon!.className,
      connected: p.state.icon!.isConnected,
      width: p.state.icon!.style.width,
      opacity: p.state.icon!.style.opacity,
      computedWidth: getComputedStyle(p.state.icon!).width,
      computedOpacity: getComputedStyle(p.state.icon!).opacity,
      imageLabel: p.state.icon!.querySelector('[role="img"]')!.getAttribute('aria-label'),
      paused: p.state.animations.every((a) => a.playState === 'paused'),
    }));
    const leavingNames = await outputNames();
    console.log(JSON.stringify({ busyNames, leavingNames, dom }));
    expect(dom).toMatchObject({
      disabled: false,
      loading: false,
      busy: 'false',
      connected: true,
      width: '0px',
      opacity: '0',
      imageLabel: 'loading',
      paused: true,
    });
    expect(dom.iconClass).toContain('motion-leave-active');
    expect(leavingNames).toContain('打印');
    expect(busyNames).toContain('打印');
    expect(busyNames).toContain('导出 Excel');
    await print.click();
    await expect
      .poll(() => probe.evaluate((p) => p.state.events.map((e) => e.phase)))
      .toEqual(['beforeprint', 'afterprint']);
    const events = await probe.evaluate((p) => p.state.events);
    expect(events.every((e) => e.trusted)).toBe(true);
    expect(events[0]!.heading).toBe('合成打印可访问名称');
    expect(events[0]!.text).toContain('12.50');
    expect(events[0]!.pageCss).toContain('@page');
    await expect(page.locator('iframe')).toHaveCount(0);
  } finally {
    releaseResponse();
    await probe.evaluate((p) => p.release());
    await probe.dispose();
    await cdp.detach();
  }
});
