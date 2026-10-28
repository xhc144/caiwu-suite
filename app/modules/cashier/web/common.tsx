import { Alert, Button, Space, Spin, Modal, Input } from 'antd';
import { useState, type ReactNode } from 'react';
import type { DangerConfirmOptions } from '@caiwu/ui';
import { Link } from 'react-router';
import { formatMoney } from '@caiwu/core';
import { printHtml } from '@caiwu/print';

export function CashierNav() {
  return (
    <Space wrap style={{ marginBottom: 16 }}>
      <Link to="/m/cashier/accounts">账户与期初</Link>
      <Link to="/m/cashier/documents">收付单与凭证</Link>
      <Link to="/m/cashier/reconcile">和账务对账</Link>
      <Link to="/m/cashier/reports">日记账与汇总</Link>
      <Link to="/m/cashier/periods">结账与反结账</Link>
      <Link to="/m/cashier/checks">支票登记簿</Link>
    </Space>
  );
}
export function QueryState({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean;
  error: { message: string } | null;
  retry: () => unknown;
  children: ReactNode;
}) {
  if (loading) return <Spin aria-label="正在加载出纳数据" />;
  if (error)
    return (
      <Alert
        type="error"
        showIcon
        title={error.message}
        action={<Button onClick={() => void retry()}>重试</Button>}
      />
    );
  return children;
}
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function printRows(title: string, headings: string[], rows: (string | number)[][]) {
  void printHtml({
    title,
    html: `<h1>${escapeHtml(title)}</h1><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${headings.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(typeof c === 'number' ? formatMoney(c) : c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  });
}

// 共享 useDangerConfirm 的嵌套 Typography 在当前生产构建触发 React 更新循环。
// 本模块保留相同强确认交互，改用原生文字节点，待共享层修复后可复用。
export function useCashierConfirm(): [
  (options: DangerConfirmOptions) => Promise<boolean>,
  ReactNode,
] {
  const [state, setState] = useState<{
    options: DangerConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [text, setText] = useState('');
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
    setText('');
  };
  return [
    (options) => new Promise<boolean>((resolve) => setState({ options, resolve })),
    <Modal
      open={state != null}
      title={state?.options.title}
      okText={state?.options.okText ?? '确定'}
      onCancel={() => close(false)}
      onOk={() => close(true)}
      okButtonProps={{ danger: true, disabled: text !== state?.options.confirmText }}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12 }}>{state?.options.content}</div>
      <label htmlFor="cashier-confirm-text">
        请输入 <strong>{state?.options.confirmText}</strong> 确认：
      </label>
      <Input
        id="cashier-confirm-text"
        aria-label="确认文字"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Modal>,
  ];
}
