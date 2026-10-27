import { expect, type Page } from '@playwright/test';

export async function chooseSettingsClose(
  page: Page,
  choice: '继续编辑' | '放弃修改',
  clicks: 1 | 2 = 1,
) {
  const confirmation = page.getByRole('dialog', { name: '展示设置尚未保存', exact: true });
  await expect(confirmation).toBeVisible();
  // 可见时仍可能处于缩放入场的起始帧；等真实入场结束再定位按钮。
  await expect(confirmation).not.toHaveClass(/\bant-zoom-(?:appear|enter)\b/);
  const button = confirmation.getByRole('button', { name: choice, exact: true });
  if (clicks === 2) await button.dblclick();
  else await button.click();
  // 编辑值本来就未改变，不能用它代替关闭处理已实际执行的证据。
  await expect(confirmation).toHaveCount(0);
}
