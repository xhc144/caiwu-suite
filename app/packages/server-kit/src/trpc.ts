import { initTRPC, TRPCError } from '@trpc/server';
import { BusinessError, isBusinessErrorData, type BusinessErrorData } from '@caiwu/core';
import type { RequestContext } from './context';

/** 过程的元信息。mutation 必须声明 permission（启动时检查）。 */
export interface ProcedureMeta {
  /** 需要的权限点，必须在模块 manifest 的 permissions 里声明 */
  permission?: string;
  /** 明确声明这个 mutation 不需要权限（例如"修改自己的偏好"） */
  noPermission?: boolean;
}

function businessCode(e: BusinessError): TRPCError['code'] {
  switch (e.data.code) {
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'NOT_FOUND':
    case 'BOOK_NOT_FOUND':
      return 'NOT_FOUND';
    case 'VOUCHER_STALE':
      return 'CONFLICT';
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    default:
      return 'BAD_REQUEST';
  }
}

interface IssueLike {
  path?: readonly (PropertyKey | { key: PropertyKey })[];
  message: string;
}

function inputIssues(cause: unknown): IssueLike[] | null {
  const issues = (cause as { issues?: unknown })?.issues;
  return Array.isArray(issues) && issues.every((i) => typeof (i as IssueLike)?.message === 'string')
    ? (issues as IssueLike[])
    : null;
}

export const t = initTRPC
  .context<RequestContext>()
  .meta<ProcedureMeta>()
  .create({
    errorFormatter({ shape, error }) {
      let business: BusinessErrorData | null = null;
      if (error.cause instanceof BusinessError) {
        business = error.cause.data;
      } else if (error.code === 'BAD_REQUEST' && inputIssues(error.cause)) {
        const issues = inputIssues(error.cause)!;
        const first = issues[0]!;
        const where = (first.path ?? [])
          .map((p) => (typeof p === 'object' ? String(p.key) : String(p)))
          .join('.');
        business = {
          code: 'INPUT_INVALID',
          message: `提交的数据不合法${where ? `（${where}）` : ''}：${first.message}`,
          details: { issues: issues.map((i) => ({ path: i.path, message: i.message })) },
        };
      } else if (error.code === 'INTERNAL_SERVER_ERROR') {
        business = {
          code: 'INTERNAL',
          message: '程序出错了，操作没有完成',
          hint: '请重试；如果一直出现，请把错误信息发给开发者',
          details: { error: error.message },
        };
      }
      return { ...shape, data: { ...shape.data, business } };
    },
  });

/** 把业务错误转成合适的 HTTP/TRPC 错误码（否则一律 500）。 */
export const businessErrors = t.middleware(async ({ next }) => {
  const res = await next();
  if (!res.ok && res.error.cause instanceof BusinessError) {
    throw new TRPCError({
      code: businessCode(res.error.cause),
      message: res.error.cause.message,
      cause: res.error.cause,
    });
  }
  return res;
});

export { TRPCError, isBusinessErrorData };
