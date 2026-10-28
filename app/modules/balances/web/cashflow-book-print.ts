import { formatMoney, sumCents } from '@caiwu/core';
import { escapeHtml, wrapPrintText, type PrintJob } from '@caiwu/print';
import {
  cashflowCaption,
  cashflowRows,
  type CashflowReport,
  type CashflowSettings,
} from '../cashflow';
import { cashflowSummary } from './cashflow-output';
import { printCents, printText } from './print-text';
const money = (amount: number) => formatMoney(amount, { thousands: false });

/** 现金流量账册：核对、项目汇总和凭证/科目分册使用同一份查询快照。 */
export function buildCashflowPrintJob(
  report: CashflowReport,
  display: CashflowSettings['display'],
  continuous = false,
): PrintJob {
  const pages: string[] = [];
  const caption = wrapPrintText(cashflowCaption(report), 277, 8);
  const notes = wrapPrintText(
    `顶部核对包含所选科目全部项目；互转不计对外收付；未分配 ${report.totals.unallocatedCount} 行。分录净额累计按日期计算，承前页和过次页为已列行收付累计。`,
    277,
    8,
  );
  const addPages = (
    title: string,
    headings: string[],
    records: { key: string; values: string[] }[],
    widths: number[],
    carry?: (before: number, label: string) => string[],
  ) => {
    const rows = records.length
      ? records
      : [{ key: 'empty', values: headings.map((_, i) => (i === 0 ? '无发生额' : '')) }];
    const numeric = (index: number) =>
      /金额|流入|流出|净额|差额|收款|付款|日期/.test(headings[index]!);
    const visual = rows.flatMap((row, index) => {
      const cells = row.values.map((text, i) => printText(text, widths[i]!, 8, numeric(i)).lines);
      return Array.from(
        { length: Math.max(...cells.map((cell) => cell.length)) },
        (_, fragment) => ({ row, index, cells, fragment }),
      );
    });
    const capacity = Math.min(20, Math.floor((174 - (caption.length + notes.length) * 4 - 41) / 5));
    if (capacity < 1) throw new Error('现金流量打印页眉过长，请缩短账套名称或科目范围说明');
    const carryRow = (before: number, label: string) => {
      if (!carry || before <= 0) return '';
      const fitted = carry(before, label).map((text, i) =>
        printText(text, widths[i]!, 7, numeric(i)),
      );
      const cells = fitted.map((cell) => cell.lines);
      return Array.from(
        { length: Math.max(...cells.map((cell) => cell.length)) },
        (_, part) =>
          `<tr class="cashflow-carry">${cells.map((cell, i) => `<td style="font-size:${fitted[i]!.fontSize}pt">${escapeHtml(cell[part] ?? '')}</td>`).join('')}</tr>`,
      ).join('');
    };
    for (let offset = 0; offset < visual.length; offset += capacity) {
      const chunk = visual.slice(offset, offset + capacity);
      const last = chunk.at(-1)!;
      const after = last.index + 1;
      pages.push(
        `<article class="print-sheet"><section class="cashflow-sheet" data-page="${pages.length + 1}"><h2>${escapeHtml(title)}</h2>${caption.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${notes.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}<table><colgroup>${widths.map((width) => `<col style="width:${width}mm">`).join('')}</colgroup><thead><tr>${headings.map((text) => `<th>${escapeHtml(text)}</th>`).join('')}</tr></thead><tbody>${offset ? carryRow(chunk[0]!.index + (chunk[0]!.fragment > 0 ? 1 : 0), '承前页') : ''}${chunk.map((r) => `<tr data-line="${escapeHtml(r.row.key)}" data-fragment="${r.fragment}">${r.cells.map((cell, i) => `<td style="font-size:${printText(r.row.values[i]!, widths[i]!, 8, numeric(i)).fontSize}pt">${escapeHtml(cell[r.fragment] ?? '')}</td>`).join('')}</tr>`).join('')}${offset + capacity < visual.length ? carryRow(after, '过次页') : ''}</tbody></table><footer>第 ${pages.length + 1} 页</footer></section></article>`,
      );
    }
  };
  addPages(
    '现金流量试算平衡表',
    ['核对项目', '金额（元）'],
    cashflowSummary(report).map(([label, amount]) => ({
      key: `summary:${label}`,
      values: [label, money(amount)],
    })),
    [177, 100],
  );
  addPages(
    '项目汇总',
    [
      '项目编码',
      '项目名称',
      '流入',
      '流出',
      '互转净额',
      '未分配差额',
      '本期净额',
      report.ytdComplete ? '本年流入' : '启用后流入',
      report.ytdComplete ? '本年流出' : '启用后流出',
      report.ytdComplete ? '本年净额' : '启用后净额',
    ],
    report.projects.map((p) => ({
      key: `project:${p.key}`,
      values: [
        p.code,
        p.name,
        ...[
          p.inflow,
          p.outflow,
          p.internalNet,
          p.unallocatedNet,
          p.cashNet,
          p.ytd.inflow,
          p.ytd.outflow,
          p.ytd.cashNet,
        ].map((value) => money(value)),
      ],
    })),
    [20, 45, ...Array<number>(8).fill(26.5)],
  );
  if (report.internalUnbalancedVouchers.length) {
    const names = new Map(report.rows.map((row) => [row.voucherId, row.displayNo]));
    addPages(
      '内部互转配平核对',
      ['凭证字号', '处理提示'],
      report.internalUnbalancedVouchers.map((id) => ({
        key: `diagnostic:${id}`,
        values: [
          names.get(id) ?? '所选范围外的关联凭证',
          '内部互转借贷未配平，请追查凭证核对项目和流向。',
        ],
      })),
      [50, 227],
    );
  }
  const groups = continuous
    ? report.projects.map((p) => ({ key: p.key, name: p.name }))
    : [{ key: '', name: '项目明细' }];
  const headings = [
    '日期',
    '凭证字号',
    '分录行',
    '摘要',
    '项目',
    '流向',
    '分配状态',
    '科目编码',
    '科目名称',
    '收款（借方）',
    '付款（贷方）',
    '本期净额累计',
  ];
  for (const group of groups) {
    let chronological = 0;
    const original = report.rows
      .filter((r) => !group.key || r.projectKey === group.key)
      .map((r) => {
        chronological = sumCents([chronological, r.debit, -r.credit]);
        return { ...r, runningNet: chronological };
      });
    const sorted = cashflowRows({ ...report, rows: original }, display.sort);
    const prefix = [{ debit: 0n, credit: 0n }];
    for (const row of sorted) {
      const old = prefix.at(-1)!;
      prefix.push({
        debit: old.debit + BigInt(row.debit),
        credit: old.credit + BigInt(row.credit),
      });
    }
    const bands = [
      {
        title: '凭证与收付',
        indices: [0, 1, 2, 3, 4, 5, 6, 9, 10, 11],
        widths: [18, 22, 8, 64, 50, 20, 20, 25, 25, 25],
      },
      ...(display.showAccount
        ? [
            {
              title: '科目与收付',
              indices: [0, 1, 2, 3, 7, 8, 9, 10, 11],
              widths: [18, 22, 8, 65, 20, 60, 28, 28, 28],
            },
          ]
        : []),
    ];
    for (const band of bands) {
      const records = sorted.map((r) => {
        const values = [
          r.date,
          r.displayNo,
          String(r.lineNo),
          r.summary,
          r.projectName,
          r.directionName,
          r.allocated ? '已分配' : '未分配',
          r.accountCode,
          r.accountName,
          money(r.debit),
          money(r.credit),
          money(r.runningNet),
        ];
        return { key: String(r.lineId), values: band.indices.map((index) => values[index]!) };
      });
      addPages(
        `${group.name} · ${band.title}`,
        band.indices.map((index) => headings[index]!),
        records,
        band.widths,
        (before, label) => {
          const total = prefix[before]!;
          return band.indices.map((index) =>
            index === 3
              ? `${label}（已列行）`
              : index === 9
                ? printCents(total.debit)
                : index === 10
                  ? printCents(total.credit)
                  : index === 11
                    ? printCents(total.debit - total.credit)
                    : '',
          );
        },
      );
    }
  }
  return {
    title: '现金流量试算平衡表',
    orientation: 'landscape',
    pageSize: 'A4',
    marginMm: 0,
    html: pages.join(''),
    css: 'body{font-size:8pt}.print-sheet{box-sizing:border-box;width:297mm;height:209.8mm;padding:10mm;break-after:page}.print-sheet:last-child{break-after:auto}.cashflow-sheet{width:277mm}h2{font-size:12pt;text-align:center;margin:0 0 2mm}p{white-space:pre;line-height:4mm;margin:0}th,td{white-space:pre;line-height:4mm;padding:.4mm 1mm;vertical-align:top}th{white-space:normal}tr{break-inside:avoid}.cashflow-carry{font-size:7pt}footer{text-align:right;line-height:5mm}',
  };
}
