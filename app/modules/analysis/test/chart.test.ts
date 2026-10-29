import { describe, expect, it } from 'vitest';
import { assertSafePrintContent, renderPrintDocument } from '@caiwu/print';
import {
  chartDataProblem,
  chartOption,
  chartPrintJob,
  type ChartSnapshot,
} from '../web/chart-model';

const sample: ChartSnapshot = {
  title: '经营分析',
  kind: 'bar',
  transposed: false,
  labels: ['一月', '二月', '三月'],
  values: [12345, -6789, 0],
};
describe('w_fx_demo_tx 图形选择、坐标转换及独立打印', () => {
  it('柱图和折线图交换项目/数值坐标，数据顺序和正负值保留', () => {
    for (const kind of ['bar', 'line'] as const) {
      const normal = chartOption({ ...sample, kind });
      const transposed = chartOption({ ...sample, kind, transposed: true });
      expect(normal.xAxis).toEqual({ type: 'category', data: sample.labels });
      expect(normal.yAxis).toEqual({ type: 'value', name: '元' });
      expect(transposed.xAxis).toEqual(normal.yAxis);
      expect(transposed.yAxis).toEqual(normal.xAxis);
      expect(transposed.series).toEqual(normal.series);
    }
  });
  it('非负饼图使用名称和数值，负数、空值、非完整数据拒绝绘制及打印', () => {
    const pie = chartOption({ ...sample, kind: 'pie', values: [12345, 6789, 0] });
    expect(pie.xAxis).toBeUndefined();
    expect(pie.series).toEqual([
      {
        type: 'pie',
        data: [
          { name: '一月', value: 123.45 },
          { name: '二月', value: 67.89 },
          { name: '三月', value: 0 },
        ],
      },
    ]);
    expect(() => chartOption({ ...sample, kind: 'pie' })).toThrow('含负数');
    expect(() => chartPrintJob({ ...sample, kind: 'pie' }, 'color')).toThrow('含负数');
    for (const data of [
      { labels: [], values: [] },
      { labels: ['零'], values: [0] },
      { labels: ['一'], values: [1, 2] },
      { labels: ['一'], values: [NaN] },
      { labels: ['一'], values: [Infinity] },
      { labels: ['一'], values: [0.1] },
    ]) {
      expect(chartDataProblem(data.labels, data.values)).toBeTruthy();
      expect(() => chartPrintJob({ ...sample, ...data }, 'monochrome')).toThrow();
    }
  });
  it('彩色和黑白为不同实际样式，条形正负方向及金额准确，打印安全策略原样通过', () => {
    const color = chartPrintJob(sample, 'color');
    const monochrome = chartPrintJob(sample, 'monochrome');
    expect(color.html).toContain('data-color-mode="color"');
    expect(monochrome.html).toContain('data-color-mode="monochrome"');
    expect(color.css).toContain('background:#1765b3');
    expect(color.css).toContain('background:#c75b16');
    expect(monochrome.css).toContain('background:#333');
    expect(monochrome.css).not.toMatch(/#1765b3|#c75b16/);
    expect(color.html).toContain('条形图形打印');
    expect(color.html).toContain('123.45');
    expect(color.html).toContain('-67.89');
    expect(color.html).toContain('width:50.000000%');
    expect(color.html).toContain('class="chart-print-bar negative"');
    expect(color.css).toContain('.chart-print-zero{position:absolute;left:50%');
    expect(color.css).toContain('.chart-print-bar.positive{left:50%');
    expect(color.css).toContain('.chart-print-bar.negative{right:50%');
    expect(color.html).toContain('<th>金额（元）</th>');
    expect(color.html).toContain('<tr><td>二月</td><td class="num">-67.89</td></tr>');
    expect(color.html).not.toMatch(/<(?:svg|img|script|canvas)\b/);
    expect(() => assertSafePrintContent(color.html, color.css)).not.toThrow();
    expect(renderPrintDocument(color)).toContain("default-src 'none'");
  });
  it('大数金额保留逐分文本，标题与项目转义后不能注入打印标签', () => {
    const job = chartPrintJob(
      {
        ...sample,
        title: '<img src=x>',
        labels: ['<script>x</script>'],
        values: [Number.MAX_SAFE_INTEGER],
      },
      'monochrome',
    );
    expect(job.html).toContain('90071992547409.91');
    expect(job.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(job.html).toContain('&lt;img src=x&gt;');
    expect(() => assertSafePrintContent(job.html, job.css)).not.toThrow();
  });
});
