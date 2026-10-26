import { Input, Modal } from 'antd';
import { useState, type ReactNode } from 'react';
import type { DangerConfirmOptions } from '@caiwu/ui';

/** 当前 antd 的混合 Typography 子节点会循环测量；在 owner 内提供同等文字确认保护。 */
export function useAdminConfirm(): [
  (options: DangerConfirmOptions) => Promise<boolean>,
  ReactNode,
] {
  const [pending, setPending] = useState<{
    options: DangerConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);
  const [text, setText] = useState('');
  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
    setText('');
  };
  return [
    (options) =>
      new Promise<boolean>((resolve) => {
        setText('');
        setPending({ options, resolve });
      }),
    <Modal
      key="system-admin-confirm"
      open={pending !== null}
      title={pending?.options.title}
      okText={pending?.options.okText ?? '确定'}
      cancelText="取消"
      okButtonProps={{ danger: true, disabled: text !== pending?.options.confirmText }}
      onOk={() => {
        if (text === pending?.options.confirmText) close(true);
      }}
      onCancel={() => close(false)}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12 }}>{pending?.options.content}</div>
      <p>{`请输入「${pending?.options.confirmText ?? ''}」确认：`}</p>
      <Input
        aria-label="确认文字"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPressEnter={() => {
          if (text === pending?.options.confirmText) close(true);
        }}
      />
    </Modal>,
  ];
}
