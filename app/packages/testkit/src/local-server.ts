import { spawn } from 'node:child_process';
import path from 'node:path';

export type ShutdownProtocol = 'native' | 'sigterm-bridge';

type Exit = { code: number | null; signal: NodeJS.Signals | null };
type Ready = { port: number } | { error: Error };

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('等待服务超时')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 协议由调用方明确指定；IPC 通道的存在不表示生产入口支持某种关闭消息。 */
export function spawnLocalServer(options: {
  dataDir: string;
  shutdownProtocol: ShutdownProtocol;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  entry?: string;
  /** 仅供回归测试启动失败；正常服务始终使用当前 Node。 */
  executable?: string;
}) {
  const cwd = options.cwd ?? process.cwd();
  const args = ['--import', 'tsx'];
  if (options.shutdownProtocol === 'sigterm-bridge')
    args.push('--import', new URL('./sigterm-bridge.mjs', import.meta.url).href);
  args.push(options.entry ?? path.resolve(cwd, 'apps/server/src/main.ts'));
  const child = spawn(options.executable ?? process.execPath, args, {
    cwd,
    env: { ...process.env, ...options.env, CAIWU_DATA_DIR: options.dataDir },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  let stdout = '';
  let exit: Exit | undefined;
  let failure: Error | undefined;
  let readyPort: number | undefined;
  let requested = false;
  let sendSucceeded = false;
  let settleReady!: (result: Ready) => void;
  let settleEnded!: (result: Exit | Error) => void;
  const ready = new Promise<Ready>((resolve) => {
    settleReady = resolve;
  });
  const ended = new Promise<Exit | Error>((resolve) => {
    settleEnded = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
  });
  const fail = (error: Error) => {
    failure ??= error;
    settleReady({ error });
    settleEnded(error);
  };
  // 在 spawn 返回后立即记录终止状态，不能等到 finally 才注册。
  child.on('error', fail);
  child.once('exit', (code, signal) => {
    exit = { code, signal };
    settleReady({ error: new Error(`服务在就绪前退出：${code}/${signal}`) });
    settleEnded(exit);
  });
  child.on('message', (message) => {
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'CAIWU_TEST_SHUTDOWN_REJECTED'
    )
      fail(new Error(`测试关闭桥接拒绝请求：${JSON.stringify(message)}`));
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-12_000);
  });
  child.stdout!.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-12_000);
    stdout = (stdout + chunk.toString()).slice(-12_000);
    if (readyPort !== undefined) return;
    const match = /CAIWU_READY (\{[^\n]+\})/.exec(stdout);
    if (!match) return;
    try {
      const { port } = JSON.parse(match[1]!) as { port: number };
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('READY 端口无效');
      readyPort = port;
      settleReady({ port });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const diagnostic = (error: unknown) =>
    new Error(
      `${error instanceof Error ? error.message : String(error)}；保留临时目录：${options.dataDir}\n${output}`,
    );
  let stopping: Promise<void> | undefined;
  return {
    child,
    async ready(timeoutMs = 20_000): Promise<number> {
      try {
        const result = await within(ready, timeoutMs);
        if ('error' in result) throw result.error;
        if (failure) throw failure;
        if (exit) throw new Error(`服务已退出：${exit.code}/${exit.signal}`);
        return result.port;
      } catch (error) {
        throw diagnostic(error);
      }
    },
    close(timeoutMs = 5_000): Promise<void> {
      stopping ??= (async () => {
        try {
          if (failure) throw failure;
          if (exit) throw new Error(`请求正常关闭前服务已退出：${exit.code}/${exit.signal}`);
          requested = true;
          await within(
            (async () => {
              await new Promise<void>((resolve, reject) => {
                if (!child.connected) return reject(new Error('关闭消息发送失败：IPC 已断开'));
                child.send(
                  {
                    type:
                      options.shutdownProtocol === 'native'
                        ? 'CAIWU_SHUTDOWN'
                        : 'CAIWU_TEST_SHUTDOWN',
                  },
                  (error) => {
                    if (error) reject(error);
                    else {
                      sendSucceeded = true;
                      resolve();
                    }
                  },
                );
              });
              const result = await ended;
              if (result instanceof Error) throw result;
              if (
                !requested ||
                !sendSucceeded ||
                failure ||
                result.code !== 0 ||
                result.signal !== null
              )
                throw failure ?? new Error(`服务异常退出：${result.code}/${result.signal}`);
              await closed; // exit 先于 close；必须等 stdout/stderr 完成。
            })(),
            timeoutMs,
          );
        } catch (error) {
          // 只清理由本 helper 创建的异常进程；强杀始终失败且不清理数据目录。
          if (!exit && child.pid) child.kill('SIGKILL');
          await within(closed, 2_000).catch(() => {});
          throw diagnostic(error);
        }
      })();
      return stopping;
    },
  };
}
