import { Decimal } from 'decimal.js';
import type { EChartsOption } from 'echarts';
import { centsToYuan } from '@caiwu/core';
import { escapeHtml, type PrintJob } from '@caiwu/print';

export const CHART_KINDS = [
  { value: 'bar', label: '柱图' },
  { value: 'line', label: '折线图' },
  { value: 'pie', label: '饼图' },
] as const;
export type ChartKind = (typeof CHART_KINDS)[number]['value'];
export type ChartSnapshot = {
  title: string;
  description?: string;
  labels: string[];
  values: number[];
  kind: ChartKind;
  transposed: boolean;
};
export type ChartPrintColor = 'color' | 'monochrome';

export function chartDataProblem(labels: string[], values: number[]): string | null {
  if (labels.length !== values.length || !values.every(Number.isSafeInteger))
    return '图形数据不完整或数值超出可绘制范围，请重新查询';
  if (!values.length || values.every((v) => v === 0)) return '当前数据均为零或为空，请调整筛选条件';
  return null;
}

export function chartOption(snapshot: ChartSnapshot): EChartsOption {
  const { kind, labels, values } = snapshot;
  const problem = chartDataProblem(labels, values);
  if (problem) throw new Error(problem);
  if (kind === 'pie' && values.some((n) => n < 0))
    throw new Error('含负数时无法绘制饼图，请选择柱图或折线图');
  const data = values.map((n) => Number(centsToYuan(n)));
  const categoryAxis = { type: 'category' as const, data: labels };
  const valueAxis = { type: 'value' as const, name: '元' };
  return {
    aria: { enabled: true },
    tooltip: { trigger: 'item', renderMode: 'richText' },
    grid: { containLabel: true, left: 20, right: 30, top: 30, bottom: 30 },
    ...(kind === 'pie'
      ? {}
      : {
          xAxis: snapshot.transposed ? valueAxis : categoryAxis,
          yAxis: snapshot.transposed ? categoryAxis : valueAxis,
        }),
    series: [
      {
        type: kind,
        ...(kind === 'line' ? { connectNulls: false } : {}),
        data: kind === 'pie' ? data.map((value, i) => ({ value, name: labels[i] })) : data,
      },
    ],
  };
}

/** 使用共享打印允许的静态标签和 CSS，不嵌入屏幕 SVG，也不改变打印安全策略。 */
export function chartPrintJob(snapshot: ChartSnapshot, color: ChartPrintColor): PrintJob {
  // 打印采用同一合法性要求；负数饼图或空数据不能绕过屏幕限制。
  chartOption(snapshot);
  const maximum = snapshot.values.reduce(
    (max, value) => Decimal.max(max, new Decimal(value).abs()),
    new Decimal(0),
  );
  const name = CHART_KINDS.find((k) => k.value === snapshot.kind)!.label;
  const axis =
    snapshot.kind === 'pie' ? '饼图无直角坐标' : snapshot.transposed ? '坐标已转换' : '原坐标';
  const rows = snapshot.labels
    .map((label, index) => {
      const value = snapshot.values[index]!;
      const width = new Decimal(value).abs().div(maximum).mul(50).toFixed(6);
      const side = value < 0 ? 'negative' : 'positive';
      return `<div class="chart-print-row"><div class="chart-print-label">${escapeHtml(label)}</div><div class="chart-print-track"><span class="chart-print-zero"></span><span class="chart-print-bar ${side}" style="width:${width}%"></span></div><div class="chart-print-value">${escapeHtml(centsToYuan(value))}</div></div>`;
    })
    .join('');
  const exactRows = snapshot.labels
    .map(
      (label, index) =>
        `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(centsToYuan(snapshot.values[index]!))}</td></tr>`,
    )
    .join('');
  return {
    title: `${snapshot.title}－条形图形打印`,
    orientation: 'landscape',
    html: `<section data-analysis-chart-print="true" data-color-mode="${color}"><h1>${escapeHtml(snapshot.title)}</h1>${snapshot.description ? `<p>${escapeHtml(snapshot.description)}</p>` : ''}<p>条形图形打印；金额单位：元。屏幕图形：${name}（${axis}）；${color === 'color' ? '彩色打印' : '黑白打印'}。负数在零轴左侧，正数在右侧；条长仅作比较，右侧及下表为精确金额。</p>${rows}<h2>精确数据</h2><table><thead><tr><th>项目</th><th>金额（元）</th></tr></thead><tbody>${exactRows}</tbody></table></section>`,
    css: `.chart-print-row{display:grid;grid-template-columns:minmax(0,30%) minmax(0,1fr) 24ch;gap:10px;align-items:center;min-height:28px;break-inside:avoid;padding:3px 0}.chart-print-label{overflow-wrap:anywhere}.chart-print-track{height:18px;position:relative}.chart-print-zero{position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:#111}.chart-print-bar{position:absolute;height:18px;border:1px solid #111;box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}.chart-print-bar.positive{left:50%;background:${color === 'color' ? '#1765b3' : '#333'}}.chart-print-bar.negative{right:50%;background:${color === 'color' ? '#c75b16' : '#777'}}.chart-print-value{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}`,
  };
}
