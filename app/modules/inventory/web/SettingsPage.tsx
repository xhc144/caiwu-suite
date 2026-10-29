import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Select, Space } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { PageContainer } from '@caiwu/ui';
import { usePermission } from '@caiwu/web-kit';
import { api } from './api';
import type { Settings } from '../shared';
import { InventoryNavigation } from './common';
import { Field, TextField, useCatalog, useRefresh, useUnsaved } from './common';
export default function SettingsPage() {
  const { context } = useCatalog();
  const [draft, setDraft] = useState<Settings | null>(null);
  const current = draft ?? context?.settings;
  const can = usePermission('inventory.settings');
  const save = useMutation(api.saveSettings.mutationOptions());
  const refresh = useRefresh();
  const latest = useRef(draft);
  latest.current = draft;
  const submit = async () => {
    if (!draft || save.isPending) return false;
    await save.mutateAsync(draft);
    if (latest.current === draft) setDraft(null);
    await refresh();
    return true;
  };
  useUnsaved(!!draft, {
    pending: save.isPending,
    title: '仓库设置',
    version: JSON.stringify(draft),
    save: submit,
    discard: () => setDraft(null),
  });
  return (
    <PageContainer
      title="仓库设置"
      subtitle={`账套 ${context?.book.name ?? ''}，启用期间 ${context?.book.startPeriod ?? ''}，核算截止 ${context?.control.cost_cutoff_date ?? '未核算'}`}
    >
      <InventoryNavigation />
      {current && (
        <Space wrap align="start">
          <Select
            aria-label="单据编号规则"
            disabled={!can || save.isPending}
            value={current.numberRule}
            onChange={(numberRule) => setDraft({ ...current, numberRule })}
            options={[
              { value: 'daily', label: '年月日 + 顺序号' },
              { value: 'monthly', label: '年月 + 顺序号' },
              { value: 'sequence', label: '顺序号' },
            ]}
          />
          <Checkbox
            disabled={!can || save.isPending}
            checked={current.autoRefresh}
            onChange={(e) => setDraft({ ...current, autoRefresh: e.target.checked })}
          >
            单据自动刷新
          </Checkbox>
          <Field label="数量显示小数位数">
            <Select
              aria-label="数量显示小数位数"
              disabled={!can || save.isPending}
              value={current.quantityDigits}
              options={Array.from({ length: 7 }, (_, value) => ({ value, label: String(value) }))}
              onChange={(quantityDigits) => setDraft({ ...current, quantityDigits })}
            />
          </Field>
          <Field label="单价显示小数位数">
            <Select
              aria-label="单价显示小数位数"
              disabled={!can || save.isPending}
              value={current.priceDigits}
              options={Array.from({ length: 7 }, (_, value) => ({ value, label: String(value) }))}
              onChange={(priceDigits) => setDraft({ ...current, priceDigits })}
            />
          </Field>
          <TextField
            label="默认普票税率（%）"
            value={current.ordinaryTaxRate}
            onChange={(ordinaryTaxRate) => {
              if (can && !save.isPending) setDraft({ ...current, ordinaryTaxRate });
            }}
          />
          <TextField
            label="默认专票税率（%）"
            value={current.specialTaxRate}
            onChange={(specialTaxRate) => {
              if (can && !save.isPending) setDraft({ ...current, specialTaxRate });
            }}
          />
          <Button
            type="primary"
            disabled={!can || !draft}
            loading={save.isPending}
            onClick={() => void submit()}
          >
            保存设置
          </Button>
        </Space>
      )}
      <Alert
        type="info"
        title="显示精度只影响表格、打印和表格导出；输入与计算保留原始精度。默认税率仅在新单选择发票种类时带入，已有单据不改写。成本与凭证请在成本核算功能办理。"
      />
    </PageContainer>
  );
}
