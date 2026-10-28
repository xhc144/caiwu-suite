import { useEffect, useRef, useState } from 'react';
import { Alert, Select, Space, Table } from 'antd';
import { init } from 'echarts';
import { comparisonValueText, type ComparisonReport, type ComparisonRow } from '../comparison';
import { UNIT_NAMES } from '../custom';

export default function ComparisonPanel({ report }: { report: ComparisonReport }) {
  const [selected, setSelected] = useState<string>(),
    [kind, setKind] = useState<'bar' | 'line'>('line');
  const [chartError, setChartError] = useState(false);
  const chartElement = useRef<HTMLDivElement>(null);
  const row = report.rows.find((r) => r.key === selected) ?? report.rows[0]!;
  const ratio =
    report.filter.method === 'structure' ||
    (report.filter.method === 'trend' && report.filter.trendMode !== 'absolute');
  const labels =
    report.filter.method === 'structure'
      ? report.rows.map((r) => r.name)
      : report.columns.map((c) => c.label);
  const chartValues =
    report.filter.method === 'structure'
      ? report.rows.map((r) => r.cells[0]!.ratio)
      : row.cells.map((c) =>
          ratio
            ? c.ratio
            : c.amount === null
              ? null
              : comparisonValueText(c.amount, row.decimalPlaces),
        );
  const chartSignature = JSON.stringify({ labels, chartValues, kind, ratio, unit: row.unit });
  useEffect(() => {
    if (!chartElement.current) return;
    const chart = init(chartElement.current, undefined, { renderer: 'svg' });
    try {
      const data: {
        labels: string[];
        chartValues: (string | null)[];
        kind: 'bar' | 'line';
        ratio: boolean;
        unit: ComparisonRow['unit'];
      } = JSON.parse(chartSignature);
      chart.setOption({
        aria: { enabled: true },
        tooltip: { trigger: 'axis', renderMode: 'richText' },
        xAxis: { type: 'category', data: data.labels },
        yAxis: { type: 'value', name: data.ratio ? '%' : UNIT_NAMES[data.unit] },
        series: [
          {
            type: data.kind,
            connectNulls: false,
            data: data.chartValues.map((v) => (v === null ? null : Number(v))),
          },
        ],
      });
    } catch {
      setChartError(true);
    }
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartElement.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [chartSignature]);
  const hasRatio = (index: number) =>
    report.filter.method === 'structure' ||
    (report.filter.method === 'comparison' && index === 1) ||
    (report.filter.method === 'trend' && report.filter.trendMode !== 'absolute');
  return (
    <>
      <Alert
        type="info"
        showIcon
        title={report.title}
        description={`${report.note} 取数时间：${report.generatedAt}`}
      />
      <figure style={{ margin: 0 }}>
        <Space wrap>
          {report.filter.method !== 'structure' && (
            <>
              <label htmlFor="comparison-chart-project">图形项目</label>
              <Select
                id="comparison-chart-project"
                aria-label="图形项目"
                value={row.key}
                onChange={setSelected}
                options={report.rows.map((r) => ({ value: r.key, label: `${r.key} ${r.name}` }))}
                style={{ minWidth: 200 }}
              />
            </>
          )}
          <Select
            aria-label="方法分析图形"
            value={kind}
            onChange={(v) => {
              setKind(v);
              setChartError(false);
            }}
            options={[
              { value: 'line', label: '折线图' },
              { value: 'bar', label: '柱图' },
            ]}
          />
        </Space>
        <div
          ref={chartElement}
          role="img"
          aria-label="方法分析图，未知值保留空缺"
          style={{ width: '100%', height: 280 }}
        />
        {chartError && (
          <Alert type="warning" title="图形绘制失败，可切换图形重试；下方完整数值仍可读取" />
        )}
        <figcaption>图形与下表使用同一结果；未知金额及无法计算的比例保留空缺。</figcaption>
      </figure>
      <Table<ComparisonRow>
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={report.rows}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: '项目编号', dataIndex: 'key', fixed: 'left', width: 90 },
          {
            title: '项目',
            dataIndex: 'name',
            fixed: 'left',
            width: 180,
            render: (v, r) => (r.subtotal ? <strong>{v}</strong> : v),
          },
          { title: '单位', width: 70, render: (_, r) => UNIT_NAMES[r.unit] },
          ...report.columns.map((c, index) => ({
            title: `${c.label}（${c.periodFrom}—${c.periodTo}）`,
            key: c.label,
            children: [
              {
                title: '数值',
                key: `${index}-amount`,
                width: 180,
                render: (_: unknown, r: ComparisonRow) => (
                  <>
                    <div>
                      {r.cells[index]!.amount === null
                        ? '未知'
                        : comparisonValueText(r.cells[index]!.amount, r.decimalPlaces)}
                    </div>
                    {r.cells[index]!.reason && <small>{r.cells[index]!.reason}</small>}
                  </>
                ),
              },
              ...(hasRatio(index)
                ? [
                    {
                      title: report.filter.method === 'structure' ? '占比%' : '指数%',
                      key: `${index}-ratio`,
                      width: 130,
                      render: (_: unknown, r: ComparisonRow) =>
                        r.cells[index]!.ratio === null ? '无法计算' : `${r.cells[index]!.ratio}%`,
                    },
                  ]
                : []),
              ...(hasRatio(index) && report.filter.method !== 'structure'
                ? [
                    {
                      title: '增减率%',
                      key: `${index}-growth`,
                      width: 130,
                      render: (_: unknown, r: ComparisonRow) =>
                        r.cells[index]!.growth === null ? '无法计算' : `${r.cells[index]!.growth}%`,
                    },
                  ]
                : []),
            ],
          })),
          ...(report.filter.method === 'comparison'
            ? [
                {
                  title: '报告比基期增减',
                  key: 'difference',
                  width: 160,
                  render: (_: unknown, r: ComparisonRow) =>
                    r.difference === null
                      ? '未知'
                      : comparisonValueText(r.difference, r.decimalPlaces),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
