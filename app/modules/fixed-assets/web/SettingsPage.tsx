import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Select } from 'antd';
import { AccountSelect, PageContainer } from '@caiwu/ui';
import { notify, usePermission, useVoucherTypes } from '@caiwu/web-kit';
import type { Settings } from '../shared';
import { api } from './api';
import { refresh } from './common';
import { useAssetDraft } from './useAssetDraft';
export default function SettingsPage() {
  const settings = useQuery(api.getSettings.queryOptions()),
    types = useVoucherTypes(),
    can = usePermission('fixed-assets.settings');
  const [form] = Form.useForm<Settings>();
  const hydrated = useRef(false);
  const saved = useRef<Partial<Settings>>({});
  const save = useMutation(api.saveSettings.mutationOptions());
  const draft = useAssetDraft({
    title: '资产凭证设置',
    save: async () => {
      if (!can || !hydrated.current) return false;
      const values = structuredClone(await form.validateFields());
      await save.mutateAsync(values);
      saved.current = values;
      notify.success('凭证设置已保存');
      void refresh();
    },
    discard: () => {
      form.resetFields();
      form.setFieldsValue(saved.current);
    },
  });
  useEffect(() => {
    if (hydrated.current || !settings.isSuccess) return;
    hydrated.current = true;
    saved.current = settings.data ?? {};
    form.setFieldsValue(saved.current);
  }, [settings.isSuccess, settings.data, form]);
  return (
    <PageContainer title="资产凭证设置">
      <Alert title="用途的折旧分配科目在基础档案维护；清理凭证还需类别的资产科目。仅可选择启用的末级科目。" />
      {settings.error && <Alert type="error" title={settings.error.message} />}
      {settings.isSuccess && (
        <Form<Settings>
          form={form}
          disabled={!can}
          layout="vertical"
          style={{ maxWidth: 600, marginTop: 20 }}
          onValuesChange={draft.changed}
          onFinish={() => void draft.save().catch(() => {})}
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
          <Button type="primary" htmlType="submit" disabled={!can} loading={draft.saving}>
            保存设置
          </Button>
        </Form>
      )}
    </PageContainer>
  );
}
