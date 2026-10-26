import fastifyStatic from '@fastify/static';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildAppRouter,
  createRuntime,
  type AppRuntime,
  type ServerModule,
} from '@caiwu/server-kit';

export interface ServerOptions {
  dataDir: string;
  /** 启动令牌：所有 /trpc 请求必须带请求头 x-caiwu-token。Electron 启动时随机生成。 */
  token: string;
  modules: readonly ServerModule[];
  moduleDirs?: readonly string[];
  devMode?: boolean;
  /** 前端构建产物目录（apps/web/dist）。不给则只提供接口。 */
  webDist?: string;
  version?: string;
  lifecycleTimeoutMs?: number;
  /** 额外允许的 Host 头（默认只允许 127.0.0.1 / localhost） */
  allowedHosts?: string[];
}

export interface CaiwuServer {
  fastify: FastifyInstance;
  runtime: AppRuntime;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostName(host: string | undefined): string {
  if (!host) return '';
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
}

/**
 * 本地服务：只给本机用。安全措施：
 * - 只监听 127.0.0.1（见 main.ts）
 * - 校验 Host 头，防 DNS rebinding
 * - /trpc 必须带启动令牌（浏览器跨站请求无法带自定义请求头），令牌只注入到本服务返回的 index.html 里
 */
export async function createServer(opts: ServerOptions): Promise<CaiwuServer> {
  const runtime = createRuntime({
    dataDir: opts.dataDir,
    exclusiveServer: true,
    modules: opts.modules,
    moduleDirs: opts.moduleDirs,
    devMode: opts.devMode,
    version: opts.version,
    lifecycleTimeoutMs: opts.lifecycleTimeoutMs,
  });
  const router = buildAppRouter(runtime);
  const fastify = Fastify({
    logger: false,
    bodyLimit: 50 * 1024 * 1024,
    routerOptions: { maxParamLength: 5000 },
  });
  fastify.addHook('onClose', async () => runtime.lifecycle.stop());
  try {
    const allowed = new Set([...LOCAL_HOSTS, ...(opts.allowedHosts ?? [])]);

    fastify.addHook('onRequest', async (req, reply) => {
      if (!allowed.has(hostName(req.headers.host))) {
        return reply.code(403).send({ error: 'host not allowed' });
      }
      if (req.url.startsWith('/trpc') && req.headers['x-caiwu-token'] !== opts.token) {
        return reply.code(401).send({ error: 'invalid app token' });
      }
    });

    await fastify.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router,
        createContext: ({ req }) => {
          const auth = req.headers.authorization;
          return { app: runtime, token: auth?.startsWith('Bearer ') ? auth.slice(7) : null };
        },
        onError: ({ error, path: p }) => {
          if (error.code === 'INTERNAL_SERVER_ERROR')
            console.error(`[trpc] ${p}:`, error.cause ?? error);
        },
      },
    } satisfies FastifyTRPCPluginOptions<typeof router>);

    fastify.get('/healthz', async (_req, reply) => {
      const ok = runtime.lifecycle.state === 'ready';
      return reply
        .code(ok ? 200 : 503)
        .send({ ok, version: runtime.version, state: runtime.lifecycle.state });
    });

    if (opts.webDist && existsSync(path.join(opts.webDist, 'index.html'))) {
      const indexHtml = readFileSync(path.join(opts.webDist, 'index.html'), 'utf8').replace(
        '</head>',
        `<script>window.__CAIWU_BOOT__=${JSON.stringify({ token: opts.token })}</script></head>`,
      );
      await fastify.register(fastifyStatic, {
        root: opts.webDist,
        index: false,
        wildcard: false,
        prefix: '/',
      });
      const sendIndex = (
        _req: unknown,
        reply: { type: (t: string) => { send: (b: string) => unknown } },
      ) => reply.type('text/html; charset=utf-8').send(indexHtml);
      fastify.get('/', sendIndex);
      // 前端路由（/m/...）刷新时返回 index.html
      fastify.setNotFoundHandler((req, reply) => {
        if (
          req.method === 'GET' &&
          !req.url.startsWith('/trpc') &&
          !path.extname(req.url.split('?')[0]!)
        ) {
          return sendIndex(req, reply);
        }
        return reply.code(404).send({ error: 'not found' });
      });
    }

    await runtime.lifecycle.start();
    return { fastify, runtime };
  } catch (error) {
    try {
      await fastify.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        '服务启动失败且清理未完成，数据目录仍可能占用',
        { cause: closeError },
      );
    }
    throw error;
  }
}
