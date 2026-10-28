import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Drawer, Input, Modal, Select, Space, Spin, Typography } from 'antd';
import { notify, queryClient, useAccounts, useUnsavedChanges } from '@caiwu/web-kit';
import { VatMappingSchema, type VatColumn, type VatMapping } from '../vat-shared';
import { api } from './api';

type Props = { open: boolean; onClose: () => void; onSaved: () => void };
export function VatMappingDrawer(props: Props) {
  const mapping = useQuery(api.vat.mapping.queryOptions());
  if (mapping.data) return <Editor {...props} format={mapping.data} />;
  return (
    <Drawer open={props.open} onClose={props.onClose} title="增值税明细账设置">
      {mapping.error ? (
        <Alert
          type="error"
          title="对应关系读取失败"
          description={mapping.error.message}
          action={<Button onClick={() => void mapping.refetch()}>重试</Button>}
        />
      ) : (
        <Spin />
      )}
    </Drawer>
  );
}
function Editor({ format, ...props }: Props & { format: VatMapping }) {
  // 以打开时版本为提交基准；后台刷新不能覆盖仍在编辑的草稿。
  const [original] = useState(format);
  const { accounts } = useAccounts();
  const [columns, setColumns] = useState<VatColumn[]>(original.columns);
  const [saved, setSaved] = useState(JSON.stringify(original.columns));
  const [validation, setValidation] = useState('');
  const [modal, context] = Modal.useModal();
  const mutation = useMutation(api.vat.saveMapping.mutationOptions());
  const saving = useRef(false);
  const dirty = saved !== JSON.stringify(columns);
  const save = async () => {
    if (saving.current || mutation.isPending) return false;
    saving.current = true;
    try {
      const parsed = VatMappingSchema.safeParse({ columns, revision: original.revision });
      if (!parsed.success) {
        setValidation(parsed.error.issues.map((i) => i.message).join('；'));
        return false;
      }
      if (
        !columns.length &&
        original.columns.length &&
        !(await modal.confirm({
          title: '清空增值税明细账的对应关系？',
          content: '清空后需要重新设置才能生成此账簿。凭证与科目数据不会改变。',
          okText: '清空对应关系',
          cancelText: '继续编辑',
        }))
      )
        return false;
      try {
        const result = await mutation.mutateAsync({
          columns: parsed.data.columns,
          expectedRevision: original.revision,
          confirmed: true,
        });
        setSaved(JSON.stringify(result.columns));
        queryClient.setQueryData(api.vat.mapping.queryKey(), result);
        notify.success('增值税明细账设置已保存');
        props.onSaved();
        props.onClose();
        return true;
      } catch {
        return false;
      }
    } finally {
      saving.current = false;
    }
  };
  useUnsavedChanges({
    title: '增值税明细账设置',
    dirty,
    version: JSON.stringify(columns),
    save,
    discard: () => {
      setColumns(original.columns);
      setSaved(JSON.stringify(original.columns));
    },
  });
  const close = async () => {
    if (mutation.isPending) return;
    if (
      dirty &&
      !(await modal.confirm({
        title: '放弃未保存的对应关系修改？',
        content: '已保存的设置仍可继续使用。',
        okText: '放弃修改',
        cancelText: '继续编辑',
      }))
    )
      return;
    props.onClose();
  };
  const change = (index: number, patch: Partial<VatColumn>) => {
    setColumns((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setValidation('');
  };
  const add = (side: 'debit' | 'credit') =>
    setColumns((rows) => [
      ...rows,
      { id: `v_${crypto.randomUUID().replaceAll('-', '')}`, side, label: '', accountCodes: [] },
    ]);
  return (
    <Drawer
      open={props.open}
      width={740}
      onClose={() => void close()}
      title="增值税明细账设置"
      footer={
        <Space>
          <Button onClick={() => void close()}>取消</Button>
          <Button type="primary" loading={mutation.isPending} onClick={() => void save()}>
            确认保存对应关系
          </Button>
        </Space>
      }
    >
      {context}
      <Typography.Paragraph>
        为账套设置增值税明细账的分类栏目与对应科目。借方、贷方最多各五栏，打印时使用这里填写的栏目名称。选择上级科目将包含其全部末级科目。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        同一方向不得重复映射父子科目；同一科目可分别设置借方、贷方栏目，账簿余额只计算一次。对应科目发生的未分类反向金额会另列，便于核对。这里仅设置账簿取数关系。
      </Typography.Paragraph>
      {format.revision !== original.revision && (
        <Alert
          type="warning"
          title="已保存设置有新版本"
          description="当前草稿已保留。保存时会检查版本，请先保留需要的内容，再关闭并重新打开设置。"
        />
      )}
      {validation && <Alert type="error" title="设置不完整" description={validation} />}
      {mutation.error && (
        <Alert
          type="error"
          title="设置未保存，当前内容已保留"
          description={mutation.error.message}
        />
      )}
      <Space orientation="vertical" style={{ width: '100%', marginTop: 12 }}>
        {columns.map((column, index) => (
          <Card
            key={column.id}
            size="small"
            title={`${column.side === 'debit' ? '借方' : '贷方'}第 ${columns.slice(0, index + 1).filter((c) => c.side === column.side).length} 栏`}
            extra={
              <Space>
                <Button
                  disabled={mutation.isPending || index === 0}
                  onClick={() =>
                    setColumns((rows) => {
                      const next = [...rows];
                      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                      return next;
                    })
                  }
                >
                  上移
                </Button>
                <Button
                  danger
                  disabled={mutation.isPending}
                  onClick={() => setColumns((rows) => rows.filter((_, i) => i !== index))}
                >
                  删除
                </Button>
              </Space>
            }
          >
            <Input
              aria-label={`第${index + 1}栏名称`}
              placeholder="账册打印栏目名称"
              value={column.label}
              maxLength={60}
              disabled={mutation.isPending}
              onChange={(event) => change(index, { label: event.target.value })}
            />
            <Select
              aria-label={`第${index + 1}栏对应科目`}
              mode="multiple"
              disabled={mutation.isPending}
              style={{ width: '100%', marginTop: 8 }}
              value={column.accountCodes}
              options={accounts.map((a) => ({ value: a.code, label: `${a.code} ${a.fullName}` }))}
              showSearch={{ optionFilterProp: 'label' }}
              placeholder="选择对应科目，包含上级的全部明细"
              onChange={(accountCodes) => change(index, { accountCodes })}
            />
          </Card>
        ))}
        <Space>
          <Button
            disabled={mutation.isPending || columns.filter((c) => c.side === 'debit').length >= 5}
            onClick={() => add('debit')}
          >
            增加借方栏目
          </Button>
          <Button
            disabled={mutation.isPending || columns.filter((c) => c.side === 'credit').length >= 5}
            onClick={() => add('credit')}
          >
            增加贷方栏目
          </Button>
        </Space>
      </Space>
    </Drawer>
  );
}
