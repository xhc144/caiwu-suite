import { Alert, Button, Divider, Input, Modal, Space, Spin, Table } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { queryClient, usePermission } from '@caiwu/web-kit';
import { downloadBlob } from '@caiwu/ui';
import { StatutoryImportSchema, type StatutoryProfile } from '../shared';
import { api } from './api';

export function StatutoryChoices() {
  const catalog = useQuery(api.statutory.catalog.queryOptions());
  if (catalog.isLoading) return <Spin />;
  if (catalog.isError)
    return (
      <Alert
        type="error"
        title="读取法定报表失败"
        action={<Button onClick={() => void catalog.refetch()}>重试</Button>}
      />
    );
  if (!catalog.data?.length) return <p>当前账套暂无已接入的法定报表。</p>;
  return (
    <>
      {catalog.data.map((def) => (
        <div key={def.definitionId}>
          <p>{def.name}</p>
          <Space wrap>
            {def.descriptors.map((d) => (
              <Button
                key={d.key}
                href={`/m/report-engine/statutory?${new URLSearchParams({
                  definitionId: def.definitionId,
                  definitionRevision: String(def.definitionRevision),
                  reportKey: d.key,
                  code: d.code,
                  name: d.name,
                  scope: d.annualOnly ? 'annual' : 'month',
                })}`}
              >
                {d.name}
                {d.annualOnly ? '（年报）' : ''}
              </Button>
            ))}
          </Space>
        </div>
      ))}
    </>
  );
}
export default function StatutoryList() {
  const list = useQuery(api.statutory.list.queryOptions());
  const canEdit = usePermission('report-engine.edit');
  const canExport = usePermission('report-engine.export');
  const [copying, setCopying] = useState<StatutoryProfile | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: api.statutory.list.queryKey() });
  const copy = useMutation(
    api.statutory.copy.mutationOptions({
      onSuccess: () => {
        setCopying(null);
        void refresh();
      },
    }),
  );
  const importing = useMutation(
    api.statutory.importTemplate.mutationOptions({ onSuccess: () => void refresh() }),
  );
  const exportTemplate = async (id: number) => {
    const envelope = await queryClient.fetchQuery({
      ...api.statutory.exportTemplate.queryOptions({ id }),
      staleTime: 0,
    });
    downloadBlob(
      new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }),
      `${envelope.code}-${envelope.name}-配置.json`,
    );
  };
  return (
    <section aria-label="法定报表管理">
      <h2>法定报表</h2>
      {canEdit && <StatutoryChoices />}
      <p>按账套制度选择报表，确认分类依据后生成。企业完整财务报告还需附注及首次执行附件。</p>
      {canEdit && (
        <label>
          引入法定报表配置{' '}
          <input
            aria-label="引入法定报表配置"
            type="file"
            accept=".json,application/json"
            disabled={importing.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 2_000_000) {
                setError('配置文件不能超过2MB');
                return;
              }
              void file.text().then(async (text) => {
                try {
                  await importing.mutateAsync(StatutoryImportSchema.parse(JSON.parse(text)));
                  setError('');
                } catch (e) {
                  setError(e instanceof Error ? e.message : '配置引入失败');
                }
              });
            }}
          />
        </label>
      )}
      {(error || list.isError) && (
        <Alert type="error" title={error || '读取法定报表失败，请刷新重试'} />
      )}
      <Table<StatutoryProfile>
        rowKey="id"
        size="small"
        loading={list.isLoading}
        dataSource={list.data ?? []}
        pagination={false}
        columns={[
          { title: '编码', dataIndex: 'code' },
          { title: '报表名称', dataIndex: 'name' },
          { title: '配置版本', dataIndex: 'revision' },
          {
            title: '操作',
            key: 'actions',
            render: (_, p) => (
              <Space wrap>
                <Button type="link" href={`/m/report-engine/statutory?id=${p.id}`}>
                  配置/生成/查看
                </Button>
                {canEdit && (
                  <Button
                    type="link"
                    onClick={() => {
                      setCopying(p);
                      setCode('');
                      setName(`${p.name}副本`);
                    }}
                  >
                    复制法定报表
                  </Button>
                )}
                {canExport && (
                  <Button
                    type="link"
                    onClick={() => void exportTemplate(p.id).catch((e) => setError(String(e)))}
                  >
                    导出配置
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
        locale={{ emptyText: '尚未保存法定报表配置' }}
      />
      <Modal
        title="复制法定报表"
        open={!!copying}
        onCancel={() => setCopying(null)}
        confirmLoading={copy.isPending}
        onOk={() =>
          copying && copy.mutate({ id: copying.id, expectedRevision: copying.revision, code, name })
        }
      >
        <p>副本保留法定报表格式和已确认分类资料。</p>
        <Input
          aria-label="副本报表编码"
          placeholder="副本报表编码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Input aria-label="副本报表名称" value={name} onChange={(e) => setName(e.target.value)} />
      </Modal>
      <Divider>自定义报表</Divider>
    </section>
  );
}
