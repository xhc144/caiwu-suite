import { BusinessError, levelOfCode, parentCodeOf, periodOfDate } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { CheckItem } from '../shared';
import { checkedCents, exactCents, sumCents } from './amounts';
import { foreignAmountIssues, referenceIssues } from './references';

type CheckLine = {
  period: number;
  account_id: number;
  line_no: number;
  debit: number;
  credit: number;
};

/** 可检查损坏快照，不需要为了验证错误而绕过凭证写入服务。 */
export function voucherIssues(
  header: { period: number; debit_total: number; credit_total: number },
  lines: readonly CheckLine[],
  accountIds: ReadonlySet<number>,
): string[] {
  let amountIssues: string[];
  try {
    exactCents(header.debit_total);
    exactCents(header.credit_total);
    const debit = sumCents(lines.map((line) => line.debit));
    const credit = sumCents(lines.map((line) => line.credit));
    amountIssues = [
      debit !== credit ? `借贷不平，差额 ${exactCents(debit) - exactCents(credit)} 分` : '',
      debit !== header.debit_total || credit !== header.credit_total
        ? '凭证头合计与分录不一致'
        : '',
    ].filter(Boolean);
  } catch (error) {
    if (!(error instanceof BusinessError)) throw error;
    amountIssues = ['金额不是安全整数分或合计溢出'];
  }
  return [
    lines.length < 2 ? '少于两行分录' : '',
    ...amountIssues,
    lines.some((line) => line.period !== header.period) ? '凭证头与分录期间不一致' : '',
    lines.some((line) => !accountIds.has(line.account_id)) ? '分录科目不存在' : '',
    new Set(lines.map((line) => line.line_no)).size !== lines.length ? '分录行号重复' : '',
  ].filter(Boolean);
}

export async function runChecks(svc: CoreServices): Promise<CheckItem[]> {
  const rows: CheckItem[] = [];
  const add = (
    category: string,
    status: CheckItem['status'],
    target: string,
    message: string,
    suggestion: string,
    to?: string,
  ) =>
    rows.push({ id: String(rows.length + 1), category, status, target, message, suggestion, to });
  const book = await svc.book.info();
  const accounts = await svc.accounts.list();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const items = await svc.db
    .selectFrom('dimension_item')
    .select(['id', 'type_id', 'is_leaf'])
    .execute();
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const currencies = new Set((await svc.reference.currencies()).map((c) => c.code));
  if (!accounts.length)
    add('科目', '无数据', '科目表', '没有科目数据', '在基础档案建立科目', '/m/masterdata/accounts');
  for (const a of accounts) {
    const level = levelOfCode(a.code, book.codeScheme);
    const parentCode = level ? parentCodeOf(a.code, book.codeScheme) : null;
    const parent = a.parentId == null ? null : accountMap.get(a.parentId);
    const leaf = !accounts.some((c) => c.parentId === a.id);
    const issues = [
      level == null || level !== a.level ? '编码长度或级次不符合账套方案' : '',
      parentCode !== (parent?.code ?? null) ? '上级科目缺失或父级不正确' : '',
      leaf !== a.isLeaf ? '末级标志与实际下级不一致' : '',
    ].filter(Boolean);
    add(
      '科目',
      issues.length ? '不通过' : '通过',
      `${a.code} ${a.name}`,
      issues.join('；') || '编码、级次、父级与末级标志一致',
      issues.length ? '核对基础档案，勿直接改有业务引用的编码' : '无需处理',
      '/m/masterdata/accounts',
    );
  }
  const periods = await svc.periods.list();
  const pm = new Map(periods.map((p) => [p.period, p]));
  const openings = await svc.db.selectFrom('opening_balance').selectAll().execute();
  for (const year of new Set(periods.map((p) => p.year))) {
    const os = openings.filter((o) => o.year === year);
    let diff: number;
    try {
      diff = sumCents(os.map((o) => o.balance));
    } catch (error) {
      if (!(error instanceof BusinessError)) throw error;
      add(
        '期初试算',
        '无法检查',
        `${year} 年`,
        error.data.message,
        '请分范围核对期初科目及辅助余额',
        `/m/opening?year=${year}`,
      );
      continue;
    }
    add(
      '期初试算',
      !os.length ? '无数据' : diff === 0 ? '通过' : '不通过',
      `${year} 年`,
      !os.length ? '本年度无已存储期初；可能由前期结转推算' : `期初借正贷负合计 ${diff} 分`,
      diff ? '核对期初科目及辅助余额' : '核对年度期初来源',
      `/m/opening?year=${year}`,
    );
  }
  for (const o of openings)
    if (!accountMap.has(o.account_id))
      add(
        '期初科目',
        '不通过',
        `${o.year} 年科目 ID ${o.account_id}`,
        '期初引用不存在的科目',
        '联系管理员检查档案和备份',
        '/m/opening',
      );
    else {
      const issues = referenceIssues(o, accountMap.get(o.account_id)!, itemMap, currencies, {
        opening: true,
      });
      for (const value of [o.balance, o.ytd_debit, o.ytd_credit, o.fc_balance])
        if (!Number.isSafeInteger(value)) {
          issues.push('期初金额或累计发生额不是安全整数分');
          break;
        }
      if (o.fc_balance !== 0 && (!o.currency_code || !accountMap.get(o.account_id)!.currency))
        issues.push('外币余额缺少对应的科目币种');
      add(
        '期初核算项',
        issues.length ? '不通过' : '通过',
        `${o.year} 年 / ${accountMap.get(o.account_id)!.code} / 期初 ID ${o.id}`,
        issues.join('；') || '辅助项、币种、整数分与数量字段一致',
        issues.length ? '核对原始期初及档案；检查不会自动修改数据' : '无需处理',
        `/m/opening?year=${o.year}`,
      );
    }
  const vouchers = await svc.db
    .selectFrom('voucher')
    .select([
      'id',
      'period',
      'voucher_type_id',
      'number',
      'date',
      'status',
      'voided',
      'debit_total',
      'credit_total',
    ])
    .orderBy('period')
    .orderBy('number')
    .execute();
  const lines = await svc.db.selectFrom('voucher_line').selectAll().execute();
  const vm = new Map(vouchers.map((v) => [v.id, v]));
  const grouped = new Map<number, typeof lines>();
  for (const l of lines) {
    const group = grouped.get(l.voucher_id) ?? [];
    group.push(l);
    grouped.set(l.voucher_id, group);
    if (!vm.has(l.voucher_id))
      add('凭证头行', '不通过', `分录 ID ${l.id}`, '分录不存在对应凭证头', '联系管理员从备份核查');
  }
  if (!vouchers.length)
    add('凭证', '无数据', '凭证表', '没有凭证，不表示账套损坏', '有业务后再检查');
  for (const v of vouchers) {
    const ls = grouped.get(v.id) ?? [];
    const errors = voucherIssues(v, ls, new Set(accountMap.keys()));
    const to = `/m/voucher-entry/edit?id=${v.id}`,
      label = `${v.period} / 类型 ${v.voucher_type_id} / ${v.number ?? '草稿'}（ID ${v.id}）`;
    add(
      '凭证借贷及头行',
      errors.length ? '不通过' : '通过',
      label,
      errors.join('；') || '借贷与头行合计一致',
      errors.length ? '打开凭证核查；已审核凭证先依流程处理' : '无需处理',
      to,
    );
    for (const l of ls)
      if (l.debit === 0 && l.credit === 0)
        add(
          '零额行',
          '不通过',
          `${label} 第 ${l.line_no} 行`,
          '借贷均为零',
          '检查该行业务内容',
          to,
        );
    for (const l of ls) {
      const account = accountMap.get(l.account_id);
      if (!account) continue; // 科目不存在已由头行检查单独定位。
      const issues = [
        ...referenceIssues(l, account, itemMap, currencies, {
          opening: false,
          draft: v.status === 'draft',
        }),
        ...foreignAmountIssues(l, account, v.status === 'draft'),
        l.debit !== 0 && l.credit !== 0 ? '同一行同时有借方和贷方金额' : '',
        account.quantityUnit && l.quantity_e6 == null && v.status !== 'draft'
          ? '数量科目缺少数量'
          : '',
      ].filter(Boolean);
      add(
        '分录核算项',
        issues.length ? '不通过' : '通过',
        `${label} 第 ${l.line_no} 行`,
        issues.join('；') || '辅助项、币种、汇率与数量字段一致',
        issues.length ? '核对原始单据及科目设置；已审核或来源凭证应按原业务流程处理' : '无需处理',
        to,
      );
    }
    const p = pm.get(v.period);
    if (
      !p ||
      v.period < book.startPeriod ||
      periodOfDate(v.date) !== v.period ||
      (p.status === 'closed' && v.status !== 'posted' && !v.voided)
    )
      add(
        '异常期间',
        '不通过',
        label,
        '期间不存在、早于启用、日期不匹配或已结账仍有未过账凭证',
        '核对期间及凭证日期',
        '/m/period-close',
      );
    if (!v.voided && v.status !== 'posted')
      add(
        '未审核/未过账',
        '不通过',
        label,
        v.status === 'audited'
          ? '已审核未过账'
          : v.status === 'draft'
            ? '草稿未完成'
            : '待审核未过账',
        '在凭证管理处理',
        `/m/voucher-book?period=${v.period}&type=${v.voucher_type_id}&status=${v.status}`,
      );
  }
  const sequences = new Map<string, number[]>();
  for (const v of vouchers)
    if (v.number != null) {
      const key = `${v.period}/${v.voucher_type_id}`;
      const ns = sequences.get(key) ?? [];
      ns.push(v.number);
      sequences.set(key, ns);
    }
  for (const [key, ns] of sequences) {
    const unique = [...new Set(ns)].sort((a, b) => a - b);
    const gaps: string[] = [];
    let next = 1;
    for (const n of unique) {
      if (n > next) gaps.push(next === n - 1 ? `${next}` : `${next}–${n - 1}`);
      next = n + 1;
    }
    add(
      '断号',
      gaps.length || unique.length !== ns.length ? '不通过' : '通过',
      key,
      gaps.length
        ? `缺号 ${gaps.join('、')}`
        : unique.length !== ns.length
          ? '存在重复编号'
          : '编号从 1 连续',
      '如需整理编号，请在凭证管理确认影响',
      `/m/voucher-book?period=${key.split('/')[0]}&type=${key.split('/')[1]}`,
    );
  }
  const movements = new Map<string, { debit: bigint; credit: bigint }>();
  const postedPeriods = new Set<number>();
  const invalidMovements = new Set<string>();
  for (const line of lines) {
    const header = vm.get(line.voucher_id);
    if (header?.status !== 'posted' || header.voided) continue;
    postedPeriods.add(line.period);
    const key = `${line.period}/${line.account_id}`;
    const sum = movements.get(key) ?? { debit: 0n, credit: 0n };
    try {
      sum.debit += exactCents(line.debit);
      sum.credit += exactCents(line.credit);
      movements.set(key, sum);
    } catch (error) {
      if (!(error instanceof BusinessError)) throw error;
      invalidMovements.add(key);
    }
  }
  for (const p of periods) {
    if (
      p.period !== p.year * 100 + p.month ||
      p.startDate.slice(0, 7) !== `${p.year}-${String(p.month).padStart(2, '0')}` ||
      p.period < book.startPeriod
    )
      add(
        '期间结构',
        '不通过',
        String(p.period),
        '期间年月或起始日期不一致',
        '联系管理员核对期间',
        '/m/period-close',
      );
    try {
      const balances = await svc.ledger.balances({
        periodFrom: p.period,
        periodTo: p.period,
        rollup: false,
        includeZero: true,
      });
      const mismatch = balances.filter((b) => {
        const key = `${p.period}/${b.accountId}`;
        if (invalidMovements.has(key)) return true;
        const sum = movements.get(key) ?? { debit: 0n, credit: 0n };
        try {
          const debit = checkedCents(sum.debit);
          const credit = checkedCents(sum.credit);
          const closing = checkedCents(exactCents(b.opening) + sum.debit - sum.credit);
          return b.debit !== debit || b.credit !== credit || b.closing !== closing;
        } catch (error) {
          if (!(error instanceof BusinessError)) throw error;
          return true;
        }
      });
      for (const b of mismatch)
        add(
          '余额与凭证取数',
          '不通过',
          `${p.period} / ${b.accountCode}`,
          '余额发生额或期末与已过账分录不一致',
          '核对分录与期初数据',
          `/m/voucher-book?period=${p.period}`,
        );
      if (!mismatch.length)
        add(
          '余额与凭证取数',
          postedPeriods.has(p.period) ? '通过' : '无数据',
          String(p.period),
          '核对已过账、未作废分录与余额发生额及期末；余额借正贷负',
          '本项不包含草稿、待审核和已审核未过账凭证',
        );
    } catch {
      add(
        '余额与凭证取数',
        '无法检查',
        String(p.period),
        '核心余额查询未能完成',
        '先核对年度期初来源及科目，再重新检查',
        '/m/opening',
      );
    }
  }
  add(
    '自动修复/开账日期调整',
    '无法检查',
    '当前账套',
    '未开放破坏性修复和开账日期调整',
    '需完整在线备份及恢复校验、破坏性独占维护、强确认及核心原子服务后再开放',
  );
  return rows;
}
