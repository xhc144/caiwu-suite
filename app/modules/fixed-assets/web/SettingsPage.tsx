import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Select } from 'antd';
import { AccountSelect, PageContainer } from '@caiwu/ui';
import { notify, usePermission, useVoucherTypes } from '@caiwu/web-kit';
import type { Settings } from '../shared';
import { api } from './api';
import { refresh } from './common';
export default function SettingsPage() {
  const settings = useQuery(api.getSettings.queryOptions()),
    types = useVoucherTypes(),
    can = usePermission('fixed-assets.settings');
  const save = useMutation(
    api.saveSettings.mutationOptions({
      onSuccess: () => {
        notify.success('凭证设置已保存');
        void refresh();
      },
    }),
  );
  return (
    <PageContainer title="资产凭证设置">
      <Alert title="用途的折旧分配科目在基础档案维护；清理凭证还需类别的资产科目。仅可选择启用的末级科目。" />
      {settings.isFetched && (
        <Form<Settings>
          key={JSON.stringify(settings.data)}
          initialValues={settings.data ?? {}}
          layout="vertical"
          style={{ maxWidth: 600, marginTop: 20 }}
          onFinish={(v) => save.mutate(v)}
        >
          <Form.Item name="depreciationAccountId" label="累计折旧科目" rules={[{ required: true }]}>
            <AccountSelect />
          </Form.Item>
          <Form.Item name="clearingAccountId" label="固定资产清理科目" rules={[{ required: true }]}>
            <AccountSelect />
          </Form.Item>
          <Form.Item name="voucherTypeId" label="凭证类型" rules={[{ required: true }]}>
            <Select
              options={types
                .filter((t) => !t.disabled)
                .map((t) => ({ value: t.id, label: t.name }))}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" disabled={!can} loading={save.isPending}>
            保存设置
          </Button>
        </Form>
      )}
    </PageContainer>
  );
}
