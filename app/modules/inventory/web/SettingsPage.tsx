import { useState } from 'react';
import { Alert, Button, Checkbox, Select, Space } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { PageContainer } from '@caiwu/ui';
import { usePermission } from '@caiwu/web-kit';
import { api } from './api';
import { InventoryNavigation } from './common';
import { useCatalog, useRefresh, useUnsaved } from './common';
export default function SettingsPage() {
  const { context } = useCatalog();
  const [draft, setDraft] = useState<{
    numberRule: 'daily' | 'monthly' | 'sequence';
    autoRefresh: boolean;
  } | null>(null);
  const current = draft ?? context?.settings;
  const can = usePermission('inventory.settings');
  const save = useMutation(api.saveSettings.mutationOptions());
  const refresh = useRefresh();
  useUnsaved(!!draft);
  return (
    <PageContainer
      title="仓库设置"
      subtitle={`账套 ${context?.book.name ?? ''}，启用期间 ${context?.book.startPeriod ?? ''}，核算截止 ${context?.control.cost_cutoff_date ?? '未核算'}`}
    >
      <InventoryNavigation />
      {current && (
        <Space>
          <Select
            aria-label="单据编号规则"
            disabled={!can}
            value={current.numberRule}
            onChange={(numberRule) => setDraft({ ...current, numberRule })}
            options={[
              { value: 'daily', label: '年月日 + 顺序号' },
              { value: 'monthly', label: '年月 + 顺序号' },
              { value: 'sequence', label: '顺序号' },
            ]}
          />
          <Checkbox
            disabled={!can}
            checked={current.autoRefresh}
            onChange={(e) => setDraft({ ...current, autoRefresh: e.target.checked })}
          >
            单据自动刷新
          </Checkbox>
          <Button
            type="primary"
            disabled={!can || !draft}
            loading={save.isPending}
            onClick={async () => {
              await save.mutateAsync(current);
              setDraft(null);
              await refresh();
            }}
          >
            保存设置
          </Button>
        </Space>
      )}
      <Alert
        type="info"
        title="成本核算、取消核算、成本与收入凭证、收入成本利润表由 W2-01 提供。破坏性初始化、历史税率修复与数据整理未开通。"
      />
    </PageContainer>
  );
}
