import { Button, Card, Descriptions, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { formatPeriod, productName } from '@caiwu/core';
import { queryClient, useBootstrap, usePermission, useRequiredSession } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { api } from './api';
import { useGuidance } from './guidance';

export default function HelpPage() {
  const session = useRequiredSession();
  const boot = useBootstrap();
  const navigate = useNavigate();
  const prefs = useQuery(api.preferences.queryOptions());
  const guidance = useGuidance();
  const canSave = usePermission('workbench.settings');
  const save = useMutation(
    api.savePreferences.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: api.preferences.queryKey() }),
    }),
  );
  return (
    <PageContainer title="帮助与关于">
      <Card title="本应用">
        <Descriptions column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="版本">{boot?.version ?? '正在读取版本'}</Descriptions.Item>
          <Descriptions.Item label="产品">{productName(session.book.product)}</Descriptions.Item>
          <Descriptions.Item label="账套">{session.book.name}</Descriptions.Item>
          <Descriptions.Item label="单位">{session.book.orgName}</Descriptions.Item>
          <Descriptions.Item label="会计制度">{session.book.templateName}</Descriptions.Item>
          <Descriptions.Item label="启用期间">
            {formatPeriod(session.book.startPeriod)}
          </Descriptions.Item>
        </Descriptions>
        <p>
          账套保存在本机服务管理的数据目录中，每套账使用独立的 .caiwu
          文件；请通过备份功能转移和保存数据。本页不显示绝对路径或凭据。
        </p>
      </Card>
      <Card title="首次使用引导">
        <Typography.Paragraph>
          按以下顺序检查账套；入口仅用于导航，未安装的模块会显示不可用。
        </Typography.Paragraph>
        <Space wrap>
          {[
            ['建账/选择账套', '/'],
            ['基础档案', '/m/masterdata/accounts'],
            ['期初余额', '/m/opening'],
            ['凭证录入', '/m/voucher-entry'],
            ['数据备份', '/m/backup'],
          ].map(([title, to]) => (
            <Button
              key={to}
              onClick={() => {
                if (
                  to === '/' &&
                  !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
                )
                  return;
                void navigate(to!);
              }}
            >
              {title}
            </Button>
          ))}
        </Space>
        <p>制单和审核应由不同操作员完成，管理员应按业务职责授权。</p>
        <Space>
          <Button
            disabled={!prefs.data}
            onClick={() => {
              guidance.setDismissed(true);
              if (canSave) save.mutate({ favorites: prefs.data!.favorites, guided: true });
            }}
          >
            完成/跳过引导
          </Button>
          <Button
            disabled={!prefs.data}
            onClick={() => {
              guidance.setDismissed(false);
              if (canSave) save.mutate({ favorites: prefs.data!.favorites, guided: false });
            }}
          >
            重新开启首页引导
          </Button>
        </Space>
      </Card>
      <Card title="快捷键与操作">
        <p>
          Ctrl+K 打开搜索；? 打开当前可用快捷键总表；F1 打开本页；Ctrl+F4
          关闭当前标签，首页不能关闭。
        </p>
        <p>
          输入框、组合输入和表格编辑优先处理业务键。Ctrl+K
          与凭证删行/报表复制有上下文冲突，因此凭证与报表页整体保留此业务键，可随时点击页头搜索按钮。Ctrl+S、Ctrl+P
          等由当前业务页实现，浏览器可能保留 F1 等按键。
        </p>
        <p>
          多标签保存各页状态和筛选。关闭、关闭所有、切换产品及退出前请保存表单；已有 beforeunload
          保护会被检查，统一表单未保存协议尚待共享层接入。
        </p>
      </Card>
    </PageContainer>
  );
}
