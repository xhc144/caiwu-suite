import { Alert, Button, Skeleton, Tooltip, Typography } from 'antd';
import {
  BankOutlined,
  FallOutlined,
  LineChartOutlined,
  RiseOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { init } from 'echarts';
import { formatMoney, formatPeriod } from '@caiwu/core';
import { usePermission, useTab } from '@caiwu/web-kit';
import type { FinanceMonth } from '../shared';
import { api } from './api';
import { userError } from './errors';

const COLORS = { revenue: '#1f6feb', expense: '#f59e0b', profit: '#16a34a', loss: '#dc2626' };

function Kpi({
  icon,
  tone,
  label,
  value,
  hint,
  onClick,
}: {
  icon: ReactNode;
  tone: 'blue' | 'green' | 'orange' | 'red' | 'purple';
  label: string;
  value: number;
  hint?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`cw-kpi cw-kpi-${tone}`}
      onClick={onClick}
      aria-label={`${label} ${formatMoney(value)}`}
    >
      <span className="cw-kpi-icon" aria-hidden>
        {icon}
      </span>
      <span className="cw-kpi-body">
        <span className="cw-kpi-label">{label}</span>
        <span className={`cw-kpi-value${value < 0 ? ' cw-kpi-negative' : ''}`}>
          <small>¥</small>
          {formatMoney(value)}
        </span>
        {hint && <span className="cw-kpi-hint">{hint}</span>}
      </span>
    </button>
  );
}

/** 本年逐月收入、成本费用柱状及利润折线。颜色随页面文字色适配深色主题。 */
function TrendChart({ months }: { months: FinanceMonth[] }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const chart = init(el, undefined, { renderer: 'svg' });
    const text = getComputedStyle(el).color || '#555';
    const yuan = (cents: number) => Math.round(cents) / 100;
    chart.setOption({
      animationDuration: 300,
      color: [COLORS.revenue, COLORS.expense, COLORS.profit],
      textStyle: { color: text, fontFamily: 'inherit' },
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, right: 8, textStyle: { color: text } },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => `¥${formatMoney(Math.round(Number(v) * 100))}`,
      },
      xAxis: {
        type: 'category',
        data: months.map((m) => `${m.period % 100}月`),
        axisLabel: { color: text },
        axisLine: { lineStyle: { color: text, opacity: 0.3 } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: text,
          formatter: (v: number) => (Math.abs(v) >= 10000 ? `${v / 10000}万` : String(v)),
        },
        splitLine: { lineStyle: { color: text, opacity: 0.12 } },
      },
      series: [
        {
          name: '收入',
          type: 'bar',
          barMaxWidth: 18,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          data: months.map((m) => yuan(m.revenue)),
        },
        {
          name: '成本费用',
          type: 'bar',
          barMaxWidth: 18,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          data: months.map((m) => yuan(m.expense)),
        },
        {
          name: '利润',
          type: 'line',
          smooth: true,
          symbolSize: 6,
          data: months.map((m) => yuan(m.profit)),
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [months]);
  return <div ref={element} className="cw-trend-chart" role="img" aria-label="本年收支趋势图" />;
}

/**
 * 工作台经营概况：只有能查看余额表的用户才显示。数据含未过账凭证，
 * 收入、成本费用不含结转凭证。
 */
export function FinanceOverview({
  period,
  scope,
  refreshSignal,
  onOpen,
}: {
  period?: number;
  scope: string;
  refreshSignal: number;
  onOpen: (to: string) => void;
}) {
  const canView = usePermission('workbench.overview.view');
  const canBalances = usePermission('balances.view');
  const enabled = canView && canBalances;
  const tab = useTab();
  const finance = useQuery({
    ...api.finance.queryOptions({ period }),
    queryKeyHashFn: (key) => JSON.stringify([scope, key]),
    enabled,
  });
  const refetch = finance.refetch;
  useEffect(() => {
    if (tab.active && enabled) void refetch();
  }, [tab.active, enabled, refetch, refreshSignal]);
  if (!enabled) return null;
  const data = finance.data;
  const last = data?.months.at(-1);
  const p = data?.period;
  return (
    <section className="cw-home-section" aria-label="经营概况">
      <div className="cw-home-section-head">
        <Typography.Title level={5} style={{ margin: 0 }}>
          <LineChartOutlined aria-hidden /> 经营概况
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {p ? `${formatPeriod(p)} · ` : ''}含未过账凭证，收入与成本费用不含结转凭证
        </Typography.Text>
      </div>
      {finance.isPending ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : finance.isError ? (
        <Alert
          type="warning"
          showIcon
          title="暂时无法读取经营概况"
          description={userError(finance.error, '请稍后刷新；如持续失败，请检查账套期间设置')}
          action={<Button onClick={() => void finance.refetch()}>重试</Button>}
        />
      ) : !last || !data?.ytd ? (
        <Typography.Text type="secondary">本年度还没有可统计的期间。</Typography.Text>
      ) : (
        <>
          <div className="cw-kpi-grid">
            <Kpi
              icon={<WalletOutlined />}
              tone="purple"
              label="货币资金"
              value={last.cash}
              hint="库存现金与银行存款期末余额"
              onClick={() => onOpen('/m/balances')}
            />
            <Kpi
              icon={<RiseOutlined />}
              tone="blue"
              label="本期收入"
              value={last.revenue}
              hint={`本年累计 ¥${formatMoney(data.ytd.revenue)}`}
              onClick={() => onOpen('/m/report-engine')}
            />
            <Kpi
              icon={<FallOutlined />}
              tone="orange"
              label="本期成本费用"
              value={last.expense}
              hint={`本年累计 ¥${formatMoney(data.ytd.expense)}`}
              onClick={() => onOpen('/m/report-engine')}
            />
            <Kpi
              icon={<BankOutlined />}
              tone={last.profit < 0 ? 'red' : 'green'}
              label="本期利润"
              value={last.profit}
              hint={
                <Tooltip title="按损益类科目发生额计算：收入类合计减去成本费用类合计">
                  本年累计 ¥{formatMoney(data.ytd.profit)}
                </Tooltip>
              }
              onClick={() => onOpen('/m/report-engine')}
            />
          </div>
          <TrendChart months={data.months} />
        </>
      )}
    </section>
  );
}
