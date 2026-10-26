import { Button, Card, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router';
import { adminEntry } from '../shared';
import { useWorkbenchContext } from './context';

const groups = [
  {
    title: '日常账务与账表',
    items: [
      ['凭证录入', 'voucher-entry'],
      ['凭证查询', 'voucher-book'],
      ['凭证审核', 'voucher-book'],
      ['凭证过账', 'period-close'],
      ['月度结转', 'period-close'],
      ['结账', 'period-close'],
      ['报表', 'report-engine'],
      ['数据备份', 'backup'],
      ['凭证汇总表', 'voucher-book'],
      ['汇总余额表', 'balances'],
      ['外币余额表', 'balances'],
      ['数量余额表', 'balances'],
      ['辅助余额表', 'balances'],
      ['辅助外币余额表', 'balances'],
      ['辅助数量余额表', 'balances'],
      ['现金流量试算平衡表', 'balances'],
      ['总分类账', 'ledgers'],
      ['现金日记账', 'ledgers'],
      ['银行日记账', 'ledgers'],
      ['明细账', 'ledgers'],
      ['多栏账', 'ledgers'],
      ['辅助明细账', 'ledgers'],
      ['辅助多栏明细账', 'ledgers'],
      ['增值税明细账', 'ledgers'],
    ],
  },
  {
    title: '分析与往来',
    items: [
      ['财务费用', 'analysis'],
      ['管理费用', 'analysis'],
      ['销售费用', 'analysis'],
      ['应收账款', 'analysis'],
      ['应付账款', 'analysis'],
      ['其他科目分析', 'analysis'],
      ['自定义分析', 'analysis'],
      ['账龄分析', 'analysis'],
      ['合同账款查询', 'analysis'],
    ],
  },
  {
    title: '基础档案与系统',
    items: [
      ['科目维护', 'masterdata'],
      ['摘要管理', 'masterdata'],
      ['凭证类型', 'masterdata'],
      ['结转类型', 'period-close'],
      ['结算类别', 'masterdata'],
      ['外币类型', 'masterdata'],
      ['合同档案', 'analysis'],
      ['账套管理', 'books'],
      ['账套信息', 'books'],
      ['账册设置', 'print-settings'],
      ['自改密码', 'system-admin'],
      ['用户管理', 'system-admin'],
      ['自动备份设置', 'backup'],
      ['操作日志', 'system-admin'],
      ['辅助档案', 'masterdata'],
      ['期初录入', 'opening'],
    ],
  },
] as const;

/** 保留原版有效入口的可发现名称；只有实际清单里可访问的菜单才成为按钮。 */
export function FeatureMap() {
  const { entries, session, manifests } = useWorkbenchContext();
  const navigate = useNavigate();
  return (
    <Card size="small" title="原工作台功能现在在哪里">
      <Typography.Paragraph type="secondary">
        统一左侧导航可同时打开账务、出纳、发票、工资、资产、仓库。下列名称帮助查找原版入口；未加载或未授权的功能不提供业务操作。
      </Typography.Paragraph>
      {groups.map((g) => (
        <section key={g.title}>
          <Typography.Title level={5}>{g.title}</Typography.Title>
          <Space wrap>
            {g.items
              .filter(([title]) => session.user.isAdmin || !adminEntry(title, ''))
              .map(([title, moduleId]) => {
                const hit = entries.find(
                  (i) =>
                    i.moduleId === moduleId &&
                    [i.title, ...i.keywords].some((value) => value.includes(title)),
                );
                const loaded = manifests.data?.some((m) => m.id === moduleId);
                return hit ? (
                  <Button key={title} size="small" onClick={() => void navigate(hit.to)}>
                    {title}
                  </Button>
                ) : (
                  <Tag key={title}>
                    {title} · {loaded ? '当前无可用入口' : '模块未加载'}
                  </Tag>
                );
              })}
          </Space>
        </section>
      ))}
    </Card>
  );
}
