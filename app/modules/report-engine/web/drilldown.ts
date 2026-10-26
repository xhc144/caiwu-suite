import { zPeriod } from '@caiwu/core';
import { BALANCE_ARGUMENTS, BalanceFunctionSchema } from '../shared';

type Drilldown =
  | { kind: 'none' }
  | { kind: 'blocked'; reason: string }
  | {
      kind: 'link';
      href: string;
      account: string;
      from: number;
      to: number;
      includeUnposted: boolean;
    };

/** 仅识别可完整表达的直接取数调用；不计算公式，也不猜测组合式中的实际取数范围。 */
export function balanceDrilldown(
  source: string,
  period: number,
  startPeriod: number,
  includeUnposted: boolean,
): Drilldown {
  if (!/\bBALANCE\s*\(/i.test(source)) return { kind: 'none' };
  const blocked = (reason: string): Drilldown => ({ kind: 'blocked', reason });
  const call = /^=?\s*BALANCE\s*\(([\s\S]*)\)\s*$/i.exec(source.trim());
  if (!call)
    return blocked(
      '该格包含组合运算，不能把其中一次取数当成整个公式的明细范围；请返回定义逐项核查。',
    );
  let args: unknown;
  try {
    args = JSON.parse(`[${call[1]}]`);
  } catch {
    return blocked('无法确认该公式的完整取数口径，暂不提供明细穿透；请返回定义核查。');
  }
  if (!Array.isArray(args)) return blocked('无法确认取数参数，暂不提供明细穿透。');
  if (args.length === 8)
    return blocked(
      '该格使用扩展 options；当前明细入口不能完整表达其跨期、结转排除、余额分向或分组口径，已暂停穿透，避免显示不一致的明细。',
    );
  if (args.length !== 7 || args.some((arg) => typeof arg !== 'string'))
    return blocked('该格不是可确认口径的单次七参数取数，已暂停明细穿透。');
  const parsed = BalanceFunctionSchema.safeParse(
    Object.fromEntries(BALANCE_ARGUMENTS.map((key, index) => [key, args[index]])),
  );
  if (!parsed.success) return blocked('该格取数参数无法按当前合同确认，已暂停明细穿透。');
  const input = parsed.data;
  if (input.dimension !== 'none')
    return blocked(
      '该格按辅助项取数，当前入口尚不能完整携带辅助项条件，已暂停穿透，避免展示整个科目的明细。',
    );
  if (input.unit !== 'cents')
    return blocked('该格使用外币或数量单位，当前入口尚不能保证同单位展示，已暂停明细穿透。');
  if (
    !zPeriod.safeParse(period).success ||
    !zPeriod.safeParse(startPeriod).success ||
    period < startPeriod
  )
    return blocked('结果期间或账套启用期间不正确，已暂停明细穿透。');
  const from = ['ytdDebit', 'ytdCredit'].includes(input.metric)
    ? Math.max(startPeriod, Math.floor(period / 100) * 100 + 1)
    : period;
  const query = new URLSearchParams({
    account: input.account,
    from: String(from),
    to: String(period),
  });
  if (includeUnposted) query.set('includeUnposted', '1');
  return {
    kind: 'link',
    href: `/m/ledgers/detail?${query}`,
    account: input.account,
    from,
    to: period,
    includeUnposted,
  };
}
