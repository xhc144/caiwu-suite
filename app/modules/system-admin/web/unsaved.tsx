import { Button, Modal, Space } from 'antd';
import { unsavedPages, useRequiredSession } from '@caiwu/web-kit';

/** The shared registry runs registered saves and keeps failed or newly edited pages open. */
export function useSessionLeave() {
  const session = useRequiredSession();
  const [modal, holder] = Modal.useModal();
  const leave = (excludeTab?: string) => {
    const keys =
      excludeTab === undefined
        ? undefined
        : [
            ...new Set(
              unsavedPages
                .dirty(session.bookId)
                .filter((page) => page.tabKey !== excludeTab)
                .map((page) => page.tabKey),
            ),
          ];
    return unsavedPages.leave(
      session.bookId,
      keys,
      (pages) =>
        new Promise((resolve) => {
          const finish = (choice: 'save' | 'discard' | 'cancel') => {
            dialog.destroy();
            resolve(choice);
          };
          const dialog = modal.confirm({
            title: '有尚未保存的内容',
            content: (
              <>
                <p>请选择如何处理以下页面：</p>
                <ul>
                  {pages.map((page, i) => (
                    <li key={i}>{page.title}</li>
                  ))}
                </ul>
              </>
            ),
            onCancel: () => resolve('cancel'),
            footer: (
              <Space wrap>
                <Button onClick={() => finish('cancel')}>继续编辑</Button>
                <Button danger onClick={() => finish('discard')}>
                  放弃修改
                </Button>
                <Button type="primary" onClick={() => finish('save')}>
                  保存后继续
                </Button>
              </Space>
            ),
          });
        }),
    );
  };
  return [leave, holder] as const;
}
