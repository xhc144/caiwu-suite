import { useAdminConfirm } from './confirm';
import { Button, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { coreApi, useRequiredSession, showError } from '@caiwu/web-kit';
import { PageContainer } from '@caiwu/ui';
import { api } from './api';
import { goToLogin } from './session';
import { useSessionLeaveResult } from './unsaved';

export default function SwitchPage() {
  const s = useRequiredSession();
  const [confirm, holder] = useAdminConfirm();
  const [leave, leaveHolder] = useSessionLeaveResult();
  const change = useMutation(api.switchUser.mutationOptions());
  const logout = useMutation(coreApi.auth.logout.mutationOptions({ meta: { silent: true } }));
  return (
    <PageContainer title="切换用户" subtitle={`当前账套：${s.book.name}；当前用户：${s.user.name}`}>
      {holder}
      {leaveHolder}
      <Typography.Paragraph>
        切换前请保存所有页面的内容。确认后将退出当前会话，并清空查询缓存、旧菜单和已打开的标签页。
      </Typography.Paragraph>
      <Button
        loading={change.isPending || logout.isPending}
        onClick={async () => {
          if (
            !(await confirm({
              title: '确认切换用户',
              content: '未保存内容会丢失，请先保存。将返回当前账套的登录页。',
              confirmText: '切换用户',
            }))
          )
            return;
          const result = await leave();
          if (result.error instanceof Error) showError(result.error);
          if (!result.allowed || result.sessionRevoked) return;
          await change.mutateAsync({ confirmed: true });
          // 模块服务已经撤销会话；仍调用 core logout，以复用既有退出协议。
          try {
            await logout.mutateAsync();
          } catch {
            /* 会话已由本模块失效 */
          }
          await goToLogin(s.bookId);
        }}
      >
        确认并切换用户
      </Button>
    </PageContainer>
  );
}
