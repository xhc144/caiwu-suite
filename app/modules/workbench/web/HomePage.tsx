import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { MENU_GROUPS, formatCodeScheme, formatPeriod, productName } from '@caiwu/core';
import { usePermission } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { api } from './api';
import { matchesFunction } from './search-match';
import { FeatureMap } from './FeatureMap';
import { useGuidance } from './guidance';
import { useWorkbenchContext } from './context';

export default function HomePage() {
  const { session, entries, scope, manifests } = useWorkbenchContext();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawPeriod = params.get('period');
  const period = rawPeriod && /^\d{6}$/.test(rawPeriod) ? Number(rawPeriod) : undefined;
  const canView = usePermission('workbench.overview.view');
  const guidance = useGuidance();
  const canSettings = usePermission('workbench.settings');
  const overviewOpts = api.overview.queryOptions({ period });
  const overview = useQuery({
    ...overviewOpts,
    queryKeyHashFn: (key) => JSON.stringify([scope, key]),
    enabled: canView,
  });
  const prefOpts = api.preferences.queryOptions();
  const prefs = useQuery({ ...prefOpts, queryKeyHashFn: (key) => JSON.stringify([scope, key]) });
  const save = useMutation(
    api.savePreferences.mutationOptions({ onSuccess: () => void prefs.refetch() }),
  );
  const [filter, setFilter] = useState('');
  const favoriteSet = new Set(prefs.data?.favorites ?? []);
  const data = overview.data;
  const p = data?.selected?.period;
  const open = (to: string) => void navigate(to);
  return (
    <PageContainer
      title="工作台"
      subtitle={`你好，${session.user.name} · ${session.book.orgName} · ${productName(session.book.product)}`}
      extra={
        <Space wrap>
          <Button onClick={() => open('/m/workbench/search')}>搜索功能与业务资料</Button>
          <Button
            aria-label="刷新"
            onClick={() => void overview.refetch()}
            disabled={!canView}
            loading={overview.isFetching}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <Card size="small">
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="账套">{session.book.name}</Descriptions.Item>
          <Descriptions.Item label="单位">{session.book.orgName}</Descriptions.Item>
          <Descriptions.Item label="会计制度">{session.book.templateName}</Descriptions.Item>
          <Descriptions.Item label="科目级次">
            {formatCodeScheme(session.book.codeScheme)}
          </Descriptions.Item>
          <Descriptions.Item label="启用期间">
            {formatPeriod(session.book.startPeriod)}
          </Descriptions.Item>
          <Descriptions.Item label="本位币">{session.book.baseCurrency}</Descriptions.Item>
          <Descriptions.Item label="产品形态">
            {productName(session.book.product)}
          </Descriptions.Item>
          <Descriptions.Item label="当前工作期间">
            {data?.current ? formatPeriod(data.current.period) : '尚未读取'}
          </Descriptions.Item>
          <Descriptions.Item label="查看期间">
            <Select
              aria-label="查看期间"
              value={period ?? data?.selected?.period}
              placeholder="当前工作期间"
              style={{ minWidth: 150 }}
              options={data?.periods.map((x) => ({
                value: x.period,
                label: formatPeriod(x.period),
              }))}
              onChange={(v) => {
                const next = new URLSearchParams(params);
                next.set('period', String(v));
                setParams(next);
              }}
            />
          </Descriptions.Item>
        </Descriptions>
      </Card>
      {!canView ? (
        <Alert
          type="warning"
          title="没有工作台统计权限"
          description="可以使用下面的已授权功能；请联系管理员授权统计和凭证查询权限。"
        />
      ) : overview.isPending ? (
        <Spin tip="正在读取本期状态">
          <div style={{ height: 80 }} />
        </Spin>
      ) : overview.isError ? (
        <Alert
          type="error"
          title="无法读取本期统计"
          description={overview.error.message}
          action={<Button onClick={() => void overview.refetch()}>重试</Button>}
        />
      ) : data?.counts && p ? (
        <>
          <Typography.Text type="secondary">
            {data.scope}。待审核=pending，待过账=audited。
          </Typography.Text>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))',
              gap: 12,
            }}
          >
            {(['pending', 'audited'] as const).map((status) => (
              <Card key={status} size="small">
                <Statistic
                  title={status === 'pending' ? '待审核凭证' : '待过账凭证'}
                  value={data.counts![status]}
                />
                <Button onClick={() => open(`/m/voucher-book?period=${p}&status=${status}`)}>
                  处理{status === 'pending' ? '待审核' : '待过账'}凭证
                </Button>
              </Card>
            ))}
            <Card size="small" title="本期状态与结账进度">
              <Tag color={data.selected?.status === 'closed' ? 'green' : 'blue'}>
                {data.selected?.status === 'closed' ? '已结账' : '未结账'}
              </Tag>
              <p>
                {data.counts.pending + data.counts.audited > 0
                  ? `尚有 ${data.counts.pending + data.counts.audited} 张凭证未过账`
                  : '当前统计范围内无未过账凭证'}
              </p>
              <p>断号、试算及损益结转检查请在期末处理核实。</p>
              <Button onClick={() => open('/m/period-close')}>查看结账检查</Button>
            </Card>
          </div>
          <Space wrap>
            <Button onClick={() => open('/m/balances')}>汇总余额表</Button>
            <Button onClick={() => open(`/m/ledgers/detail?account=&from=${p}&to=${p}&dims=`)}>
              明细账
            </Button>
          </Space>
        </>
      ) : (
        <Empty description="账套尚无会计期间，请联系管理员检查账套" />
      )}
      {prefs.data && !prefs.data.guided && !guidance.dismissed && (
        <Alert
          type="info"
          title="开始使用这个账套"
          description="依次检查基础档案、期初、凭证和备份设置。引导只提供导航，不创建业务数据。"
          action={
            <Space wrap>
              <Button onClick={() => open('/m/workbench/help')}>查看使用引导</Button>
              <Button
                onClick={() => {
                  guidance.setDismissed(true);
                  if (canSettings) save.mutate({ favorites: prefs.data!.favorites, guided: true });
                }}
              >
                跳过引导
              </Button>
            </Space>
          }
        />
      )}
      <Card size="small" title="常用功能">
        <Space wrap>
          {entries
            .filter((i) => favoriteSet.has(i.to))
            .map((i) => (
              <Button key={i.to} onClick={() => open(i.to)}>
                {i.title}
              </Button>
            ))}
        </Space>
        {!favoriteSet.size && (
          <Typography.Text type="secondary">在功能列表中点击「收藏」。</Typography.Text>
        )}
      </Card>
      <Card size="small" title="全部已授权功能">
        <Input
          aria-label="按分组搜索功能"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          maxLength={64}
          allowClear
          placeholder="名称、别名、拼音首字母或分组"
        />
        {manifests.isError && (
          <Alert
            type="error"
            title="功能清单加载失败"
            action={<Button onClick={() => void manifests.refetch()}>重试</Button>}
          />
        )}
        {MENU_GROUPS.map((g) => ({
          g,
          list: entries.filter(
            (i) => i.group === g.id && matchesFunction(filter, i.title, i.keywords, g.title),
          ),
        }))
          .filter((x) => x.list.length)
          .map(({ g, list }) => (
            <section key={g.id}>
              <Typography.Title level={5}>{g.title}</Typography.Title>
              <Space wrap>
                {list.map((i) => (
                  <Space key={i.to}>
                    <Button onClick={() => open(i.to)}>{i.title}</Button>
                    <Button
                      size="small"
                      type="text"
                      aria-label={`${favoriteSet.has(i.to) ? '取消收藏' : '收藏'}${i.title}`}
                      disabled={!canSettings || save.isPending}
                      onClick={() =>
                        save.mutate({
                          guided: prefs.data?.guided ?? false,
                          favorites: favoriteSet.has(i.to)
                            ? [...favoriteSet].filter((f) => f !== i.to)
                            : [...favoriteSet, i.to].slice(-30),
                        })
                      }
                    >
                      {favoriteSet.has(i.to) ? '★' : '☆'}
                    </Button>
                  </Space>
                ))}
              </Space>
            </section>
          ))}
        {!entries.length && !manifests.isPending && (
          <Empty description="当前没有可用功能，请联系管理员检查模块与权限" />
        )}
      </Card>
      <FeatureMap />
    </PageContainer>
  );
}
