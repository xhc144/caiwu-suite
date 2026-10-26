import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixture';

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
}

// page/context 由 runner 创建并回收，失败时保留该 context 的 trace 与截图。
// 三个独立 case 各自仍为 30 秒；不能把拆分后的总成本视为原 case 的性能。
for (const dpr of [1, 2]) {
  test.describe(`真实 DPR=${dpr}`, () => {
    test.use({
      deviceScaleFactor: dpr,
      viewport: { width: 1280, height: dpr === 1 ? 720 : 800 },
    });

    test('内容就绪后的明亮/深色、125%/150%布局、搜索焦点与偏好重载', async ({ page, seeded }) => {
      await seeded.login(page);
      const shell = page.locator('.cw-shell-root');
      const header = page.locator('.cw-shell-header');
      const pending = page.locator('.ant-card').filter({
        has: page.getByRole('button', { name: '处理待审核凭证' }),
      });
      await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
      await expect(pending.locator('.ant-statistic-content-value')).toHaveText(
        String(seeded.counts.pending),
      );
      expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr);
      await page.getByRole('button', { name: '帮助', exact: true }).click();
      await expect(page.getByRole('heading', { name: '帮助与关于', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '界面', exact: true }).click();
      const appearance = page.getByRole('dialog', { name: '界面偏好' });
      await appearance.getByRole('combobox', { name: '主题' }).click();
      await page.getByTitle('明亮', { exact: true }).click();
      await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await appearance.getByRole('combobox', { name: '主题' }).click();
      await page.getByTitle('深色', { exact: true }).click();
      await expect(header).toHaveCSS('background-color', 'rgb(31, 31, 31)');

      for (const scale of ['125%', '150%']) {
        await appearance.getByRole('combobox', { name: '网页界面缩放' }).click();
        await page.getByTitle(scale, { exact: true }).click();
        await appearance.getByRole('button', { name: '完成' }).click();
        await expect(appearance).not.toBeVisible();
        await expect(shell).toHaveCSS('zoom', scale === '125%' ? '1.25' : '1.5');
        await expect(header).toHaveCSS('background-color', 'rgb(31, 31, 31)');
        const layout = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
          overflow: [...document.querySelectorAll('body *')]
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              right: el.getBoundingClientRect().right,
              width: el.getBoundingClientRect().width,
            }))
            .filter((el) => el.right > innerWidth)
            .slice(0, 10),
        }));
        expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
        await expectInsideViewport(page, header);
        const guidance = page.getByRole('button', { name: '重新开启首页引导' });
        await guidance.scrollIntoViewIfNeeded();
        await expectInsideViewport(page, guidance);
        await expectInsideViewport(page, header);
        const trigger = page.getByRole('button', { name: '搜索 Ctrl+K' });
        await expectInsideViewport(page, trigger);
        await trigger.click();
        const search = page.getByRole('dialog', { name: '全局搜索', exact: true });
        const input = search.getByRole('combobox', { name: '全局搜索关键词' });
        await expect(input).toBeFocused();
        await input.fill('kcxj');
        // 内容加载完成后才量布局，避免只测空壳或加载占位。
        const result = search.getByRole('option').filter({ hasText: '1001 库存现金' });
        await expect(result).toBeVisible();
        await expectInsideViewport(page, search);
        await expectInsideViewport(page, input);
        await expectInsideViewport(page, result);
        await page.keyboard.press('Escape');
        await expect(search).not.toBeVisible();
        await expect(trigger).toBeFocused();
        await page.getByRole('button', { name: '界面', exact: true }).click();
      }
      await appearance.getByRole('button', { name: '完成' }).click();
      await page.reload();
      await expect(page.getByRole('heading', { name: '帮助与关于', exact: true })).toBeVisible();
      await expect(shell).toHaveCSS('zoom', '1.5');
      await expect(header).toHaveCSS('background-color', 'rgb(31, 31, 31)');
      expect(await page.evaluate(() => devicePixelRatio)).toBe(dpr);
    });
  });
}
