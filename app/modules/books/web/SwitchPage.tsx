import { Button } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { PageContainer } from '@caiwu/ui';
import { useRequiredSession } from '@caiwu/web-kit';
import { switchBook } from './session';

import { useBookNavigation } from './useBookNavigation';

export default function SwitchPage() {
  useBookNavigation();
  const session = useRequiredSession();
  const change = useMutation({ mutationFn: switchBook });
  return (
    <PageContainer title="切换账套" subtitle={`当前账套：${session.book.name}`}>
      <p>请先保存正在编辑的内容。切换将退出当前会话并关闭本窗口的全部标签页。</p>
      <Button type="primary" loading={change.isPending} onClick={() => change.mutate()}>
        退出并选择账套
      </Button>
    </PageContainer>
  );
}
