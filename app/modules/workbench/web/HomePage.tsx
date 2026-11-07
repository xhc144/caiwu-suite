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
import {
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  CheckSquareOutlined,
  CloudUploadOutlined,
  EditOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  LockOutlined,
  ProfileOutlined,
  ReloadOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { MENU_GROUPS, formatCodeScheme, formatPeriod, productName } from '@caiwu/core';
import { usePermission, useTab } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { api } from './api';
import { userError } from './errors';
import { matchesFunction } from './search-match';
import { FeatureMap } from './FeatureMap';
import { FinanceOverview } from './FinanceOverview';
import { useGuidance } from './guidance';
import { useWorkbenchContext } from './context';
import './home.css';

/** 首页快捷入口：只显示当前用户有权限、当前产品形态可用的功能。 */
const QUICK_ACTIONS: { to: string; icon: ReactNode; link?: (period: number) => string }[] = [
  { to: '/m/voucher-entry/new', icon: <EditOutlined /> },
  { to: '/m/voucher-book', icon: <ProfileOutlined /> },
  { to: '/m/balances', icon: <TableOutlined /> },
  {
    to: '/m/ledgers/detail',
    icon: <FileSearchOutlined />,
    link: (p) => `/m/ledgers/detail?account=&from=${p}&to=${p}&dims=`,
  },
  { to: '/m/report-engine', icon: <BarChartOutlined /> },
  { to: '/m/period-close', icon: <LockOutlined /> },
  { to: '/m/backup', icon: <CloudUploadOutlined /> },
];

export default function HomePage() {
  const { session, entries, scope, manifests } = useWorkbenchContext();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawPeriod = params.get('period');
  const period = rawPeriod && /^\d{6}$/.test(rawPeriod) ? Number(rawPeriod) : undefined;
  const canView = usePermission('workbench.overview.view');
  const tab = useTab();
  const guidance = useGuidance();
  const canSettings = usePermission('workbench.settings');
  const overviewOpts = api.overview.queryOptions({ period });
  const overview = useQuery({
    ...overviewOpts,
    queryKeyHashFn: (key) => JSON.stringify([scope, key]),
    enabled: canView,
  });
  const refreshOverview = overview.refetch;
  useEffect(() => {
    if (tab.active && canView) void refreshOverview();
  }, [tab.active, canView, refreshOverview]);
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
  const [refreshSignal, setRefreshSignal] = useState(0);
  const shortcuts = QUICK_ACTIONS.flatMap(({ to, icon, link }) => {
    const entry = entries.find((i) => i.to === to);
    if (!entry) return [];
    return [{ entry, icon, to: link && p ? link(p) : to }];
  });
  return (
    <PageContainer
      title="工作台"
      subtitle={`你好，${session.user.name} · ${session.book.orgName} · ${productName(session.book.product)}`}
      extra={
        <Space wrap>
          <Button icon={<SearchOutlined aria-hidden />} onClick={() => open('/m/workbench/search')}>
            搜索功能与业务资料
          </Button>
          <Button
            aria-label="刷新"
            icon={<ReloadOutlined aria-hidden />}
            onClick={() => {
              void overview.refetch();
              setRefreshSignal((n) => n + 1);
            }}
            disabled={!canView}
            loading={overview.isFetching}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <div className="cw-home-hero">
        <div className="cw-home-hero-title">
          <span className="cw-home-hero-badge" aria-hidden>
            <BookOutlined />
          </span>
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong className="cw-home-hero-name">
              {session.book.name}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {session.book.orgName}
            </Typography.Text>
          </div>
          <label className="cw-home-period">
            <span>查看期间</span>
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
          </label>
        </div>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3, xxl: 6 }}>
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
        </Descriptions>
      </div>
      {prefs.data && !prefs.data.guided && !guidance.dismissed && (
        <Alert
          type="info"
          showIcon
          title="开始使用这个账套"
          description="依次检查基础档案、期初、凭证和备份设置。引导只提供导航，不创建业务数据。"
          action={
            <Space wrap>
              <Button type="primary" onClick={() => open('/m/workbench/help')}>
                查看使用引导
              </Button>
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
          description={userError(overview.error, '无法连接本地服务，请检查服务后重试')}
          action={<Button onClick={() => void overview.refetch()}>重试</Button>}
        />
      ) : data?.counts && p ? (
        <section className="cw-home-section" aria-label="本期待办">
          <div className="cw-home-section-head">
            <Typography.Title level={5} style={{ margin: 0 }}>
              <CheckSquareOutlined aria-hidden /> 本期待办
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatPeriod(p)} · {data.scope}。已审核且尚未过账的凭证列入待过账。
            </Typography.Text>
          </div>
          <div className="cw-todo-grid">
            {(['pending', 'audited'] as const).map((status) => (
              <Card
                key={status}
                size="small"
                className={`cw-todo-card ${data.counts![status] > 0 ? 'cw-todo-active' : ''}`}
              >
                <Statistic
                  title={status === 'pending' ? '待审核凭证' : '待过账凭证'}
                  value={data.counts![status]}
                  prefix={
                    status === 'pending' ? (
                      <AuditOutlined aria-hidden className="cw-todo-icon" />
                    ) : (
                      <FileDoneOutlined aria-hidden className="cw-todo-icon" />
                    )
                  }
                  suffix={<span className="cw-todo-unit">张</span>}
                />
                <Button
                  type={data.counts![status] > 0 ? 'primary' : 'default'}
                  ghost={data.counts![status] > 0}
                  onClick={() => open(`/m/voucher-book?period=${p}&status=${status}`)}
                >
                  处理{status === 'pending' ? '待审核' : '待过账'}凭证
                </Button>
              </Card>
            ))}
            <Card size="small" className="cw-todo-card" title="本期状态与结账进度">
              <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                <Space size={6} wrap>
                  <Tag color={data.selected?.status === 'closed' ? 'green' : 'blue'}>
                    {data.selected?.status === 'closed' ? '已结账' : '未结账'}
                  </Tag>
                  <Typography.Text>
                    {data.counts.pending + data.counts.audited > 0
                      ? `尚有 ${data.counts.pending + data.counts.audited} 张凭证未过账`
                      : '当前统计范围内无未过账凭证'}
                  </Typography.Text>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  断号、试算及损益结转检查请在期末处理核实。
                </Typography.Text>
                <Button onClick={() => open('/m/period-close')}>查看结账检查</Button>
              </Space>
            </Card>
          </div>
        </section>
      ) : (
        <Empty description="账套尚无会计期间，请联系管理员检查账套" />
      )}
      <FinanceOverview period={period} scope={scope} refreshSignal={refreshSignal} onOpen={open} />
      {shortcuts.length > 0 && (
        <section className="cw-home-section" aria-label="快捷入口">
          <div className="cw-home-section-head">
            <Typography.Title level={5} style={{ margin: 0 }}>
              <AppstoreOutlined aria-hidden /> 快捷入口
            </Typography.Title>
          </div>
          <div className="cw-quick-grid">
            {shortcuts.map(({ entry, icon, to }) => (
              <button
                type="button"
                key={entry.to}
                className="cw-quick-tile"
                onClick={() => open(to)}
              >
                <span className="cw-quick-icon" aria-hidden>
                  {icon}
                </span>
                <span>{entry.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <Card
        size="small"
        title={
          <span>
            <StarFilled aria-hidden style={{ color: '#f59e0b' }} /> 常用功能
          </span>
        }
      >
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
          <Typography.Text type="secondary">
            在下方功能列表中点击功能旁的 ☆ 收藏，常用功能会显示在这里。
          </Typography.Text>
        )}
      </Card>
      <Card
        size="small"
        title={
          <span>
            <AppstoreOutlined aria-hidden /> 全部已授权功能
          </span>
        }
        extra={
          <Input
            aria-label="按分组搜索功能"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            maxLength={64}
            allowClear
            prefix={<SearchOutlined aria-hidden />}
            placeholder="名称、别名、拼音首字母或分组"
            style={{ width: 260 }}
          />
        }
      >
        {manifests.isError && (
          <Alert
            type="error"
            title="功能清单加载失败"
            action={<Button onClick={() => void manifests.refetch()}>重试</Button>}
          />
        )}
        {MENU_GROUPS.map((g) => ({
          g,
          // 与左侧导航相同：按清单 order 排列（稳定排序保留声明顺序），不按拼音
          list: entries
            .filter(
              (i) => i.group === g.id && matchesFunction(filter, i.title, i.keywords, g.title),
            )
            .sort((a, b) => a.order - b.order),
        }))
          .filter((x) => x.list.length)
          .map(({ g, list }) => (
            <section key={g.id} className="cw-func-group">
              <Typography.Text strong className="cw-func-group-title">
                {g.title}
              </Typography.Text>
              <div className="cw-func-list">
                {list.map((i) => (
                  <span key={i.to} className="cw-func-chip">
                    <Button type="text" size="small" onClick={() => open(i.to)}>
                      {i.title}
                    </Button>
                    <Button
                      size="small"
                      type="text"
                      className="cw-func-star"
                      aria-label={`${favoriteSet.has(i.to) ? '取消收藏' : '收藏'}${i.title}`}
                      disabled={!canSettings || save.isPending}
                      icon={
                        favoriteSet.has(i.to) ? (
                          <StarFilled style={{ color: '#f59e0b' }} />
                        ) : (
                          <StarOutlined />
                        )
                      }
                      onClick={() =>
                        save.mutate({
                          guided: prefs.data?.guided ?? false,
                          favorites: favoriteSet.has(i.to)
                            ? [...favoriteSet].filter((f) => f !== i.to)
                            : [...favoriteSet, i.to].slice(-30),
                        })
                      }
                    />
                  </span>
                ))}
              </div>
            </section>
          ))}
        {!entries.length && !manifests.isPending && (
          <Empty description="当前没有可用功能，请联系管理员检查功能与权限" />
        )}
      </Card>
      <FeatureMap />
    </PageContainer>
  );
}
