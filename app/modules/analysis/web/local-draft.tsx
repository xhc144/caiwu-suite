import { useEffect, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { queryClient, showError, usePermission, useRequiredSession } from '@caiwu/web-kit';
import { downloadBlob } from '@caiwu/ui';
import { api } from './api';

/** 账套及操作员隔离的本机恢复副本；不含登录口令，不代替正式保存或版本检查。 */
export function useLocalDraft<T>({
  kind,
  identity,
  baseVersion,
  value,
  dirty,
  parse,
  restore,
  busy,
}: {
  kind: string;
  identity: string;
  baseVersion: string;
  value: T;
  dirty: boolean;
  parse: (value: unknown) => T | undefined;
  restore: (value: T) => void;
  busy: boolean;
}) {
  const session = useRequiredSession();
  const canExport = usePermission('analysis.export');
  const key = `caiwu.analysis.draft.${session.book.id}.${session.user.id}.${kind}.${identity}`;
  const [pending, setPending] = useState<{ baseVersion: string; value: T } | undefined>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (typeof raw !== 'object' || !raw) return;
      const candidate = raw as { baseVersion?: unknown; value?: unknown };
      const parsed = parse(candidate.value);
      if (typeof candidate.baseVersion === 'string' && parsed !== undefined)
        return { baseVersion: candidate.baseVersion, value: parsed };
    } catch {
      /* 存储不可用或旧副本损坏时继续保留当前表单。 */
    }
    return;
  });
  const [storageError, setStorageError] = useState(false);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (pending) return;
    try {
      if (dirty)
        localStorage.setItem(key, JSON.stringify({ baseVersion, value: JSON.parse(serialized) }));
      else localStorage.removeItem(key);
    } catch {
      setStorageError(true);
    }
  }, [key, baseVersion, serialized, dirty, pending]);
  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      setStorageError(true);
    }
    setPending(undefined);
  };
  const notice = (
    <>
      {pending && (
        <Alert
          type="warning"
          title="发现上次未保存的分析草稿"
          description={
            pending.baseVersion === baseVersion
              ? '请先恢复或处理恢复副本，再继续编辑；恢复后仍须正式保存。'
              : '已保存版本或取数来源已变化。请先导出并处理旧草稿，再继续编辑；不能直接覆盖当前版本。'
          }
          action={
            <Space>
              <Button
                disabled={busy || !canExport}
                onClick={() =>
                  void (async () => {
                    await queryClient.fetchQuery({
                      ...api.printAllowed.queryOptions('trend'),
                      staleTime: 0,
                    });
                    downloadBlob(
                      new Blob([JSON.stringify(pending.value, null, 2)], {
                        type: 'application/json;charset=utf-8',
                      }),
                      '分析恢复副本.json',
                    );
                  })().catch(showError)
                }
              >
                导出恢复副本
              </Button>
              <Button
                disabled={busy || pending.baseVersion !== baseVersion}
                onClick={() => {
                  restore(pending.value);
                  clear();
                }}
              >
                恢复上次草稿
              </Button>
              <Button disabled={busy} onClick={clear}>
                删除恢复副本
              </Button>
            </Space>
          }
        />
      )}
      {storageError && (
        <Alert type="warning" title="本机草稿副本无法更新，请及时正式保存或导出当前稿" />
      )}
    </>
  );
  return { notice, clear, blocked: !!pending };
}
