import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared';
import { AutomaticBackupController } from '../server/controller';

it('w_autobak：启动和定时真实调度、配置停用撤销定时，退出幂等且不重入', async () => {
  let time = 0;
  let index = 0;
  const timers = new Map<number, () => void>();
  const config = { ...DEFAULT_SETTINGS, onExit: false };
  let calls = 0;
  const controller = new AutomaticBackupController({
    now: () => time,
    set: (fn) => {
      timers.set(++index, fn);
      return index;
    },
    clear: (id) => {
      timers.delete(id as number);
    },
  });
  await controller.attach('test', {
    settings: async () => config,
    backup: async () => {
      calls++;
      return { status: 'valid', reason: '' };
    },
  });
  expect(calls).toBe(1);
  expect(controller.status('test').lastSuccess).toBe(new Date(0).toISOString());
  expect(timers.size).toBe(1);
  const [key, fire] = [...timers.entries()][0]!;
  timers.delete(key);
  time = 60 * 60_000;
  fire();
  // 调度回调的异步链通过控制器状态可观察，不使用墙钟等待。
  for (
    let step = 0;
    step < 20 && (!controller.status('test').nextAt || controller.status('test').running);
    step++
  )
    await Promise.resolve();
  expect(calls).toBe(2);
  expect(timers.size).toBe(1);
  expect(controller.status('test').nextAt).toBe(new Date(time + 60 * 60_000).toISOString());
  config.enabled = false;
  await controller.reconfigure('test');
  expect(timers.size).toBe(0);
  expect(controller.status('test').nextAt).toBeNull();
  await controller.run('test');
  expect(calls).toBe(2);
  expect(await controller.shutdown()).toEqual([]);
  expect(await controller.shutdown()).toEqual([]);
  expect(calls).toBe(2);
});
it('w_autobak：读取配置失败会保留可读状态，退出收集错误而非无声截断', async () => {
  const controller = new AutomaticBackupController();
  await controller.attach('bad', {
    settings: async () => {
      throw new Error('读取自动备份配置失败');
    },
    backup: async () => {
      throw new Error('不应执行');
    },
  });
  expect(controller.status('bad').lastFailure).toBe('读取自动备份配置失败');
  expect(await controller.shutdown()).toEqual([{ bookId: 'bad', reason: '读取自动备份配置失败' }]);
});
