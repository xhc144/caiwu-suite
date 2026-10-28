import Decimal from 'decimal.js';
import { ASSETS, LIABILITIES_EQUITY, PROFIT, CASHFLOW, type Line } from './lines';
import { EQUITY, EQUITY_LABELS } from './equity-lines';
import { EQUITY_COLUMNS, type EnterpriseResult, type Values } from './model';
export type OutputCell = { value: string; amount?: boolean; eps?: boolean; bold?: boolean };
export type OutputPage = {
  title: string;
  period: string;
  orgName: string;
  landscape: boolean;
  headers: string[];
  rows: OutputCell[][];
};
const cell = (value: string, amount = false, bold = false, eps = false): OutputCell => ({
  value,
  amount,
  bold,
  eps,
});
function amount(v: Values, key: string) {
  return (
    v[key] ??
    (() => {
      throw new Error(`输出缺少金额项目${key}`);
    })()
  );
}
export function enterprisePages(r: EnterpriseResult): OutputPage[] {
  if (r.checks.some((c) => c.difference !== '0'))
    throw new Error('报表存在勾稽差额，请核实后重新生成再导出或打印');
  const pages: OutputPage[] = [],
    base = { orgName: r.orgName, landscape: false };
  const periodLabel = (value: string) =>
    r.comparison?.reason ? `${value}；${r.comparison.reason}` : value;
  const chunks = <T>(rows: T[], size: number) =>
    Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
      rows.slice(i * size, (i + 1) * size),
    );
  const balanceRows = Array.from(
    { length: Math.max(ASSETS.length, LIABILITIES_EQUITY.length) },
    (_, i) =>
      [ASSETS[i], LIABILITIES_EQUITY[i]].flatMap((l) =>
        l
          ? [
              cell(l.label, false, !!l.total || !!l.section),
              l.section ? cell('') : cell(amount(r.balance.current, l.key), true, !!l.total),
              l.section ? cell('') : cell(amount(r.balance.previous, l.key), true, !!l.total),
            ]
          : [cell(''), cell(''), cell('')],
      ),
  );
  for (const [i, rows] of chunks(balanceRows, 20).entries())
    pages.push({
      ...base,
      title: `资产负债表 · ${i + 1}`,
      period: periodLabel(`${r.period}期末；比较日${r.ranges.balancePrevious}`),
      headers: [
        '资产',
        '期末余额',
        r.comparison?.balance === 'unavailable' ? '上年年末余额（无来源）' : '上年年末余额',
        '负债和所有者权益',
        '期末余额',
        r.comparison?.balance === 'unavailable' ? '上年年末余额（无来源）' : '上年年末余额',
      ],
      rows,
    });
  for (const [name, lines, values] of [
    ['利润表', PROFIT, r.profit],
    ['现金流量表', CASHFLOW, r.cashflow],
  ] as const) {
    const rows = lines.map((l) => [
      cell(l.label, false, !!l.total || !!l.section),
      ...(['current', 'previous'] as const).map((col) =>
        l.section
          ? cell('')
          : cell(
              amount(values[col], l.key),
              true,
              !!l.total,
              ['basicEps', 'dilutedEps'].includes(l.key),
            ),
      ),
    ]);
    if (name === '现金流量表')
      rows.push([
        cell('其中：限制及解除现金流（已计入上述活动）'),
        cell(r.cashflow.current.cashScopeChange!, true),
        cell(r.cashflow.previous.cashScopeChange!, true),
      ]);
    for (const [i, part] of chunks(rows, 22).entries())
      pages.push({
        ...base,
        title: `${name} · ${i + 1}`,
        period: periodLabel(
          `${r.ranges.current.from}—${r.ranges.current.to}；比较${r.ranges.previous.from}—${r.ranges.previous.to}`,
        ),
        headers: [
          '项目',
          r.ranges.current.label,
          r.comparison?.flow === 'unavailable'
            ? `${r.ranges.previous.label}（无完整比较来源）`
            : r.ranges.previous.label,
        ],
        rows: part,
      });
  }
  if (r.scope === 'annual')
    for (const col of ['current', 'previous'] as const) {
      const keys = [...EQUITY_COLUMNS, 'total'];
      for (const [i, group] of chunks(keys, 4).entries())
        pages.push({
          ...base,
          landscape: true,
          title: `所有者权益变动表 · ${col === 'current' ? '本年' : '上年'}金额 · 第${i + 1}组`,
          period: periodLabel(`${Math.floor(r.ranges[col].to / 100)}年度`),
          headers: ['项目', ...group.map((k) => EQUITY_LABELS[keys.indexOf(k)]!)],
          rows: EQUITY.map((l) => [
            cell(l.label, false, !!l.total),
            ...group.map((k) => cell(amount(r.equity[col][l.key]!, k), true, !!l.total)),
          ]),
        });
    }
  return pages;
}
const DisplayDecimal = Decimal.clone({ precision: 40 });
export function displayEnterpriseCell(c: OutputCell) {
  if (!c.amount || c.value === '不适用') return c.value;
  return c.eps
    ? new DisplayDecimal(c.value).toFixed(4)
    : new DisplayDecimal(c.value).div(100).toFixed(2);
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function enterprisePrintHtml(
  r: EnterpriseResult,
  selection?: 'balance' | 'profit' | 'cashflow' | 'equity',
) {
  const names = {
    balance: '资产负债表',
    profit: '利润表',
    cashflow: '现金流量表',
    equity: '所有者权益变动表',
  };
  const pages = enterprisePages(r).filter(
    (p) => !selection || p.title.startsWith(names[selection]),
  );
  if (!pages.length) throw new Error('所选报表没有可打印的成功结果');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>@page portrait{size:A4 portrait;margin:12mm}@page landscape{size:A4 landscape;margin:10mm}body{margin:0;font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:10pt;line-height:1.25}.sheet{page:portrait;break-after:page}.sheet:last-child{break-after:auto}.wide{page:landscape}h1{text-align:center;font-size:15pt;margin:3mm 0}p{margin:2mm 0}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:0.2mm solid #555;padding:1.2mm;overflow-wrap:anywhere}th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}td.money{text-align:right;font-variant-numeric:tabular-nums}table.balance th:nth-child(3n+1){width:24%}table:not(.balance) th:first-child{width:44%}.wide table th:first-child{width:36%}.wide{line-height:1.15}.wide td{padding:.45mm}.foot{font-size:8pt}</style></head><body>${pages.map((p) => `<section class="sheet ${p.landscape ? 'wide' : ''}"><h1>${escape(p.title)}</h1><p>编制单位：${escape(p.orgName)} ${escape(p.period)} 单位：元</p><table class="${p.headers.length === 6 ? 'balance' : ''}"><thead><tr>${p.headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${p.rows.map((row) => `<tr>${row.map((c) => `<td class="${c.amount ? 'money' : ''}"${c.bold ? ' style="font-weight:bold"' : ''}>${escape(displayEnterpriseCell(c))}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="foot">仅已过账口径；2019年一般企业财务报表格式附件2。${p.landscape ? '本组与其余权益列分组共同组成完整矩阵。' : ''}</p></section>`).join('')}</body></html>`;
}
export const enterpriseLineDefinitions: Record<string, Line[]> = {
  balance: [...ASSETS, ...LIABILITIES_EQUITY],
  profit: PROFIT,
  cashflow: CASHFLOW,
  equity: EQUITY,
};
