import { expect, it, vi } from 'vitest';
import { createBatchQueue } from '../web/batch-queue';

type Plan = { id: string; status: string; target: string };
const files = ['一.caiwubak', '二.caiwubak', '三.caiwubak'].map((name) => ({ name, size: 10 }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const queue = createBatchQueue<Plan>();
  const options = {
    limit: 32 * 1024 * 1024,
    canRestore: true,
    isCurrent: () => true,
    read: vi.fn(async (file: (typeof files)[number]) => file.name),
    upload: vi.fn(async (file: (typeof files)[number], _content: string) => ({
      id: file.name,
      sourceId: file.name,
    })),
    preview: vi.fn(async (id: string) => ({ id, status: 'ready', target: `副本-${id}` })),
    settled: vi.fn(),
  };
  return { queue, options };
}

it('w_tzjl_get_all：页面订阅移除后预检继续串行完成，重新订阅仍有完整结果和确认目标', async () => {
  const { queue, options } = fixture();
  queue.setPurpose('overwrite');
  queue.setCopyName('跨页副本名称');
  const first = deferred<string>();
  options.read.mockImplementationOnce(() => first.promise);
  const listener = vi.fn();
  const unsubscribe = queue.subscribe(listener);
  const pending = queue.start(files, options);
  expect(queue.getSnapshot().running).toBe(true);
  unsubscribe();
  const notifications = listener.mock.calls.length;
  first.resolve('首包内容');
  await pending;
  expect(listener).toHaveBeenCalledTimes(notifications);
  expect(options.upload.mock.calls.map(([file]) => file.name)).toEqual(
    files.map((file) => file.name),
  );
  expect(queue.getSnapshot().rows.map((row) => row.status)).toEqual([
    '预检通过',
    '预检通过',
    '预检通过',
  ]);
  expect(queue.getSnapshot().plan).toMatchObject({ id: '三.caiwubak', target: '副本-三.caiwubak' });
  expect(queue.getSnapshot().running).toBe(false);
  expect(queue.getSnapshot()).toMatchObject({ purpose: 'overwrite', copyName: '跨页副本名称' });
  expect(options.settled).toHaveBeenCalledOnce();
});

it('w_tzjl_get_all：取消未开始项保留当前已发请求的真实结果，重复开始不能覆盖活动队列', async () => {
  const { queue, options } = fixture();
  const first = deferred<{ id: string; sourceId: string }>();
  options.upload.mockImplementationOnce(() => first.promise);
  const pending = queue.start(files, options);
  await vi.waitFor(() => expect(options.upload).toHaveBeenCalledOnce());
  await queue.start([{ name: '意外重入', size: 10 }], options);
  queue.cancelUnstarted();
  first.resolve({ id: '已发布包', sourceId: '首包来源' });
  await pending;
  expect(options.upload).toHaveBeenCalledOnce();
  expect(options.preview).toHaveBeenCalledWith('已发布包');
  expect(queue.getSnapshot().rows.map((row) => row.status)).toEqual([
    '预检通过',
    '已取消未开始项',
    '已取消未开始项',
  ]);
});

it.each(['读取', '上传'] as const)(
  'w_tzjl_get_all：%s中切账清空旧队列，旧响应不能预览、提交下一项或覆盖新账进度',
  async (phase) => {
    const { queue, options } = fixture();
    const reading = deferred<string>();
    const uploading = deferred<{ id: string; sourceId: string }>();
    if (phase === '读取') options.read.mockImplementationOnce(() => reading.promise);
    else options.upload.mockImplementationOnce(() => uploading.promise);
    const old = queue.start(files, options);
    await vi.waitFor(() =>
      expect(phase === '读取' ? options.read : options.upload).toHaveBeenCalledOnce(),
    );
    queue.reset();
    expect(queue.getSnapshot()).toEqual({
      rows: [],
      running: false,
      plan: null,
      purpose: 'copy',
      copyName: '',
    });
    const next = fixture().options;
    await queue.start([{ name: '新账包', size: 10 }], next);
    const newSnapshot = queue.getSnapshot();
    reading.resolve('旧账文件');
    uploading.resolve({ id: '旧账包', sourceId: '旧账' });
    await old;
    expect(queue.getSnapshot()).toBe(newSnapshot);
    expect(options.preview).not.toHaveBeenCalled();
    expect(options.upload).toHaveBeenCalledTimes(phase === '读取' ? 0 : 1);
    expect(options.settled).not.toHaveBeenCalled();
  },
);

it('w_tzjl_get_all：单项错误不影响后续独立项，重复来源不新增预览，超限文件不读取', async () => {
  const { queue, options } = fixture();
  options.upload.mockRejectedValueOnce(new Error('合成包损坏'));
  options.upload.mockResolvedValueOnce({ id: '有效包', sourceId: '相同来源' });
  options.upload.mockResolvedValueOnce({ id: '另一版本', sourceId: '相同来源' });
  await queue.start([...files, { name: '过大', size: options.limit + 1 }], options);
  expect(options.read).toHaveBeenCalledTimes(3);
  expect(options.preview).toHaveBeenCalledExactlyOnceWith('有效包');
  expect(queue.getSnapshot().rows.map((row) => row.status)).toEqual([
    '拒绝',
    '预检通过',
    '重复来源 ID',
    '拒绝',
  ]);
  expect(queue.getSnapshot().rows[0]?.error).toBe('合成包损坏');
  const saved = queue.getSnapshot().rows[1]!.plan!;
  queue.planCancelled(saved.id);
  expect(queue.getSnapshot().rows[1]).toMatchObject({ status: '已取消', backupId: '有效包' });
  expect(queue.getSnapshot().plan).toBeNull();
});

it('w_tzjl_get_all：仅校验权限可继续上传，不创建管理员确认计划', async () => {
  const { queue, options } = fixture();
  await queue.start(files, { ...options, canRestore: false });
  expect(options.upload).toHaveBeenCalledTimes(3);
  expect(options.preview).not.toHaveBeenCalled();
  expect(queue.getSnapshot().rows.every((row) => row.status === '校验通过；无管理员恢复权限')).toBe(
    true,
  );
});
