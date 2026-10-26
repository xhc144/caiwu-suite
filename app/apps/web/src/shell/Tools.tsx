import { Alert, Button, Empty, Modal, Space, Spin, Typography } from 'antd';
import { Component, Suspense, use, type ReactNode } from 'react';
import { DataTable } from '@caiwu/ui';
import { useRequiredSession } from '@caiwu/web-kit';
import { useNavigate } from 'react-router';
import { loadWebModule } from '../modules';
import type { NavItem } from './NavMenu';

export function DiscoveredTool({
  id,
  path,
  quiet = false,
}: {
  id: string;
  path: string;
  quiet?: boolean;
}) {
  const mod = use(loadWebModule(id));
  const Page = mod?.routes.find((r) => r.path === path)?.component;
  return Page ? <Page /> : quiet ? null : <Empty description="该模块尚未提供此功能" />;
}
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      getContainer={false}
      title="全局搜索"
      open={open}
      onCancel={onClose}
      footer={null}
      width={800}
      destroyOnHidden
      focusTriggerAfterClose
    >
      <ToolBoundary>
        <Suspense fallback={<Spin />}>
          <DiscoveredTool id="workbench" path="/search" />
        </Suspense>
      </ToolBoundary>
    </Modal>
  );
}
export function ShortcutDialog({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
}) {
  const navigate = useNavigate();
  const session = useRequiredSession();
  const rows = [
    {
      key: 'search',
      title: '全局搜索',
      shortcut: 'Ctrl+K',
      context: '非输入/表格编辑',
      note: '凭证/报表页保留业务键；可点页头搜索',
    },
    {
      key: 'shortcuts',
      title: '快捷键总表',
      shortcut: '?',
      context: '非输入/组合输入',
      note: 'Esc 关闭并归还焦点',
    },
    {
      key: 'close',
      title: '关闭当前标签',
      shortcut: 'Ctrl+F4',
      context: '当前标签',
      note: '首页不可关闭；先检查已有离开保护',
    },
    {
      key: 'help',
      title: '应用帮助',
      shortcut: 'F1',
      context: '非输入/弹窗',
      note: '部分浏览器可能保留 F1；也可点击帮助',
    },
    ...items
      .filter(
        (i) =>
          i.shortcut &&
          !['ctrl+s', 'ctrl+p', 'ctrl+k', 'ctrl+f4', 'f1', '?'].includes(i.shortcut.toLowerCase()),
      )
      .map((i) => ({
        key: i.key,
        title: i.title,
        shortcut: i.shortcut!,
        context: '非输入/表格编辑',
        note: '当前可见模块菜单；业务上下文优先',
      })),
  ];
  return (
    <Modal
      getContainer={false}
      title="快捷键总表"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={820}
      destroyOnHidden
      focusTriggerAfterClose
    >
      <Typography.Paragraph>
        仅列壳已实现的按键和当前有权访问的菜单快捷键。保存、插行、删行、复制和打印由活动业务页处理，具体以页面说明为准。
      </Typography.Paragraph>
      <DataTable
        tableId={`shell.shortcuts.${session.bookId}.${session.user.id}`}
        rowKey="key"
        size="small"
        pagination={false}
        scroll={{ x: 650 }}
        dataSource={rows}
        columns={[
          { key: 'title', title: '名称', dataIndex: 'title', width: 140 },
          { key: 'shortcut', title: '按键', dataIndex: 'shortcut', width: 110 },
          { key: 'context', title: '上下文', dataIndex: 'context', width: 150 },
          { key: 'note', title: '冲突说明', dataIndex: 'note', width: 300 },
        ]}
      />
      <Space>
        <Button
          type="link"
          onClick={() => {
            onClose();
            void navigate('/m/workbench/help');
          }}
        >
          打开应用帮助
        </Button>
      </Space>
    </Modal>
  );
}

class ToolBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? (
      <Alert type="error" title="搜索组件加载失败" description="请先保存当前工作，再刷新应用。" />
    ) : (
      this.props.children
    );
  }
}

/** 通过模块发现挂载会话监测，模块不依赖壳。 */
export function SessionMonitor() {
  return (
    <ToolBoundary>
      <Suspense fallback={null}>
        <DiscoveredTool id="workbench" path="/session" quiet />
      </Suspense>
    </ToolBoundary>
  );
}
