import { Alert, Button, Input, Modal, Space, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

/** 页面统一外框：标题、副标题、右侧操作区。 */
export function PageContainer({
  title,
  subtitle,
  extra,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cw-page">
      <div className="cw-page-header">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
        </div>
        {extra && <Space wrap>{extra}</Space>}
      </div>
      <div className="cw-page-body">{children}</div>
    </div>
  );
}

export interface AlertAction {
  label: string;
  /** 站内路由 */
  to?: string;
  onClick?: () => void;
}

/**
 * 带操作按钮的提示：不只告诉用户"不行"，还给出"去处理"的入口。
 *   <ActionAlert type="warning" title="有 3 张凭证没有过账" actions={[{ label: '去过账', to: '/m/period-close' }]} />
 */
export function ActionAlert({
  type = 'warning',
  title,
  description,
  actions = [],
}: {
  type?: 'success' | 'info' | 'warning' | 'error';
  title: ReactNode;
  description?: ReactNode;
  actions?: AlertAction[];
}) {
  const navigate = useNavigate();
  return (
    <Alert
      type={type}
      showIcon
      title={title}
      description={description}
      action={
        actions.length ? (
          <Space orientation="vertical" size={4}>
            {actions.map((a) => (
              <Button
                key={a.label}
                size="small"
                type="primary"
                ghost
                onClick={() => (a.onClick ? a.onClick() : a.to && void navigate(a.to))}
              >
                {a.label}
              </Button>
            ))}
          </Space>
        ) : undefined
      }
    />
  );
}

export interface DangerConfirmOptions {
  title: string;
  /** 后果说明，要具体 */
  content: ReactNode;
  /** 用户必须输入的确认文字，例如 "反结账" */
  confirmText: string;
  okText?: string;
}

/**
 * 危险操作的确认框：用户必须输入指定文字才能继续（删除账套、跨年反结账、系统初始化等）。
 *   const [confirmDanger, holder] = useDangerConfirm();
 *   ...{holder}...
 *   if (await confirmDanger({ title, content, confirmText: '删除' })) { ... }
 */
export function useDangerConfirm(): [(opts: DangerConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<{
    opts: DangerConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [text, setText] = useState('');
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
    setText('');
  };
  const holder = (
    <Modal
      open={!!state}
      title={state?.opts.title}
      okText={state?.opts.okText ?? '确定'}
      okButtonProps={{ danger: true, disabled: text !== state?.opts.confirmText }}
      onOk={() => close(true)}
      onCancel={() => close(false)}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12 }}>{state?.opts.content}</div>
      <Typography.Text>
        请输入{' '}
        <Typography.Text strong code>
          {state?.opts.confirmText}
        </Typography.Text>{' '}
        确认：
      </Typography.Text>
      <Input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ marginTop: 8 }}
        aria-label="确认文字"
      />
    </Modal>
  );
  const confirm = (opts: DangerConfirmOptions) =>
    new Promise<boolean>((resolve) => setState({ opts, resolve }));
  return [confirm, holder];
}
