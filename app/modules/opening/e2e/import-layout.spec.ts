import { expect, test } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';

for (const width of [1280, 720]) {
  test(`w_xt_ye：${width}px 导入模式及下拉选项具有可读宽度，重开后仍可切换`, async ({
    page,
    request,
  }, testInfo) => {
    // 指定回归要求覆盖打开后 37 秒；连续测量布局，不用等待来替代断言。
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await loginWithNewBook(page, request);
    await page.goto('/m/opening?year=2026');
    await page.getByRole('button', { name: '导入 Excel', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Excel 导入预览', exact: true });
    const input = modal.getByLabel('导入模式', { exact: true });
    const control = input.locator(
      'xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]',
    );
    await expect(modal).toBeVisible();
    await input.click();
    const popup = page.locator('.ant-select-dropdown:visible');
    await expect(popup).toBeVisible();
    const measures = await control.evaluate((element) => {
      const trigger = element.closest<HTMLElement>('.ant-select')!;
      const dropdown = document.querySelector<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
      )!;
      const measure = (node: HTMLElement) => ({
        client: node.clientWidth,
        offset: node.offsetWidth,
        width: node.getBoundingClientRect().width,
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
      });
      return {
        trigger: measure(trigger),
        popup: measure(dropdown),
        options: [...dropdown.querySelectorAll<HTMLElement>('.ant-select-item-option-content')].map(
          (node) => ({
            text: node.textContent,
            client: node.clientWidth,
            scroll: node.scrollWidth,
          }),
        ),
        viewport: window.innerWidth,
      };
    });
    await testInfo.attach('导入模式实际尺寸', {
      body: JSON.stringify(measures, null, 2),
      contentType: 'application/json',
    });
    console.log(JSON.stringify({ width, ...measures }));
    expect(measures.trigger.client).toBeGreaterThanOrEqual(240);
    expect(measures.trigger.offset).toBeGreaterThanOrEqual(240);
    expect(measures.popup.client).toBeGreaterThanOrEqual(240);
    expect(measures.popup.left).toBeGreaterThanOrEqual(0);
    expect(measures.popup.right).toBeLessThanOrEqual(measures.viewport);
    for (const option of measures.options) expect(option.scroll).toBeLessThanOrEqual(option.client);
    if (width === 1280) {
      const stability = await control.evaluate(async (element) => {
        const trigger = element as HTMLElement;
        const dropdown = document.querySelector<HTMLElement>(
          '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
        )!;
        const started = performance.now();
        const result = {
          samples: 0,
          elapsed: 0,
          minClient: Infinity,
          minOffset: Infinity,
          minPopup: Infinity,
          clipped: 0,
        };
        await new Promise<void>((resolve) => {
          const sample = () => {
            result.samples++;
            result.elapsed = performance.now() - started;
            result.minClient = Math.min(result.minClient, trigger.clientWidth);
            result.minOffset = Math.min(result.minOffset, trigger.offsetWidth);
            result.minPopup = Math.min(result.minPopup, dropdown.clientWidth);
            if (
              [...dropdown.querySelectorAll<HTMLElement>('.ant-select-item-option-content')].some(
                (node) => node.scrollWidth > node.clientWidth,
              )
            )
              result.clipped++;
            if (result.elapsed >= 37_000) resolve();
            else requestAnimationFrame(sample);
          };
          sample();
        });
        return result;
      });
      await testInfo.attach('打开后37秒连续布局测量', {
        body: JSON.stringify(stability),
        contentType: 'application/json',
      });
      console.log(JSON.stringify({ width, stability }));
      expect(stability.elapsed).toBeGreaterThanOrEqual(37_000);
      expect(stability.samples).toBeGreaterThan(1);
      expect(stability.minClient).toBeGreaterThanOrEqual(240);
      expect(stability.minOffset).toBeGreaterThanOrEqual(240);
      expect(stability.minPopup).toBeGreaterThanOrEqual(240);
      expect(stability.clipped).toBe(0);
    }
    await popup
      .locator('.ant-select-item-option-content')
      .filter({ hasText: /^覆盖（明确修改已有键）$/ })
      .click();
    await expect(control).toContainText('覆盖（明确修改已有键）');
    await modal.getByRole('button', { name: '取消导入', exact: true }).click();
    await page.getByRole('button', { name: '导入 Excel', exact: true }).click();
    await modal.getByLabel('导入模式', { exact: true }).click();
    await popup
      .locator('.ant-select-item-option-content')
      .filter({ hasText: /^新增（拒绝已有键）$/ })
      .click();
    await expect(control).toContainText('新增（拒绝已有键）');
  });
}
