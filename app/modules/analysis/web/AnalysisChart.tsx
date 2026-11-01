import { useEffect, useId, useRef, useState } from 'react';
import { Alert, App, Button, Radio, Select, Space } from 'antd';
import { init } from 'echarts';
import { printHtml } from '@caiwu/print';
import { queryClient, showError, usePermission } from '@caiwu/web-kit';
import { api } from './api';
import {
  CHART_KINDS,
  chartDataProblem,
  chartOption,
  chartPrintJob,
  type ChartKind,
  type ChartPrintColor,
} from './chart-model';

export default function AnalysisChart({
  labels,
  values,
  title = '分析图形',
  description,
}: {
  labels: string[];
  values: number[];
  title?: string;
  description?: string;
}) {
  const { modal } = App.useApp();
  const canPrint = usePermission('analysis.export');
  const kindId = useId();
  const element = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<ChartKind>('bar');
  const [transposed, setTransposed] = useState(false);
  const [error, setError] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printChoiceOpen, setPrintChoiceOpen] = useState(false);
  const negativePie = kind === 'pie' && values.some((n) => n < 0);
  const problem = chartDataProblem(labels, values);
  useEffect(() => {
    if (!element.current || negativePie || problem) return;
    const chart = init(element.current, undefined, { renderer: 'svg' });
    try {
      chart.setOption(chartOption({ kind, transposed, labels, values, title: '分析图形' }));
    } catch {
      setError(true);
    }
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [kind, transposed, labels, values, negativePie, problem]);
  const choosePrint = () => {
    let color: ChartPrintColor = 'monochrome';
    // 打开选择框时固定数据快照，取色与权限复核期间不混入其他查询结果。
    const snapshot = {
      kind,
      transposed,
      labels: [...labels],
      values: [...values],
      title,
      description,
    };
    setPrintChoiceOpen(true);
    modal.confirm({
      title: '选择图形打印颜色',
      content: (
        <Space orientation="vertical">
          <Radio.Group
            aria-label="图形打印颜色"
            defaultValue="monochrome"
            options={[
              { value: 'monochrome', label: '黑白' },
              { value: 'color', label: '彩色' },
            ]}
            onChange={(event) => {
              color = event.target.value as ChartPrintColor;
            }}
          />
          <span>独立输出当前数据的条形图形打印，保留项目名称、正负方向与精确金额。</span>
        </Space>
      ),
      okText: '打印图形',
      cancelText: '取消',
      afterClose: () => setPrintChoiceOpen(false),
      onOk: async () => {
        setPrinting(true);
        try {
          await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('trend'), staleTime: 0 });
          await printHtml(chartPrintJob(snapshot, color));
        } catch (cause) {
          showError(cause);
          throw cause;
        } finally {
          setPrinting(false);
        }
      },
    });
  };
  return (
    <figure style={{ margin: 0 }}>
      <Space wrap>
        <label htmlFor={kindId}>图形</label>
        <Select
          id={kindId}
          aria-label="图形"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setError(false);
          }}
          options={CHART_KINDS.map((k) => ({ ...k }))}
        />
        <Button
          disabled={kind === 'pie' || !!problem}
          onClick={() => {
            setTransposed((value) => !value);
            setError(false);
          }}
        >
          {transposed ? '恢复坐标' : '坐标转换'}
        </Button>
        <span>
          {kind === 'pie'
            ? '饼图无需坐标转换'
            : transposed
              ? '数值横轴、项目纵轴'
              : '项目横轴、数值纵轴'}
        </span>
        {canPrint && (
          <Button
            disabled={negativePie || !!problem || printChoiceOpen}
            loading={printing}
            onClick={choosePrint}
          >
            独立打印图形
          </Button>
        )}
      </Space>
      {negativePie ? (
        <Alert type="info" title="含负数时无法绘制饼图，请选择柱图或折线图" />
      ) : problem ? (
        <Alert type="info" title={problem} />
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
