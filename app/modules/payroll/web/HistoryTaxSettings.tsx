import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Popconfirm, Space, Tag, Typography } from 'antd';
import { formatMoney } from '@caiwu/core';
import { queryClient, usePermission } from '@caiwu/web-kit';
import { api } from './api';

export default function HistoryTaxSettings() {
  const config = useQuery(api.historicalTaxConfig.queryOptions());
  const canConfigure = usePermission('payroll.tax.configure');
  const confirm = useMutation(
    api.confirmHistoricalTax.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: api.pathKey() }),
    }),
  );
  return (
    <section aria-label="历史工资税制">
      <Typography.Title level={5}>历史工资薪金按月计税</Typography.Title>
      <Alert
        type="info"
        title="按工资实际取得月份选用税制；2019年前专项及其他扣除按月录入，不使用专项附加或年度期初累计。"
      />
      {config.error && <Alert type="error" title={config.error.message} />}
      {confirm.error && <Alert type="error" title={confirm.error.message} />}
      {(config.data ?? []).map((rule) => (
        <div key={rule.version} style={{ marginTop: 16 }}>
          <Space wrap>
            <strong>{rule.name}</strong>
            <span>月减除费用 {formatMoney(rule.monthlyExpense)} 元</span>
            <Tag color={rule.confirmed ? 'green' : 'orange'}>
              {rule.confirmed ? '已确认' : '未确认'}
            </Tag>
            <a href={rule.sourceUrl} target="_blank" rel="noreferrer">
              {rule.sourceName}
            </a>
            {canConfigure && (
              <Popconfirm
                title={`确认${rule.name}及月减除费用${rule.monthlyExpense / 100}元？`}
                onConfirm={() =>
                  confirm.mutate({
                    period: rule.from,
                    monthlyExpense: rule.monthlyExpense,
                    confirmed: true,
                  })
                }
              >
                <Button loading={confirm.isPending}>确认此历史税制</Button>
              </Popconfirm>
            )}
          </Space>
          <table aria-label={`${rule.name}税率表`}>
            <thead>
              <tr>
                <th>全月应纳税所得额上限（元）</th>
                <th>税率</th>
                <th>速算扣除（元）</th>
              </tr>
            </thead>
            <tbody>
              {rule.brackets.map(([limit, rate, quick]) => (
                <tr key={limit}>
                  <td>{limit === Number.MAX_SAFE_INTEGER ? '以上' : formatMoney(limit)}</td>
                  <td>{Number(rate) * 100}%</td>
                  <td>{formatMoney(quick)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
