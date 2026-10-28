import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Drawer, Input, Modal, Select, Space, Spin, Typography } from 'antd';
import { notify, queryClient, useAccounts, useUnsavedChanges } from '@caiwu/web-kit';
import { MultiFormatSchema, type MultiColumn } from '../shared';
import { api } from './api';

type Props = {
  open: boolean;
  onClose: () => void;
  kind: 'multi' | 'auxiliary-multi';
  account: string;
  onSaved: () => void;
};

export function MultiColumnDrawer(props: Props) {
  const config = useQuery({
    ...api.multiFormat.queryOptions({ kind: props.kind, account: props.account }),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  if (config.data)
    return <Editor {...props} key={`${props.kind}-${props.account}`} format={config.data} />;
  return (
    <Drawer open={props.open} onClose={props.onClose} title="设置多栏账栏目">
      {config.error ? (
        <Alert
          type="error"
          title="栏目读取失败"
          description={config.error.message}
          action={<Button onClick={() => void config.refetch()}>重试</Button>}
        />
      ) : (
        <Spin />
      )}
    </Drawer>
  );
}

function Editor({
  format: loadedFormat,
  ...props
}: Props & { format: { columns: MultiColumn[]; revision: number } }) {
  const [format] = useState(loadedFormat);
  const { byCode, accounts: all } = useAccounts();
  const [columns, setColumns] = useState<MultiColumn[]>(format.columns);
  const [saved, setSaved] = useState(JSON.stringify(format.columns));
  const [validation, setValidation] = useState('');
  const [modal, context] = Modal.useModal();
  const mutation = useMutation(api.saveMultiFormat.mutationOptions());
  const dirty = JSON.stringify(columns) !== saved;
  const save = async () => {
    if (mutation.isPending) return false;
    const parsed = MultiFormatSchema.safeParse({ columns, revision: format.revision });
    if (!parsed.success || !columns.length) {
      setValidation(
        parsed.success
          ? '请至少增加一个栏目。'
          : parsed.error.issues.map((x) => x.message).join('；'),
      );
      return false;
    }
    try {
      const result = await mutation.mutateAsync({
        kind: props.kind,
        account: props.account,
        columns: parsed.data.columns,
        expectedRevision: format.revision,
        confirmed: true,
      });
      queryClient.setQueryData(
        api.multiFormat.queryKey({ kind: props.kind, account: props.account }),
        result,
      );
      setSaved(JSON.stringify(result.columns));
      notify.success('多栏账栏目已保存');
      props.onSaved();
      props.onClose();
      return true;
    } catch {
      return false;
    }
  };
  useUnsavedChanges({
    title: `${props.account} 多栏账栏目`,
    dirty,
    version: JSON.stringify(columns),
    save,
    discard: () => {
      setColumns(format.columns);
      setSaved(JSON.stringify(format.columns));
    },
  });
  const close = async () => {
    if (mutation.isPending) return;
    if (
      dirty &&
      !(await modal.confirm({
        title: '放弃未保存的栏目修改？',
        content: '已保存的栏目仍可继续使用。',
        okText: '放弃修改',
        cancelText: '继续编辑',
      }))
    )
      return;
    props.onClose();
  };
  const change = (index: number, patch: Partial<MultiColumn>) => {
    setColumns((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setValidation('');
  };
  const parent = byCode.get(props.account);
  const descendants = all.filter(
    (a) => a.code.startsWith(props.account) && a.code !== props.account,
  );
  return (
    <Drawer
      open={props.open}
      width={720}
      onClose={() => void close()}
      title="设置多栏账栏目"
      footer={
        <Space>
          <Button onClick={() => void close()}>取消</Button>
          <Button type="primary" loading={mutation.isPending} onClick={() => void save()}>
            确认保存栏目
          </Button>
        </Space>
      }
    >
      {context}
      <Typography.Paragraph>
        {parent?.code} {parent?.fullName}
        。每个栏目选择一个或多个下级科目，可按借方、贷方或借减贷净额显示。父子科目不可在同一侧重复列计；修改失败会保留当前内容。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        净额栏期初、期末显示借正贷负的余额，借方、贷方栏显示发生额。保存后应用自定义栏目；查询栏可切回下级自动分栏。
      </Typography.Paragraph>
      {validation && <Alert type="error" title="栏目设置不完整" description={validation} />}
      {mutation.error && (
        <Alert type="error" title="栏目未保存" description={mutation.error.message} />
      )}
      <Space orientation="vertical" style={{ width: '100%' }}>
        {columns.map((column, index) => (
          <Card
            key={column.id}
            size="small"
            title={`第 ${index + 1} 栏`}
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
                  disabled={mutation.isPending}
                  danger
                  onClick={() => setColumns((rows) => rows.filter((_, i) => i !== index))}
                >
                  删除
                </Button>
              </Space>
            }
          >
            <Space wrap>
              <Input
                disabled={mutation.isPending}
                aria-label={`第${index + 1}栏名称`}
                value={column.label}
                placeholder="栏目名称"
                maxLength={60}
                onChange={(e) => change(index, { label: e.target.value })}
              />
              <Select
                disabled={mutation.isPending}
                aria-label={`第${index + 1}栏方向`}
                style={{ width: 150 }}
                value={column.side}
                options={[
                  { value: 'debit', label: '借方发生额' },
                  { value: 'credit', label: '贷方发生额' },
                  { value: 'net', label: '净额（借减贷）' },
                ]}
                onChange={(side) => change(index, { side })}
              />
            </Space>
            <Select
              disabled={mutation.isPending}
              aria-label={`第${index + 1}栏科目`}
              mode="multiple"
              style={{ width: '100%', marginTop: 8 }}
              value={column.accountCodes}
              placeholder="选择下级科目（包含其明细科目）"
              showSearch={{ optionFilterProp: 'label' }}
              options={descendants.map((a) => ({
                value: a.code,
                label: `${a.code} ${a.fullName}`,
              }))}
              onChange={(accountCodes) => change(index, { accountCodes })}
            />
          </Card>
        ))}
        <Button
          disabled={mutation.isPending || columns.length >= 500}
          onClick={() =>
            setColumns((rows) => [
              ...rows,
              {
                id: `c_${crypto.randomUUID().replaceAll('-', '')}`,
                label: '',
                accountCodes: [],
                side: 'net',
              },
            ])
          }
        >
          增加栏目
        </Button>
      </Space>
    </Drawer>
  );
}
