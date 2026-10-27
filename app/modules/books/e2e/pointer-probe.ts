import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export async function clickModalAction(dialog: Locator, name: string) {
  // 入场缩放的起始帧也可能暂时满足 Playwright 的稳定性检查。
  // 等 Ant Design 完成真实动画，再用正常指针点击；不改动画或测试预算。
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveClass(/\bant-zoom-(?:appear|enter|leave)\b/);
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await dialog.getByRole('button', { name, exact: true }).click();
}

export async function probeModalPointers(page: Page, info: TestInfo) {
  const records: unknown[] = [];
  await page.exposeFunction('recordBookModalPointer', (record: unknown) => records.push(record));
  await page.addInitScript(() => {
    const record = (
      window as unknown as Window & {
        recordBookModalPointer: (value: unknown) => Promise<void>;
      }
    ).recordBookModalPointer;
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const dialog = target.closest('[role="dialog"]');
          const button = target.closest('button');
          const rect = button?.getBoundingClientRect();
          const pointer = event as MouseEvent;
          void record({
            type,
            time: performance.now(),
            target: target.tagName,
            targetClass: target.getAttribute('class'),
            button: button?.textContent,
            dialog: dialog?.getAttribute('aria-labelledby'),
            title: dialog?.querySelector('.ant-modal-title')?.textContent,
            dialogClass: dialog?.getAttribute('class'),
            transform: dialog ? getComputedStyle(dialog).transform : null,
            animations: dialog?.getAnimations().map((animation) => ({
              state: animation.playState,
              time: animation.currentTime,
              duration: animation.effect?.getComputedTiming().duration,
            })),
            x: pointer.clientX,
            y: pointer.clientY,
            rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          });
        },
        true,
      );
    }
  });
  return async () => {
    await info.attach('modal-pointer-events', {
      body: JSON.stringify(records, null, 2),
      contentType: 'application/json',
    });
  };
}
