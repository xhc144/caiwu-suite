/**
 * 业务错误：用户能看懂、能处理的错误。服务端抛出后会原样带到前端，
 * 前端统一显示 message + hint，并把 actions 渲染成按钮。
 *
 * 规则：message 说清"为什么不行"，hint 说清"下一步怎么做"，能跳转就给 actions。
 * 例：
 *   throw new BusinessError({
 *     code: 'PERIOD_HAS_UNPOSTED',
 *     message: '2026年07月还有 3 张凭证没有过账，不能结账',
 *     hint: '先把这些凭证审核并过账，再回来结账',
 *     actions: [{ label: '查看这些凭证', to: '/m/voucher-book?period=202607&status=audited' }],
 *   });
 */
export interface BusinessErrorAction {
  label: string;
  /** 站内路由，例如 /m/voucher-book?status=pending */
  to: string;
}

export interface BusinessErrorData {
  /** 稳定的英文大写错误码，测试和前端可据此判断 */
  code: string;
  message: string;
  hint?: string;
  actions?: BusinessErrorAction[];
  /** 附加数据（例如涉及的凭证 id 列表），供前端展示明细 */
  details?: Record<string, unknown>;
}

export class BusinessError extends Error {
  readonly data: BusinessErrorData;

  constructor(data: BusinessErrorData) {
    super(data.message);
    this.name = 'BusinessError';
    this.data = data;
  }
}

export function isBusinessErrorData(value: unknown): value is BusinessErrorData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BusinessErrorData).code === 'string' &&
    typeof (value as BusinessErrorData).message === 'string'
  );
}

/** 找不到记录。 */
export function notFound(what: string, id: string | number): BusinessError {
  return new BusinessError({ code: 'NOT_FOUND', message: `${what}不存在（${id}），可能已被删除` });
}
