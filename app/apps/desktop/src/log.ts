import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export type LogEvent =
  | 'launch'
  | 'settings-invalid'
  | 'settings-write-failed'
  | 'data-dir-failed'
  | 'service-start'
  | 'service-ready'
  | 'service-stderr'
  | 'service-failed'
  | 'service-exit'
  | 'service-stop'
  | 'service-force-stop'
  | 'service-stop-failed'
  | 'window-load-failed'
  | 'renderer-gone'
  | 'renderer-unresponsive'
  | 'main-exception'
  | 'pdf-write-failed';

/** 只记录固定事件和允许的系统错误码，不写子进程输出、路径、HTML、令牌或异常正文。 */
export function createLog(dir: string, maxBytes = 256 * 1024) {
  const file = path.join(dir, 'desktop.log');
  return (event: LogEvent, error?: unknown) => {
    try {
      mkdirSync(dir, { recursive: true });
      if (existsSync(file) && statSync(file).size >= maxBytes) {
        rmSync(`${file}.3`, { force: true });
        for (let i = 2; i >= 1; i--) {
          if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
        }
        renameSync(file, `${file}.1`);
      }
      const raw = (error as NodeJS.ErrnoException | null)?.code;
      const code = ['EACCES', 'EPERM', 'ENOSPC', 'EDQUOT', 'ENOENT', 'ETIMEDOUT'].includes(
        raw ?? '',
      )
        ? raw
        : undefined;
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), event, code })}\n`, {
        mode: 0o600,
      });
    } catch {
      // 日志失败不能导致再次抛异常；启动/数据写入本身的错误由原生对话框报告。
    }
  };
}
