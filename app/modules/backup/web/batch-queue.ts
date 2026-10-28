export type BatchPlan = { id: string; status: string };
export type BatchRow<P extends BatchPlan> = {
  key: string;
  name: string;
  status: string;
  backupId?: string;
  plan?: P;
  error?: string;
};
type Source = { name: string; size: number };
type Snapshot<P extends BatchPlan> = {
  rows: readonly BatchRow<P>[];
  running: boolean;
  plan: P | null;
  purpose: 'copy' | 'overwrite';
  copyName: string;
};

/** 窗口内队列独立于页面生命周期；只保存进度和预览，不持久化文件内容或口令。 */
export function createBatchQueue<P extends BatchPlan>() {
  const empty = (): Snapshot<P> => ({
    rows: [],
    running: false,
    plan: null,
    purpose: 'copy',
    copyName: '',
  });
  let snapshot = empty();
  const listeners = new Set<() => void>();
  let active: { cancelled: boolean } | undefined;
  const publish = (next: Snapshot<P>) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const update = (key: string, patch: Partial<BatchRow<P>>) => {
    publish({
      ...snapshot,
      rows: snapshot.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      active = undefined;
      publish(empty());
    },
    setPurpose(purpose: Snapshot<P>['purpose']) {
      publish({ ...snapshot, purpose, plan: null });
    },
    setCopyName(copyName: string) {
      publish({ ...snapshot, copyName });
    },
    setPlan(plan: P | null) {
      publish({ ...snapshot, plan: plan ? { ...plan } : null });
    },
    cancelUnstarted() {
      if (active) active.cancelled = true;
    },
    planCancelled(id: string) {
      publish({
        ...snapshot,
        plan: snapshot.plan?.id === id ? null : snapshot.plan,
        rows: snapshot.rows.map((r) =>
          r.plan?.id === id ? { ...r, status: '已取消', plan: undefined } : r,
        ),
      });
    },
    async start<F extends Source>(
      files: readonly F[],
      options: {
        limit: number;
        canRestore: boolean;
        isCurrent: () => boolean;
        read: (file: F) => Promise<string>;
        upload: (file: F, base64: string) => Promise<{ id: string; sourceId?: string }>;
        preview: (id: string) => Promise<P>;
        settled: () => void;
      },
    ) {
      if (snapshot.running || !options.isCurrent()) return;
      const run = { cancelled: false };
      active = run;
      const current = () => active === run && options.isCurrent();
      const rows = files.map((file) => ({
        key: crypto.randomUUID(),
        name: file.name,
        status: '等待预检',
      }));
      publish({ ...snapshot, rows, running: true });
      const sourceIds = new Set<string>();
      try {
        for (let i = 0; i < files.length; i++) {
          if (!current()) return;
          const file = files[i]!,
            row = rows[i]!;
          if (run.cancelled) {
            update(row.key, { status: '已取消未开始项' });
            continue;
          }
          if (file.size > options.limit) {
            update(row.key, { status: '拒绝', error: '文件超过 32 MiB，暂不能从浏览器上传' });
            continue;
          }
          update(row.key, { status: '上传并校验中' });
          try {
            const content = await options.read(file);
            if (!current()) return;
            const item = await options.upload(file, content);
            if (!current()) return;
            if (item.sourceId && sourceIds.has(item.sourceId)) {
              update(row.key, {
                backupId: item.id,
                status: '重复来源 ID',
                error: '本批次已包含此账套；请单独预览所需版本',
              });
              continue;
            }
            if (item.sourceId) sourceIds.add(item.sourceId);
            if (options.canRestore) {
              const plan = await options.preview(item.id);
              if (!current()) return;
              update(row.key, {
                backupId: item.id,
                status: plan.status === 'done' ? '已引入，不重复创建' : '预检通过',
                plan,
              });
              publish({ ...snapshot, plan: { ...plan } });
            } else update(row.key, { backupId: item.id, status: '校验通过；无管理员恢复权限' });
          } catch (error) {
            if (!current()) return;
            update(row.key, {
              status: '拒绝',
              error: error instanceof Error ? error.message : '预检失败',
            });
          }
        }
      } finally {
        if (active === run) {
          active = undefined;
          if (options.isCurrent()) {
            publish({ ...snapshot, running: false });
            options.settled();
          } else publish(empty());
        }
      }
    },
  };
}
