import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Input, Popconfirm, Space, Typography } from 'antd';
import { queryClient, usePermission, useUnsavedChanges } from '@caiwu/web-kit';
import { DataTable, PageContainer } from '@caiwu/ui';
import type { PayrollTransferInput } from '../shared-transfer';
import { api } from './api';

const labels: Record<string, string> = {
  account: '会计科目',
  department: '部门',
  project: '项目',
  partner: '客供',
  person: '个人',
  cashflow: '现金流量',
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') reject(new Error('文件读取失败'));
      else resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
function download(name: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
export default function TransferPage() {
  const canExport = usePermission('payroll.export');
  const canSalary = usePermission('payroll.salary.edit');
  const canHr = usePermission('payroll.hr.edit');
  const canVoucher = usePermission('payroll.voucher');
  const canTax = usePermission('payroll.tax.configure');
  const canTransfer = canSalary && canHr && canVoucher && canTax;
  const [file, setFile] = useState(''),
    [fileName, setFileName] = useState(''),
    [mappings, setMappings] = useState<PayrollTransferInput['mappings']>([]),
    [targetName, setTargetName] = useState(''),
    [restoreName, setRestoreName] = useState(''),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [phase, setPhase] = useState<string | null>(null);
  const inFlight = useRef(false);
  const inspect = useMutation(api.inspectTransfer.mutationOptions()),
    preview = useMutation(api.previewTransfer.mutationOptions()),
    apply = useMutation(api.applyTransfer.mutationOptions()),
    restorePreview = useMutation(api.previewTransferRestore.mutationOptions()),
    restore = useMutation(api.applyTransferRestore.mutationOptions());
  const [inspection, setInspection] = useState<typeof inspect.data>();
  const backups = useQuery({ ...api.transferBackups.queryOptions(), enabled: canTransfer });
  const clear = () => {
    if (inFlight.current) return;
    setFile('');
    setFileName('');
    setMappings([]);
    setTargetName('');
    inspect.reset();
    setInspection(undefined);
    preview.reset();
  };
  useUnsavedChanges({
    title: '工资跨账套转入',
    dirty: !!file,
    version: JSON.stringify({ file, mappings }),
    save: async () => false,
    discard: clear,
  });
  const run = async (name: string, work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase(name);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      inFlight.current = false;
      setPhase(null);
    }
  };
  const choose = (selectedFile: File) =>
    run('read', async () => {
      preview.reset();
      if (!selectedFile.name.endsWith('.caiwu-payroll') || selectedFile.size > 525000)
        throw new Error(
          '请选择本系统导出的工资文件，文件须不超过512KB；先前文件和编码映射已保留。',
        );
      const value = await readFile(selectedFile);
      const result = await inspect.mutateAsync({ file: value, mappings: [] });
      setFile(value);
      setFileName(selectedFile.name);
      setMappings([]);
      setTargetName('');
      setInspection(result);
    });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: api.pathKey() });
  };
  return (
    <PageContainer
      title="工资转入与模块备份"
      subtitle="通过工资专用文件迁移本模块的结构、档案、输入及历史快照。"
    >
      <Alert
        type="info"
        title="转入会覆盖目标账套全部工资数据，先保留可恢复的工资模块保护副本。"
        description="包含人事基本资料、任职记录、工资结构及公式、工资输入、历史计算快照、打印和凭证设置；部门、科目及其他辅助档案按编码映射到目标已有档案。保留来源税额，标记为导入历史；来源凭证不转入。"
      />
      <Typography.Title level={5}>转出当前工资</Typography.Title>
      <Button
        disabled={!canExport || !!phase}
        loading={phase === 'export'}
        onClick={() =>
          void run('export', async () => {
            const result = await queryClient.fetchQuery({
              ...api.exportTransfer.queryOptions(),
              staleTime: 0,
            });
            download(result.fileName, result.base64);
            setSuccess(`已转出${result.counts.employees}人、${result.counts.batches}个工资批次。`);
          })
        }
      >
        转出工资专用文件
      </Button>
      <Typography.Title level={5}>从工资文件转入</Typography.Title>
      {!canTransfer && (
        <Alert type="warning" title="转入和恢复需要工资维护、人事维护、凭证设置及计税参数权限。" />
      )}
      <p>
        <input
          type="file"
          accept=".caiwu-payroll"
          aria-label="跨账套工资文件"
          disabled={!canTransfer || !!phase}
          onChange={(event) => {
            const selectedFile = event.target.files?.[0];
            if (selectedFile) void choose(selectedFile);
            event.target.value = '';
          }}
        />
      </p>
      {fileName && <p>文件：{fileName}</p>}
      {inspection && (
        <>
          <p>
            来源账套：{inspection.source.name}；{inspection.counts.employees}人、
            {inspection.counts.categories}个类别、{inspection.counts.batches}
            个工资批次。来源关联凭证{inspection.sourceVoucherCount}张，凭证不转入。
          </p>
          <DataTable
            tableId="payroll.transfer.references"
            rowKey={(r) => `${r.kind}.${r.sourceCode}`}
            dataSource={inspection.references}
            columns={[
              { key: 'kind', title: '档案', width: 110, render: (_, r) => labels[r.kind] },
              {
                key: 'source',
                title: '来源编码及名称',
                width: 200,
                render: (_, r) => `${r.sourceCode} ${r.sourceName}`,
              },
              {
                key: 'target',
                title: '目标编码',
                width: 180,
                render: (_, r) => (
                  <Input
                    aria-label={`目标编码-${r.kind}-${r.sourceCode}`}
                    disabled={!!phase}
                    value={
                      mappings.find((m) => m.kind === r.kind && m.sourceCode === r.sourceCode)
                        ?.targetCode ?? r.targetCode
                    }
                    onChange={(event) => {
                      const targetCode = event.target.value;
                      setMappings((current) => [
                        ...current.filter(
                          (m) => m.kind !== r.kind || m.sourceCode !== r.sourceCode,
                        ),
                        {
                          kind: r.kind as PayrollTransferInput['mappings'][number]['kind'],
                          sourceCode: r.sourceCode,
                          targetCode,
                        },
                      ]);
                      preview.reset();
                    }}
                  />
                ),
              },
              {
                key: 'found',
                title: '初始匹配',
                width: 200,
                render: (_, r) => (r.found ? r.targetName : '未匹配，请填写目标编码'),
              },
            ]}
          />
          <Space>
            <Button
              disabled={!!phase}
              loading={phase === 'preview'}
              onClick={() =>
                void run('preview', async () => {
                  await preview.mutateAsync({ file, mappings });
                  setTargetName('');
                })
              }
            >
              预览工资覆盖范围
            </Button>
            <Popconfirm
              title="确认放弃本次工资转入文件和映射？"
              disabled={!!phase}
              onConfirm={clear}
            >
              <Button disabled={!!phase}>放弃跨账套工资转入</Button>
            </Popconfirm>
          </Space>
        </>
      )}
      {preview.data && (
        <>
          <Alert
            type="warning"
            title={`目标账套：${preview.data.targetName}`}
            description={`覆盖前：${preview.data.before.employees}人、${preview.data.before.batches}个批次；转入后：${preview.data.after.employees}人、${preview.data.after.batches}个批次。来源历史税额不重算，转入前将实际回装保护副本核验后再覆盖。`}
          />
          <DataTable
            tableId="payroll.transfer.resolved"
            rowKey={(r) => `${r.kind}.${r.sourceCode}`}
            dataSource={preview.data.references}
            columns={[
              { key: 'kind', title: '档案', width: 100, render: (_, r) => labels[r.kind] },
              {
                key: 'source',
                title: '来源',
                width: 180,
                render: (_, r) => `${r.sourceCode} ${r.sourceName}`,
              },
              {
                key: 'target',
                title: '目标',
                width: 180,
                render: (_, r) => `${r.targetCode} ${r.targetName}`,
              },
            ]}
          />
          <p>
            <Input
              aria-label="转入目标账套名称确认"
              placeholder="输入目标账套完整名称"
              disabled={!!phase}
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
            />
          </p>
          <Popconfirm
            title="再次确认覆盖目标账套全部工资数据？"
            disabled={!!phase || targetName !== preview.data.targetName}
            onConfirm={() =>
              void run('apply', async () => {
                if (!preview.data) return;
                const result = await apply.mutateAsync({
                  file,
                  mappings,
                  hash: preview.data.hash,
                  expiresAt: preview.data.expiresAt,
                  confirmed: true,
                  targetName,
                });
                setSuccess(`工资转入完成，覆盖前工资模块保护副本编号${result.backup.id}。`);
                setFile('');
                setFileName('');
                inspect.reset();
                setInspection(undefined);
                preview.reset();
                refresh();
              })
            }
          >
            <Button
              type="primary"
              danger
              disabled={!!phase || targetName !== preview.data.targetName}
              loading={phase === 'apply'}
            >
              确认覆盖转入工资
            </Button>
          </Popconfirm>
        </>
      )}
      <Typography.Title level={5}>工资模块保护副本</Typography.Title>
      <p>
        副本只恢复本模块数据，不改变会计凭证、其他模块和整套账的备份。恢复前也会保留当前工资模块副本。
      </p>
      <DataTable
        tableId="payroll.transfer.backups"
        rowKey="id"
        loading={backups.isLoading}
        dataSource={backups.data ?? []}
        columns={[
          { key: 'id', title: '编号', dataIndex: 'id', width: 70 },
          { key: 'created', title: '时间', dataIndex: 'created_at', width: 190 },
          { key: 'reason', title: '原因', dataIndex: 'reason', width: 250 },
          {
            key: 'restore',
            title: '操作',
            width: 140,
            render: (_, r) => (
              <Button
                disabled={!!phase || !canTransfer}
                onClick={() =>
                  void run('restore-preview', async () => {
                    await restorePreview.mutateAsync({ id: r.id });
                    setRestoreName('');
                  })
                }
              >
                预览恢复工资
              </Button>
            ),
          },
        ]}
      />
      {restorePreview.data && (
        <>
          <Alert
            type="warning"
            title={`将恢复工资副本${restorePreview.data.id}到 ${restorePreview.data.targetName}`}
            description={`当前${restorePreview.data.before.employees}人/${restorePreview.data.before.batches}批次，恢复后${restorePreview.data.after.employees}人/${restorePreview.data.after.batches}批次。`}
          />
          <p>
            <Input
              aria-label="恢复目标账套名称确认"
              placeholder="输入目标账套完整名称"
              disabled={!!phase}
              value={restoreName}
              onChange={(e) => setRestoreName(e.target.value)}
            />
          </p>
          <Popconfirm
            title="确认覆盖当前工资并恢复所选模块副本？"
            disabled={!!phase || restoreName !== restorePreview.data.targetName}
            onConfirm={() =>
              void run('restore', async () => {
                if (!restorePreview.data) return;
                await restore.mutateAsync({
                  id: restorePreview.data.id,
                  hash: restorePreview.data.hash,
                  expiresAt: restorePreview.data.expiresAt,
                  targetName: restoreName,
                  confirmed: true,
                });
                setSuccess('工资模块保护副本已恢复并核验。');
                restorePreview.reset();
                refresh();
              })
            }
          >
            <Button
              danger
              disabled={!!phase || restoreName !== restorePreview.data.targetName}
              loading={phase === 'restore'}
            >
              确认恢复工资模块
            </Button>
          </Popconfirm>
        </>
      )}
      {error && <Alert type="error" title={`操作未完成，文件和选择已保留：${error}`} />}
      {success && <Alert type="success" title={success} />}
    </PageContainer>
  );
}
