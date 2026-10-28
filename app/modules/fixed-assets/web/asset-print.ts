import { escapeHtml as e, wrapPrintText, type PrintJob } from '@caiwu/print';
import { formatMoney, qtyFromE6 } from '@caiwu/core';
import { AssetPrintSettingsSchema, type AssetPrintSettings } from '../shared';
import type { Outputs } from './api';

type Row = Outputs['reports']['rows'][number];
const money = (n: number) => e(formatMoney(n));

/** Dedicated asset subledger/register pages, with carry-forward values at every page boundary. */
export function assetReportPrint(
  result: Outputs['reports'],
  kind: 'ledger' | 'register',
  context: { unit: string; cutoff: string; year: number },
  raw?: AssetPrintSettings,
): PrintJob {
  if (!result.rows.length) throw new Error('没有记录，无法打印及预览');
  const layout = AssetPrintSettingsSchema.parse(raw ?? {}),
    pages: { code: string; rows: Row[]; carry: Row | null }[] = [];
  const groups = new Map<string, Row[]>();
  for (const row of result.rows) {
    const list = groups.get(row.code) ?? [];
    list.push(row);
    groups.set(row.code, list);
  }
  const lineBudget = Math.min(layout.rowsPerPage, layout.pageSize === 'B5' ? 18 : 26);
  for (const [code, rows] of groups) {
    let current: Row[] = [],
      height = 0,
      carry: Row | null = null;
    for (const row of rows) {
      const needed = Math.max(
        1,
        wrapPrintText(row.description, 70, 10).length,
        wrapPrintText(row.name, 60, 10).length,
      );
      if (current.length && height + needed > lineBudget) {
        pages.push({ code, rows: current, carry });
        carry = current.at(-1)!;
        current = [];
        height = 0;
      }
      current.push(row);
      height += needed;
    }
    if (current.length) pages.push({ code, rows: current, carry });
  }
  const ink = layout.color === 'color' ? '#164b82' : '#000';
  const content = pages
    .map((page, index) => {
      const first = page.rows[0]!,
        last = page.rows.at(-1)!;
      const headings =
        kind === 'ledger'
          ? ['日期', '摘要', '原值增减', '折旧增减', '原值余额', '累计折旧', '净值']
          : ['使用日期', '设备名称 / 规格', '数量', '资产原值', '累计折旧', '净值', '部门'];
      const cells = (r: Row) =>
        kind === 'ledger'
          ? [
              e(r.date),
              e(r.description),
              money(r.originalChange),
              money(r.depreciationChange),
              money(r.original),
              money(r.depreciation),
              money(r.net),
            ]
          : [
              e(r.date),
              `${e(r.name)}<br>${e(r.description)}`,
              e(r.quantity),
              money(r.original),
              money(r.depreciation),
              money(r.net),
              e(r.department),
            ];
      return `<section class="asset-print-page${index < pages.length - 1 ? ' cw-page-break' : ''}">
      ${layout.ruler ? '<div class="asset-ruler">0  20  40  60  80  100  120  140  160 mm</div>' : ''}
      <div class="asset-print-content" style="font-size:${(10 * layout.scale) / 100}px">
      <h2>${e(kind === 'ledger' ? '固定资产明细账' : '固定资产台账')}</h2>
      <p>单位：${e(context.unit)} 年度：${context.year} 截止：${e(context.cutoff)} 金额单位：元</p>
      <p>设备编号：${e(page.code)} 设备名称：${e(first.name)} 类别：${e(first.category)}</p>
      <table><thead><tr>${headings.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${page.carry && kind === 'ledger' ? `<tr><td></td><td>承前页</td><td></td><td></td><td>${money(page.carry.original)}</td><td>${money(page.carry.depreciation)}</td><td>${money(page.carry.net)}</td></tr>` : ''}
      ${page.rows
        .map(
          (r) =>
            `<tr>${cells(r)
              .map((c) => `<td>${c}</td>`)
              .join('')}</tr>`,
        )
        .join('')}
      ${kind === 'ledger' ? `<tr><td colspan="4">${index + 1 < pages.length && pages[index + 1]?.code === page.code ? '过次页' : '本设备期末余额'}</td><td>${money(last.original)}</td><td>${money(last.depreciation)}</td><td>${money(last.net)}</td></tr>` : ''}
      </tbody></table><p>主管：        复核：        制表：</p>
      <p>第 ${index + 1} / ${pages.length} 页</p></div></section>`;
    })
    .join('');
  return {
    title: kind === 'ledger' ? '固定资产明细账' : '固定资产台账',
    pageSize: layout.pageSize,
    orientation: 'portrait',
    marginMm: 10,
    css: `.asset-print-page{box-sizing:border-box;color:${ink};print-color-adjust:exact}.asset-print-content{overflow-wrap:anywhere}.asset-print-content table{table-layout:fixed;width:100%;font-size:inherit}.asset-print-content th,.asset-print-content td{padding:2mm 1mm;border:1px solid currentColor;white-space:normal;overflow-wrap:anywhere}.asset-print-content th:nth-child(2){width:32%}.asset-ruler{font-size:8px;border-bottom:1px solid #999}h2{text-align:center;font-size:1.6em}p{line-height:1.5}`,
    html: content,
  };
}

export function assetCardPrint(
  detail: Outputs['detail'],
  names: { category: string; status: string; purpose: string; department: string; unit: string },
): PrintJob {
  const c = detail.card;
  const field = (name: string, value: unknown) =>
    `<tr><th>${e(name)}</th><td>${e(value)}</td></tr>`;
  const fields = [
    ['设备编号', c.code],
    ['设备名称', c.name],
    ['参考编号', c.reference],
    ['制造厂', c.manufacturer],
    ['安装地点', c.installation],
    ['制造日期', c.manufactured ?? ''],
    ['本机编号', c.machine_code],
    ['保管人', c.custodian],
    ['币种', c.currency_code],
    ['外币原值', c.foreign_original],
    ['类别', names.category],
    ['状态', c.disposal_date ? '已注销' : names.status],
    ['使用部门', names.department],
    ['用途', names.purpose],
    ['购置日期', c.acquired],
    ['使用日期', c.use_date],
    ['规格型号', c.model],
    ['数量 / 单位', `${qtyFromE6(c.quantity_e6)} ${c.unit}`],
    ['原值（元）', formatMoney(c.original)],
    ['预计残值（元）', formatMoney(c.residual)],
    ['累计折旧（元）', formatMoney(c.depreciation)],
    ['净值（元）', formatMoney(c.original - c.depreciation)],
    ['折旧方法', c.method === '1' ? '平均年限法' : '工作量法'],
    ['使用年限（月）', c.life_months],
    ['累计月数', c.months],
    ['总工作量', qtyFromE6(c.total_work_e6)],
    ['累计工作量', qtyFromE6(c.work_e6)],
  ];
  const paired = [];
  for (let i = 0; i < fields.length; i += 2) {
    const a = fields[i]!,
      b = fields[i + 1];
    paired.push(
      `<tr><th>${e(a[0])}</th><td>${e(a[1])}</td><th>${e(b?.[0])}</th><td>${e(b?.[1])}</td></tr>`,
    );
  }
  return {
    title: `资产卡片 ${c.code}`,
    pageSize: 'A4',
    orientation: 'portrait',
    marginMm: 12,
    css: 'table{table-layout:fixed;width:100%;font-size:11px}th,td{padding:2mm;border:1px solid #555;overflow-wrap:anywhere}th{width:20%}h2{text-align:center}',
    html: `<h2>固定资产卡片</h2><p>单位：${e(names.unit)} 设备编号：${e(c.code)}</p><table>${paired.join('')}</table>
      ${detail.accessories.length ? `<h3>附属设备</h3><table><thead><tr><th>编号</th><th>名称</th><th>数量</th><th>单价（元）</th><th>金额（元）</th></tr></thead><tbody>${detail.accessories.map((a) => `<tr><td>${e(a.code)}</td><td>${e(a.name)}</td><td>${e(a.quantity)}</td><td>${e(a.unit_price)}</td><td>${money(a.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${c.disposal_date ? `<table>${field('注销日期', c.disposal_date)}</table>` : ''}<p>保管：        复核：        制表：</p>`,
  };
}
