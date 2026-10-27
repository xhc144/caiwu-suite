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
    // 冻结一个真实入场帧以稳定复现 CI：transform 不触发 ResizeObserver，
    // 旧版将该帧的缩放后 rect.width 缓存为 popup 宽度，动画结束仍不恢复。
    const entryFrame = await modal.evaluate((element) => {
      const animations = element.getAnimations({ subtree: true });
      const entry = animations.find(
        (animation) => animation instanceof CSSAnimation && /zoom/i.test(animation.animationName),
      );
      if (!entry) throw new Error('未捕获真实弹窗入场动画');
      entry.pause();
      entry.currentTime = Number(entry.effect!.getTiming().duration) * 0.05;
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        offset: (element as HTMLElement).offsetWidth,
        transform: getComputedStyle(element).transform,
      };
    });
    await testInfo.attach('入场动画展开时的真实变换', {
      body: JSON.stringify(entryFrame),
      contentType: 'application/json',
    });
    expect(entryFrame.width).toBeLessThan(entryFrame.offset * 0.75);
    await input.click();
    const popup = page.locator('.ant-select-dropdown:visible');
    await expect(popup).toBeVisible();
    await modal.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true })) animation.play();
    });
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
          minLeft: Infinity,
          maxRight: -Infinity,
        };
        await new Promise<void>((resolve) => {
          const sample = () => {
            result.samples++;
            result.elapsed = performance.now() - started;
            result.minClient = Math.min(result.minClient, trigger.clientWidth);
            result.minOffset = Math.min(result.minOffset, trigger.offsetWidth);
            result.minPopup = Math.min(result.minPopup, dropdown.clientWidth);
            const bounds = dropdown.getBoundingClientRect();
            result.minLeft = Math.min(result.minLeft, bounds.left);
            result.maxRight = Math.max(result.maxRight, bounds.right);
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
      expect(stability.minLeft).toBeGreaterThanOrEqual(0);
      expect(stability.maxRight).toBeLessThanOrEqual(width);
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

test('w_xt_ye：720px 冷启动动画中展开，缩窄至360px后选项可读可点', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await loginWithNewBook(page, request);
  await page.goto('/m/opening?year=2026');
  // 普通点击只负责打开弹窗；用实时命中坐标展开，不跳过遮挡或强制点击。
  await page.getByRole('button', { name: '导入 Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Excel 导入预览', exact: true });
  await expect(modal).toBeVisible();
  const state = await modal.evaluate((element) => {
    const select = element.querySelector<HTMLElement>('.ant-select')!;
    const rect = select.getBoundingClientRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      transform: getComputedStyle(element).transform,
      running: element
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === 'running'),
    };
  });
  await info.attach('冷启动实际点击帧', {
    body: JSON.stringify(state),
    contentType: 'application/json',
  });
  expect(state.running).toBe(true);
  await page.mouse.click(state.x, state.y);
  await expect(modal.getByLabel('导入模式', { exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect
    .poll(() => modal.evaluate((element) => getComputedStyle(element).transform))
    .toBe('none');
  await page.setViewportSize({ width: 360, height: 900 });
  const popup = page.locator('.ant-select-dropdown:visible');
  await expect
    .poll(() => popup.evaluate((element) => element.getBoundingClientRect().right))
    .toBeLessThanOrEqual(360);
  const dimensions = await popup.evaluate((element) => ({
    client: (element as HTMLElement).clientWidth,
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    clipped: [...element.querySelectorAll<HTMLElement>('.ant-select-item-option-content')].filter(
      (option) => option.scrollWidth > option.clientWidth,
    ).length,
  }));
  await info.attach('窄窗口稳定后尺寸', {
    body: JSON.stringify(dimensions),
    contentType: 'application/json',
  });
  expect(dimensions.client).toBeGreaterThanOrEqual(240);
  expect(dimensions.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(360);
  expect(dimensions.clipped).toBe(0);
  await popup
    .locator('.ant-select-item-option-content')
    .filter({ hasText: /^覆盖（明确修改已有键）$/ })
    .click();
  await expect(modal.locator('.ant-select')).toContainText('覆盖（明确修改已有键）');
});
