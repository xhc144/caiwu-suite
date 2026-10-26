import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServiceSession, allowUnload, wakeWindow, type ServiceChild } from '../lifecycle';
import { createLog } from '../log';
import { atomicPdfWrite, exportPdf, targetState, withResource } from '../printing';
import {
  assertSender,
  fileName,
  isLocalUrl,
  isLocalDownload,
  pdfName,
  printDocument,
  printInput,
  printWasCancelled,
  safeExternalUrl,
  desktopMessage,
} from '../security';
import {
  checkDataDir,
  chooseDataDir,
  directoryError,
  readSettings,
  resolveDataDir,
  visibleBounds,
  writeSettings,
} from '../settings';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-desktop-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('数据目录与窗口配置', () => {
  it('选择目录取消、确认取消和验证失败均不提交配置', async () => {
    const validate = vi.fn();
    const confirm = vi.fn(async () => true);
    expect(await chooseDataDir({ choose: async () => null, validate, confirm })).toBeNull();
    expect(validate).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    const dir = temp();
    expect(
      await chooseDataDir({ choose: async () => dir, validate, confirm: async () => false }),
    ).toBeNull();
    const fail = vi.fn(() => {
      throw new Error('数据目录不可写');
    });
    await expect(
      chooseDataDir({ choose: async () => dir, validate: fail, confirm }),
    ).rejects.toThrow('不可写');
    expect(confirm).not.toHaveBeenCalled();
    expect(await chooseDataDir({ choose: async () => dir, validate, confirm })).toBe(dir);
  });
  it('配置缺失、持久保存、环境覆盖与损坏配置均有明确行为', () => {
    const dir = temp();
    const file = path.join(dir, 'settings.json');
    expect(readSettings(file)).toEqual({ version: 1 });
    writeSettings(file, { version: 1, dataDir: dir });
    expect(readSettings(file).dataDir).toBe(dir);
    expect(resolveDataDir(undefined, { version: 1 }, dir)).toBe(path.join(dir, '财务账套'));
    expect(resolveDataDir(dir, { version: 1, dataDir: '/other' }, dir)).toBe(dir);
    for (const value of [
      '{',
      'null',
      '{"version":2}',
      '{"version":1,"dataDir":"relative"}',
      '{"version":1,"window":{"width":0}}',
    ]) {
      writeFileSync(file, value);
      expect(() => readSettings(file)).toThrow(/配置损坏/);
      expect(readFileSync(file, 'utf8')).toBe(value);
    }
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });
  it('可写检查只清理自己的探针，原账套和备份保持原样；文件目标报中文', () => {
    const dir = temp();
    writeFileSync(path.join(dir, '保留账套.caiwu'), 'synthetic');
    mkdirSync(path.join(dir, 'backups'));
    checkDataDir(dir);
    expect(readdirSync(dir).sort()).toEqual(['backups', '保留账套.caiwu']);
    expect(() => checkDataDir(path.join(dir, '保留账套.caiwu'))).toThrow(/不是文件夹/);
    expect(directoryError({ code: 'ENOSPC' })).toMatch(/空间不足.*其他磁盘/);
    expect(directoryError({ code: 'EACCES' })).toMatch(/不可写.*权限/);
  });
  it('多屏移除后屏外窗口完全校正到可见工作区，小屏也可关闭', () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1040 };
    expect(visibleBounds({ x: 4000, y: -1200, width: 1440, height: 900 }, [primary])).toEqual({
      x: 480,
      y: 0,
      width: 1440,
      height: 900,
    });
    expect(
      visibleBounds({ x: -1700, y: 30, width: 1200, height: 800 }, [
        primary,
        { x: -1920, y: 0, width: 1920, height: 1040 },
      ]).x,
    ).toBe(-1700);
    expect(visibleBounds(undefined, [{ x: 50, y: 20, width: 800, height: 600 }])).toEqual({
      x: 50,
      y: 20,
      width: 800,
      height: 600,
    });
  });
});

function fakeChild() {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child: ServiceChild = {
    events,
    stdout,
    stderr,
    requestStop: vi.fn(() => events.emit('exit', 0)),
    forceStop: vi.fn(() => events.emit('exit', 1)),
  };
  return child;
}

describe('服务生命周期与关闭', () => {
  it('分块启动、令牌校验、退出后清理全部流和监听', async () => {
    const child = fakeChild();
    const log = vi.fn();
    const session = new ServiceSession(log, vi.fn());
    const ready = session.start(() => child, 'secret');
    child.stdout!.emit('data', Buffer.from('CAIWU_RE'));
    child.stdout!.emit('data', Buffer.from('ADY {"port":4317,"token":"secret"}\n'));
    expect(await ready).toBe(4317);
    child.stderr!.emit('data', Buffer.from('token password confidential book contents'));
    await session.stop();
    expect(child.requestStop).toHaveBeenCalledOnce();
    expect(child.stdout!.listenerCount('data')).toBe(0);
    expect(child.stderr!.listenerCount('data')).toBe(0);
    expect(child.events.listenerCount('exit')).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|password|confidential/);
  });
  it('启动提前退出立即失败，准备后退出只通知一次', async () => {
    const child = fakeChild();
    const unexpected = vi.fn();
    const session = new ServiceSession(vi.fn(), unexpected);
    const ready = session.start(() => child, 't');
    child.events.emit('exit', 1);
    await expect(ready).rejects.toThrow(/准备完成前退出/);
    await expect(session.stop()).rejects.toMatchObject({ outcome: 'unexpected' });
    expect(unexpected).not.toHaveBeenCalled();
    const next = fakeChild();
    const running = new ServiceSession(vi.fn(), unexpected);
    const started = running.start(() => next, 't');
    next.stdout!.emit('data', Buffer.from('CAIWU_READY {"port":1234,"token":"t"}\n'));
    await started;
    next.events.emit('exit', 1);
    next.events.emit('close', 1);
    expect(unexpected).toHaveBeenCalledOnce();
  });
  it('启动 30 秒超时请求停止，退出等待超时也不自动强杀', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    child.requestStop = vi.fn();
    const session = new ServiceSession(vi.fn(), vi.fn());
    const ready = session.start(() => child, 't');
    const rejection = expect(ready).rejects.toThrow(/30 秒/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(child.requestStop).toHaveBeenCalledOnce();
    const stopping = session.stop();
    const timeout = expect(stopping).rejects.toMatchObject({ outcome: 'timeout' });
    await vi.advanceTimersByTimeAsync(35_000);
    await timeout;
    expect(child.forceStop).not.toHaveBeenCalled();
    await session.terminate();
    await expect(session.stop()).rejects.toMatchObject({ outcome: 'forced' });
    expect(vi.getTimerCount()).toBe(0);
    expect(child.events.eventNames()).toEqual([]);
  });
  it('退出时取消未完成启动，错误消息/伪造端口不打开页面，spawn 失败可重试', async () => {
    for (const payload of ['{"port":0,"token":"t"}', '{"port":4317,"token":"wrong"}', '{']) {
      const child = fakeChild();
      const session = new ServiceSession(vi.fn(), vi.fn());
      const ready = session.start(() => child, 't');
      child.stdout!.emit('data', Buffer.from(`CAIWU_READY ${payload}\n`));
      await expect(ready).rejects.toThrow(/无效/);
      await session.stop();
    }
    const child = fakeChild();
    const session = new ServiceSession(vi.fn(), vi.fn());
    const ready = session.start(() => child, 't');
    const rejection = expect(ready).rejects.toThrow(/取消/);
    await session.stop();
    await rejection;
    expect(child.events.eventNames()).toEqual([]);
    const failed = new ServiceSession(vi.fn(), vi.fn());
    await expect(
      failed.start(() => {
        throw new Error('private');
      }, 't'),
    ).rejects.toThrow(/无法启动/);
  });
  it('关闭消息同步报错时不会重入停止流程，超时与显式强制终止分开', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    child.requestStop = vi.fn(() => {
      child.events.emit('error', new Error('IPC closed'));
    });
    const session = new ServiceSession(vi.fn(), vi.fn());
    const started = session.start(() => child, 't');
    child.stdout!.emit('data', Buffer.from('CAIWU_READY {"port":4317,"token":"t"}\n'));
    await started;
    const stopping = session.stop();
    const timeout = expect(stopping).rejects.toMatchObject({ outcome: 'timeout' });
    await vi.advanceTimersByTimeAsync(35_000);
    await timeout;
    expect(child.requestStop).toHaveBeenCalledOnce();
    expect(child.forceStop).not.toHaveBeenCalled();
    await session.terminate();
    await expect(session.stop()).rejects.toMatchObject({ outcome: 'forced' });
    expect(child.events.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('第二实例只还原并唤醒已有窗口；空窗口不创建第二个服务', () => {
    const win = { isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };
    wakeWindow(win);
    wakeWindow(null);
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
  });
  it('未保存关闭取消不会解除 beforeunload 阻止，确认才解除阻止', () => {
    const event = { preventDefault: vi.fn() };
    const cancel = vi.fn(() => false);
    expect(allowUnload(event, cancel)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(allowUnload(event, () => true)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe('IPC、导航及打印安全', () => {
  const origin = 'http://127.0.0.1:4317';
  it('精确 origin 阻止前缀攻击和危险 scheme；安全外链不携带账号', () => {
    expect(isLocalUrl(`${origin}/m/example?q=1`, origin)).toBe(true);
    for (const url of [
      `${origin}9/`,
      'http://127.0.0.1:4317.evil.test',
      'http://127.0.0.1:4317@evil.test',
      'javascript:alert(1)',
      'file:///tmp/x',
      'https://127.0.0.1:4317',
    ]) {
      expect(isLocalUrl(url, origin)).toBe(false);
    }
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///tmp/x',
      'https://user:pass@example.com',
      'https://example.com\n',
    ])
      expect(safeExternalUrl(url)).toBeNull();
    expect(safeExternalUrl('https://example.com/help')).toBe('https://example.com/help');
    expect(isLocalDownload(`blob:${origin}/synthetic-export`, origin)).toBe(true);
    expect(isLocalDownload(`${origin}/export`, origin)).toBe(true);
    for (const url of [
      `blob:${origin}9/export`,
      'blob:https://example.com/export',
      'data:text/plain,x',
      'file:///tmp/x',
    ])
      expect(isLocalDownload(url, origin)).toBe(false);
  });
  it('其他窗口、iframe、失效的主窗口以及外部网页均无文件/打印能力', () => {
    const sender = {};
    const frame = {};
    const owner = { webContents: sender, mainFrame: frame, url: origin };
    const event = { sender, senderFrame: frame };
    expect(() => assertSender(event, owner, origin, origin)).not.toThrow();
    for (const args of [
      [{ ...event, sender: {} }, owner, origin],
      [{ ...event, senderFrame: {} }, owner, origin],
      [event, null, origin],
      [event, { ...owner, url: 'https://example.com' }, origin],
      [event, owner, `${origin}9`],
    ] as const)
      expect(() => assertSender(args[0], args[1], args[2], origin)).toThrow(/无权/);
  });
  it('打印参数严格校验长度和布尔类型，保持 bridge 的两种参数兼容', () => {
    expect(printInput('<p>中文</p>', { title: '账簿' }, 'silent').enabled).toBe(false);
    expect(printInput('<p>中文</p>', { title: '账簿', landscape: true }, 'landscape').enabled).toBe(
      true,
    );
    for (const [html, opts] of [
      [null, {}],
      ['', { title: 'x' }],
      ['x'.repeat(2_000_001), { title: 'x' }],
      ['x', { title: 'x'.repeat(121) }],
      ['x', { title: 'x', silent: 'yes' }],
      ['x', { title: 'x', deviceName: 'arbitrary' }],
      ['x', []],
    ]) {
      expect(() => printInput(html, opts, 'silent')).toThrow();
    }
    expect(pdfName('../中文/账簿')).toBe('.._中文_账簿.pdf');
    expect(() => fileName('../secret')).toThrow(/文件名/);
    expect(printDocument('<script>alert(1)</script>')).toMatch(/script-src 'none'/);
    expect(printWasCancelled('Print job canceled')).toBe(true);
    expect(printWasCancelled('Invalid printer settings')).toBe(false);
  });
  it('PDF 取消不创建打印窗、不写文件；渲染/写入失败有中文下一步', async () => {
    const pdfError = new Error(
      'PDF 未保存成功，请检查目标文件是否被占用、目录写入权限和磁盘空间后重试',
      { cause: new Error('token=secret and book contents') },
    );
    expect(desktopMessage(pdfError, '桌面操作未完成')).toBe(pdfError.message);
    expect(desktopMessage(new Error('file path and password=secret'), '桌面操作未完成')).toBe(
      '桌面操作未完成',
    );
    const render = vi.fn(async () => new Uint8Array([1]));
    const write = vi.fn(async () => {});
    const failed = vi.fn();
    expect(await exportPdf({ choose: async () => null, render, write, failed })).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await expect(
      exportPdf({
        choose: async () => 'x.pdf',
        render,
        write: async () => {
          throw new Error('private');
        },
        failed,
      }),
    ).rejects.toThrow(/PDF 未保存成功.*权限/);
    await expect(
      exportPdf({
        choose: async () => 'x.pdf',
        render: async () => {
          throw new Error('bad');
        },
        write,
        failed,
      }),
    ).rejects.toThrow(/PDF 未保存成功/);
    expect(write).not.toHaveBeenCalled();
    const file = path.join(temp(), '中文.pdf');
    await atomicPdfWrite(file, Buffer.from('%PDF-test'));
    expect(readFileSync(file, 'utf8')).toBe('%PDF-test');
    expect(readdirSync(path.dirname(file))).toEqual(['中文.pdf']);
    await expect(atomicPdfWrite(file, Buffer.from('unconfirmed'))).rejects.toThrow(/发生了变化/);
    expect(readFileSync(file, 'utf8')).toBe('%PDF-test');
    const confirmed = await targetState(file);
    await atomicPdfWrite(file, Buffer.from('%PDF-confirmed'), confirmed);
    expect(readFileSync(file, 'utf8')).toBe('%PDF-confirmed');
    await expect(atomicPdfWrite(file, Buffer.from('stale'), confirmed)).rejects.toThrow(
      /发生了变化/,
    );
    expect(readFileSync(file, 'utf8')).toBe('%PDF-confirmed');
    expect(readdirSync(path.dirname(file))).toEqual(['中文.pdf']);
  });
  it('隐藏打印资源成功、取消、失败和超时都销毁', async () => {
    const destroy = vi.fn();
    expect(
      await withResource(
        () => ({ destroy }),
        async () => 'ok',
      ),
    ).toBe('ok');
    await expect(
      withResource(
        () => ({ destroy }),
        async () => {
          throw new Error('failed');
        },
      ),
    ).rejects.toThrow('failed');
    vi.useFakeTimers();
    const job = withResource(
      () => ({ destroy }),
      () => new Promise(() => {}),
      100,
    );
    const rejection = expect(job).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(destroy).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('诊断日志限大小轮换，只含固定事件和允许的系统码', () => {
    const dir = temp();
    const log = createLog(dir, 100);
    for (let i = 0; i < 25; i++)
      log('service-failed', { code: 'TOKEN=secret', message: 'password and book contents' });
    expect(readdirSync(dir).sort()).toEqual([
      'desktop.log',
      'desktop.log.1',
      'desktop.log.2',
      'desktop.log.3',
    ]);
    const contents = readdirSync(dir)
      .map((file) => readFileSync(path.join(dir, file), 'utf8'))
      .join('');
    expect(contents).toContain('service-failed');
    expect(contents).not.toMatch(/TOKEN|secret|password|book contents/);
  });
});
