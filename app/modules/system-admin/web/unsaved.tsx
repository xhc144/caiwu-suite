import { Button, Modal, Space } from 'antd';
import {
  unsavedPages,
  useRequiredSession,
  useTab,
  showError,
  type ConfirmLeave,
  type UnsavedSave,
} from '@caiwu/web-kit';

/** The shared registry runs registered saves and keeps failed or newly edited pages open. */
function useSessionConfirm() {
  const [modal, holder] = Modal.useModal();
  const confirm: ConfirmLeave = (pages) =>
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
    });
  return [confirm, holder] as const;
}

export function useSessionLeaveResult() {
  const session = useRequiredSession();
  const [confirm, holder] = useSessionConfirm();
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
    return unsavedPages.leaveWithResult(session.bookId, keys, confirm);
  };
  return [leave, holder] as const;
}

export function useSessionLeave() {
  const [leave, holder] = useSessionLeaveResult();
  return [
    async (excludeTab?: string) => {
      const result = await leave(excludeTab);
      if (result.error instanceof Error) showError(result.error);
      return result.allowed && !result.sessionRevoked;
    },
    holder,
  ] as const;
}

export function useSessionChange() {
  const session = useRequiredSession();
  const tab = useTab();
  const [confirm, holder] = useSessionConfirm();
  return [
    async (save: UnsavedSave) => {
      const result = await unsavedPages.saveSessionChange(session.bookId, tab.key, confirm, save);
      if (result.error instanceof Error) showError(result.error);
      return result;
    },
    holder,
  ] as const;
}
