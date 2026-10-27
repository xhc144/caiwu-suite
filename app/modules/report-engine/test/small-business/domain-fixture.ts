import type { BalanceRow, EntryRow } from '@caiwu/core';
import {
  initialConfiguration,
  roles,
  entrySignature,
  type Role,
} from '../../templates/small-business/configuration';
import type { DomainData } from '../../templates/small-business/statements';
export function balanceRow(
  accountCode: string,
  value: number,
  partner: number | null = null,
): BalanceRow {
  return {
    accountId: Number(accountCode),
    accountCode,
    accountName: accountCode,
    level: 1,
    isLeaf: true,
    direction: 'debit',
    dimensions: { partner },
    opening: value,
    closing: value,
    debit: 0,
    credit: 0,
    ytdDebit: 0,
    ytdCredit: 0,
    fcOpening: 0,
    fcClosing: 0,
    fcDebit: 0,
    fcCredit: 0,
    qtyOpening: '0',
    qtyClosing: '0',
    qtyDebit: '0',
    qtyCredit: '0',
  };
}
export function entry(code: string, value: number, id: number, period = 202601): EntryRow {
  return {
    voucherId: id,
    lineId: id,
    period,
    date: `${Math.floor(period / 100)}-${String(period % 100).padStart(2, '0')}-05`,
    voucherTypeCode: '记',
    number: id,
    displayNo: `记-${id}`,
    status: 'posted',
    lineNo: 1,
    summary: '合成业务',
    accountId: Number(code),
    accountCode: code,
    dimensions: {},
    currency: null,
    exchangeRate: null,
    fcAmount: null,
    quantity: null,
    unitPrice: null,
    debit: value > 0 ? value : 0,
    credit: value < 0 ? -value : 0,
    refNo: null,
    sourceModule: null,
  };
}
export function domain(): DomainData {
  return {
    accounts: [],
    roles: new Map(),
    closing: [],
    opening: [],
    current: [],
    comparison: [],
    unclosed: [],
    unclosedOpening: [],
    scopes: [
      { from: 202601, to: 202612, label: '本年累计' },
      { from: 202612, to: 202612, label: '本月' },
    ],
    period: 202612,
    mode: 'monthly',
    config: initialConfiguration('synthetic'),
    closingKinds: new Map(),
  };
}
export function addBalance(
  d: DomainData,
  role: Role,
  value: number,
  partner: number | null = null,
  code?: string,
) {
  const c = code ?? String(8000 + Object.keys(roles).indexOf(role));
  d.roles.set(c, role);
  const r = balanceRow(c, value, partner);
  d.closing.push(r);
  d.opening.push({ ...r });
  return r;
}
export function classify(d: DomainData, e: EntryRow, parts: { line: number; amount: number }[]) {
  d.config.cashAllocations[String(e.lineId)] = {
    signature: entrySignature(e, d.current),
    reason: '合成业务手工确认',
    parts,
  };
}
