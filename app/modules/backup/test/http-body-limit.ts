import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';

type BodyLimitResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  complete: boolean;
  sentBodyBytes: number;
  writeError: string | null;
};
/**
 * 真实 HTTP 观测：声明长度时只发请求头，观察服务端是否提前拒绝；
 * 分块模式实际发送内容且每块让出事件循环，以便在提前响应后立即停止写入。
 * 只有读到完整响应才返回；连接错误、截断和超时均失败，不作为“已拒绝”的替代。
 */
export function probeBodyLimit(
  url: string,
  headers: Record<string, string>,
  options: { mode: 'declared' | 'chunked'; bodyBytes: number },
): Promise<BodyLimitResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    let stopped = false;
    let sentBodyBytes = 0;
    let writeError: string | null = null;
    const req = httpRequest(url, {
      method: 'POST',
      agent: false,
      headers: {
        ...headers,
        'content-type': 'application/json',
        connection: 'close',
        ...(options.mode === 'declared'
          ? { 'content-length': String(options.bodyBytes) }
          : { 'transfer-encoding': 'chunked' }),
      },
    });
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      stopped = true;
      clearTimeout(timer);
      req.destroy();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('未收到完整的 HTTP 拒绝响应')), 30_000);
    req.on('response', (res) => {
      responseStarted = true;
      stopped = true;
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) {
          fail(new Error('HTTP 拒绝响应异常过大'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('aborted', () => fail(new Error('HTTP 拒绝响应被截断')));
      res.on('error', fail);
      res.on('end', () => {
        if (settled) return;
        if (!res.complete) {
          fail(new Error('HTTP 拒绝响应不完整'));
          return;
        }
        settled = true;
        clearTimeout(timer);
        const result = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          complete: res.complete,
          sentBodyBytes,
          writeError,
        };
        req.destroy();
        resolve(result);
      });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      writeError = error.code ?? error.message;
      stopped = true;
      if (!responseStarted) fail(error);
      // 已开始的响应仍必须完整读完；发生截断/超时会走上面的失败分支。
    });
    req.flushHeaders();
    if (options.mode === 'chunked') {
      void (async () => {
        const prefix = Buffer.from('{"name":"HTTP上限","base64":"');
        const suffix = Buffer.from('"}');
        const contentEnd = options.bodyBytes - suffix.length;
        if (contentEnd < prefix.length) throw new Error('测试请求长度不足以容纳 JSON');
        const chunk = Buffer.alloc(64 * 1024, 65);
        while (!stopped && sentBodyBytes < options.bodyBytes) {
          const part =
            sentBodyBytes < prefix.length
              ? prefix.subarray(sentBodyBytes)
              : sentBodyBytes < contentEnd
                ? chunk.subarray(0, Math.min(chunk.length, contentEnd - sentBodyBytes))
                : suffix.subarray(sentBodyBytes - contentEnd);
          await new Promise<void>((done, error) => req.write(part, (e) => (e ? error(e) : done())));
          sentBodyBytes += part.length;
          await nextTurn();
        }
        // 超限时无需发送结束块：服务端必须在收到超限内容后直接返回完整 413。
      })().catch((error: Error) => {
        writeError = (error as NodeJS.ErrnoException).code ?? error.message;
        if (!responseStarted) fail(error);
      });
    }
  });
}
