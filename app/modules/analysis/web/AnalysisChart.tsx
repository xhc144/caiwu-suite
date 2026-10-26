import { useEffect, useRef, useState } from 'react';
import { Alert, Select, Space } from 'antd';
import { init } from 'echarts';
import { centsToYuan } from '@caiwu/core';

export default function AnalysisChart({ labels, values }: { labels: string[]; values: number[] }) {
  const element = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<'bar' | 'line' | 'pie'>('bar');
  const [error, setError] = useState(false);
  const negativePie = kind === 'pie' && values.some((n) => n < 0);
  const empty = values.length === 0 || values.every((n) => n === 0);
  useEffect(() => {
    if (!element.current || negativePie || empty) return;
    const chart = init(element.current, undefined, { renderer: 'svg' });
    try {
      const data = values.map((n) => Number(centsToYuan(n)));
      chart.setOption({
        aria: { enabled: true },
        tooltip: { trigger: 'item' },
        ...(kind === 'pie'
          ? {}
          : { xAxis: { type: 'category', data: labels }, yAxis: { type: 'value', name: '元' } }),
        series: [
          {
            type: kind,
            data: kind === 'pie' ? data.map((value, i) => ({ value, name: labels[i] })) : data,
          },
        ],
      });
    } catch {
      setError(true);
    }
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [kind, labels, values, negativePie, empty]);
  return (
    <figure style={{ margin: 0 }}>
      <Space>
        <label htmlFor="analysis-chart-kind">图形</label>
        <Select
          id="analysis-chart-kind"
          aria-label="图形"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setError(false);
          }}
          options={[
            { value: 'bar', label: '柱图' },
            { value: 'line', label: '折线图' },
            { value: 'pie', label: '饼图' },
          ]}
        />
      </Space>
      {negativePie ? (
        <Alert type="info" title="含负数时无法绘制饼图，请选择柱图或折线图" />
      ) : empty ? (
        <Alert type="info" title="当前数据均为零或为空，请调整筛选条件" />
      ) : (
        <div
          ref={element}
          role="img"
          aria-label="由下方表格数据生成的分析图（元）"
          style={{ height: 280, width: '100%' }}
        />
      )}
      {error && <Alert type="warning" title="图表绘制失败，请切换图形重试；数值仍可在表格中读取" />}
      <figcaption>图表与下方表格使用同一份查询结果，金额单位为元。</figcaption>
    </figure>
  );
}
