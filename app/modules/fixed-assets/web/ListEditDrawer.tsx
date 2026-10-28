import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Drawer, Input } from 'antd';
import { DataTable } from '@caiwu/ui';
import { notify, useHotkey } from '@caiwu/web-kit';
import { api, type Outputs } from './api';
import { refresh } from './common';
import { useAssetDraft } from './useAssetDraft';

type Field = 'name' | 'model' | 'unit' | 'reference' | 'manufacturer' | 'machineCode';
const fields: { field: Field; label: string; max: number }[] = [
  { field: 'name', label: '设备名称', max: 100 },
  { field: 'model', label: '规格型号', max: 500 },
  { field: 'unit', label: '单位', max: 20 },
  { field: 'reference', label: '参考编号', max: 100 },
  { field: 'manufacturer', label: '制造厂', max: 100 },
  { field: 'machineCode', label: '本机编号', max: 100 },
];
export default function ListEditDrawer({
  rows,
  onClose,
}: {
  rows: Outputs['list'];
  onClose: () => void;
}) {
  const [source] = useState(rows);
  const [changes, setChanges] = useState<Record<number, Partial<Record<Field, string>>>>({});
  const save = useMutation(api.saveListEdits.mutationOptions());
  const draft = useAssetDraft({
    title: '资产列表编辑',
    discard: onClose,
    save: async () => {
      const edits = Object.entries(changes).map(([id, values]) => ({
        id: Number(id),
        revision: source.find((c) => c.id === Number(id))!.revision,
        changes: values,
      }));
      if (!edits.length) return;
      const result = await save.mutateAsync({ rows: edits });
      notify.success(`已保存 ${result.changed} 张资产的列表修改`);
      void refresh();
      onClose();
    },
  });
  useHotkey('Ctrl+S', () => void draft.save().catch(() => {}));
  return (
    <Drawer
      open
      title="资产列表编辑"
      width="95%"
      onClose={() => draft.close(onClose)}
      extra={
        <Button
          type="primary"
          loading={draft.saving}
          onClick={() => void draft.save().catch(() => {})}
        >
          保存列表修改
        </Button>
      }
    >
      <Alert title="可直接逐格编辑资产说明资料，按 Ctrl+S 存盘。本次所有修改一起保存；来源凭证、关闭期间或版本变化会使本次保存全部回滚，保留输入。金额及部门、用途、状态等变更请使用卡片对应业务。" />
      <DataTable
        tableId="fixed-assets-list-edit"
        rowKey="id"
        dataSource={source}
        pagination={false}
        columns={[
          { key: 'code', title: '设备编号', dataIndex: 'code', width: 140 },
          ...fields.map(({ field, label, max }) => ({
            key: field,
            title: label,
            width: field === 'model' ? 250 : 180,
            render: (_: unknown, row: Outputs['list'][number]) => (
              <Input
                aria-label={`${row.code} ${label}`}
                maxLength={max}
                disabled={draft.saving}
                value={
                  changes[row.id]?.[field] ??
                  (field === 'machineCode' ? row.machine_code : row[field])
                }
                onChange={(e) => {
                  setChanges((old) => ({
                    ...old,
                    [row.id]: { ...old[row.id], [field]: e.target.value },
                  }));
                  draft.changed();
                }}
              />
            ),
          })),
        ]}
      />
    </Drawer>
  );
}
