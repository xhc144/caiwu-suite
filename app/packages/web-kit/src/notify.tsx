import { App, Button, Space } from 'antd';
import { TRPCClientError } from '@trpc/client';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { isBusinessErrorData, type BusinessErrorData } from '@caiwu/core';

type AppApi = ReturnType<typeof App.useApp>;
let api: AppApi | null = null;
let navigate: ((to: string) => void) | null = null;

/** 放在 <App> 和路由里面，把 antd 的提示接口和路由跳转接出来，供非组件代码使用。 */
export function NotifyBridge() {
  const a = App.useApp();
  const nav = useNavigate();
  useEffect(() => {
    api = a;
    navigate = (to) => void nav(to);
  }, [a, nav]);
  return null;
}

/** 从任意错误里取出业务错误信息（服务端 BusinessError、输入校验错误）。 */
export function getBusinessError(error: unknown): BusinessErrorData | null {
  if (error instanceof TRPCClientError) {
    const b = (error.data as { business?: unknown } | undefined)?.business;
    if (isBusinessErrorData(b)) return b;
    return { code: 'UNKNOWN', message: error.message };
  }
  if (isBusinessErrorData((error as { data?: unknown })?.data))
    return (error as { data: BusinessErrorData }).data;
  return null;
}

/**
 * 统一的错误提示：显示 message、hint，并把 actions 渲染成按钮（点了跳转）。
 * 写操作失败会自动调用（见 queryClient），一般不需要手动调。
 */
export function showError(error: unknown) {
  const b = getBusinessError(error) ?? {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
  };
  showBusinessMessage(b);
}

export function showBusinessMessage(
  b: BusinessErrorData,
  type: 'error' | 'warning' | 'info' = 'error',
) {
  if (!api) {
    console.error(b);
    return;
  }
  const key = `${b.code}:${b.message}`;
  api.notification[type]({
    key,
    title: b.message,
    description: b.hint,
    duration: b.actions?.length ? 0 : 6,
    placement: 'topRight',
    actions: b.actions?.length ? (
      <Space>
        {b.actions.map((a) => (
          <Button
            key={a.to}
            type="primary"
            size="small"
            onClick={() => {
              api?.notification.destroy(key);
              navigate?.(a.to);
            }}
          >
            {a.label}
          </Button>
        ))}
      </Space>
    ) : undefined,
  });
}

export const notify = {
  success: (text: string) => api?.message.success(text),
  info: (text: string) => api?.message.info(text),
  warning: (text: string) => api?.message.warning(text),
  error: (text: string) => api?.message.error(text),
};

/** 用于非组件代码里的确认框；组件里请直接用 App.useApp().modal。 */
export function modalApi() {
  return api?.modal ?? null;
}
