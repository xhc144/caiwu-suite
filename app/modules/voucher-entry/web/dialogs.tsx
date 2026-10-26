import { modalApi } from '@caiwu/web-kit';
export function confirm(title: string, content: string): Promise<boolean> {
  const modal = modalApi();
  if (!modal) return Promise.resolve(false);
  return new Promise((resolve) =>
    modal.confirm({
      title,
      content,
      okText: '确认',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    }),
  );
}
