import { useAdminConfirm } from './confirm';
import { Alert, Button, Descriptions, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useRequiredSession } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { api } from './api';

const names: Record<string, string> = {
  account: '科目',
  voucher: '凭证',
  voucher_line: '分录',
  opening_balance: '期初',
  dimension_item: '辅助档案',
  currency: '币种',
  period: '期间',
  operation_log: '日志',
  app_user: '用户',
};
export default function ResetPage() {
  const s = useRequiredSession(),
    navigate = useNavigate();
  const preflight = useQuery(
    api.reset.preflight.queryOptions(undefined, { enabled: s.user.isAdmin, staleTime: 0 }),
  );
  const [confirm, holder] = useAdminConfirm();
  const d = preflight.data;
  return (
    <PageContainer
      title="系统初始化预检"
      subtitle="仅检查当前账套，无执行能力时不更改数据。"
      extra={
        <Button onClick={() => void preflight.refetch()} disabled={!s.user.isAdmin}>
          重新预检
        </Button>
      }
    >
      {holder}
      {!s.user.isAdmin ? (
        <Alert type="warning" title="需要启用管理员身份" />
      ) : (
        <>
          <Alert
            showIcon
            type="warning"
            title="初始化执行未开放"
            description={d?.reason ?? '正在读取当前账套预检信息…'}
          />
          {d && (
            <>
              <Typography.Paragraph style={{ marginTop: 16 }}>{d.impact}</Typography.Paragraph>
              <Descriptions
                bordered
                items={[
                  { key: 'book', label: '当前账套', children: d.book.name },
                  { key: 'org', label: '单位', children: d.book.orgName },
                  {
                    key: 'template',
                    label: '制度/模板',
                    children: d.template?.name ?? `${d.book.templateName}（当前未加载）`,
                  },
                  { key: 'scheme', label: '科目级次', children: d.book.codeScheme.join('-') },
                  { key: 'currency', label: '本位币', children: d.book.baseCurrency },
                  { key: 'start', label: '启用期间', children: d.book.startPeriod },
                  ...Object.entries(d.counts).map(([key, count]) => ({
                    key,
                    label: names[key],
                    children: count,
                  })),
                  {
                    key: 'periods',
                    label: '现有期间',
                    children: d.periods
                      .map((p) => `${p.period} ${p.status === 'closed' ? '已结账' : '未结账'}`)
                      .join('、'),
                  },
                ]}
              />
            </>
          )}
          <Space style={{ marginTop: 20 }}>
            <Button danger disabled>
              执行初始化（待安全服务）
            </Button>
            <Button
              onClick={async () => {
                if (
                  await confirm({
                    title: '放弃系统初始化',
                    content: '退出只读预检，未备份、未删除或更改任何数据。',
                    confirmText: '放弃初始化',
                  })
                )
                  void navigate('/');
              }}
            >
              放弃初始化
            </Button>
          </Space>
        </>
      )}
    </PageContainer>
  );
}
