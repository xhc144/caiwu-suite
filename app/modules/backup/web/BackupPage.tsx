import { memo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Progress,
  Radio,
  Space,
  Switch,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { productName } from '@caiwu/core';
import { DataTable, PageContainer, type DataColumn } from '@caiwu/ui';
import {
  notify,
  queryClient,
  sessionStore,
  usePermission,
  useRequiredSession,
} from '@caiwu/web-kit';
import { DEFAULT_SETTINGS, TRANSFER_LIMIT, type BackupSettings } from '../shared';
import type { BackupListItem } from '../server/service';
import { api } from './api';

const labels: Record<string, string> = {
  running: '正在备份',
  valid: '校验通过',
  invalid: '校验失败',
  failed: '失败',
  cancelled: '已取消',
  pruned: '已删除',
  manual: '手动',
  automatic: '自动',
  'pre-restore': '恢复前保护',
  imported: '上传',
};
const regimeNames: Record<string, string> = {
  enterprise: '企业会计制度',
  'small-business': '小企业会计制度',
  nonprofit: '民间非营利组织会计制度',
};
const size = (v: number) => `${(v / 1024 / 1024).toFixed(2)} MiB`;
type Plan = {
  id: string;
  target_id: string;
  target_name: string;
  confirmation: string;
  purpose: string;
  metadata: NonNullable<BackupListItem['metadata']>;
  status: string;
  expires_at: string;
  targetBook: { name: string; startPeriod: number };
  targetPeriod: number | null;
};
type BatchRow = {
  key: string;
  name: string;
  status: string;
  backupId?: string;
  plan?: Plan;
  error?: string;
};
function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.readAsDataURL(file);
  });
}
function BackupPage() {
  const session = useRequiredSession();
  const view = useQuery(api.overview.queryOptions());
  const list = useQuery({
    ...api.list.queryOptions(),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 500 : false),
  });
  const [name, setName] = useState('完整备份');
  const requestId = useRef(crypto.randomUUID());
  const [purpose, setPurpose] = useState<'copy' | 'overwrite'>('copy');
  const [copyName, setCopyName] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [text, setText] = useState('');
  const [password, setPassword] = useState('');
  const [protection, setProtection] = useState<{
    location: string;
    createdAt: string;
    available: boolean;
    expiresAt: string;
  } | null>(null);
  const [result, setResult] = useState<{
    bookId: string;
    name: string;
    purpose: 'copy' | 'overwrite';
  } | null>(null);
  const [deletion, setDeletion] = useState<BackupListItem | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [batch, setBatch] = useState<BatchRow[]>([]);
  const cancelled = useRef(false);
  const [uploading, setUploading] = useState(false);
  const canCreate = usePermission('backup.create'),
    canVerify = usePermission('backup.verify'),
    canExport = usePermission('backup.export'),
    canPrune = usePermission('backup.prune'),
    canRestore = usePermission('backup.restore') && session.user.isAdmin,
    canSettings = usePermission('backup.settings');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: api.list.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.overview.queryKey() });
  };
  const create = useMutation(
    api.create.mutationOptions({
      onSuccess: () => {
        requestId.current = crypto.randomUUID();
        refresh();
      },
    }),
  );
  const cancel = useMutation(api.cancel.mutationOptions({ onSuccess: refresh }));
  const verify = useMutation(
    api.verify.mutationOptions({
      onSuccess: () => {
        notify.success('SQLite 完整性、长度、摘要和迁移版本校验通过');
        refresh();
      },
      onError: refresh,
    }),
  );
  const download = useMutation(
    api.download.mutationOptions({
      onSuccess: (data) => {
        const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = data.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    }),
  );
  const upload = useMutation(api.upload.mutationOptions());
  const preview = useMutation(
    api.preview.mutationOptions({
      onSuccess: (p) => {
        setPlan(p);
        setText('');
        setPassword('');
        setProtection(null);
      },
    }),
  );
  const cancelPlan = useMutation(
    api.cancelPlan.mutationOptions({
      onSuccess: () => {
        setPlan(null);
        setProtection(null);
      },
    }),
  );
  const prepare = useMutation(
    api.prepareOverwrite.mutationOptions({
      onSuccess: (p) => {
        setProtection(p);
        refresh();
      },
    }),
  );
  const restore = useMutation(
    api.restore.mutationOptions({
      onSuccess: (r) => {
        setResult(r);
        setPassword('');
      },
      onError: () => {
        setPassword('');
        setProtection(null);
        refresh();
      },
    }),
  );
  const prune = useMutation(
    api.prune.mutationOptions({
      onSuccess: () => {
        setDeletion(null);
        setDeletePassword('');
        refresh();
      },
    }),
  );
  const save = useMutation(
    api.saveSettings.mutationOptions({
      onSuccess: () => {
        notify.success('自动备份配置已保存');
        refresh();
      },
    }),
  );
  const busy = create.isPending || list.data?.some((r) => r.status === 'running');
  const columns: DataColumn<BackupListItem>[] = [
    { key: 'name', title: '备份名称', dataIndex: 'name', width: 180 },
    {
      key: 'book',
      title: '来源账套 / 期间',
      width: 230,
      render: (_, r) =>
        r.metadata ? `${r.metadata.book.name} / ${r.metadata.book.currentPeriod}` : '—',
    },
    { key: 'kind', title: '类型', width: 110, render: (_, r) => labels[r.kind] },
    { key: 'date', title: '创建时间', dataIndex: 'created_at', width: 200 },
    { key: 'size', title: '大小', width: 100, render: (_, r) => size(r.bytes) },
    {
      key: 'status',
      title: '校验状态与原因',
      width: 260,
      render: (_, r) => (
        <Space orientation="vertical">
          <span>
            {labels[r.status]} {r.reason}
          </span>
          {r.status === 'running' && <Progress percent={r.progress} size="small" />}
          {r.retention_note && <span>{r.retention_note}</span>}
        </Space>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 290,
      noExport: true,
      render: (_, r) => (
        <Space wrap>
          {r.status === 'running' && canCreate && (
            <Button size="small" onClick={() => cancel.mutate({ id: r.id })}>
              取消备份
            </Button>
          )}
          {['valid', 'invalid'].includes(r.status) && (
            <>
              {canVerify && (
                <Button
                  size="small"
                  loading={verify.isPending}
                  onClick={() => verify.mutate({ id: r.id })}
                >
                  校验
                </Button>
              )}
              {canExport && (
                <Button
                  size="small"
                  loading={download.isPending}
                  onClick={() => download.mutate({ id: r.id })}
                >
                  下载
                </Button>
              )}
              {canRestore && (
                <Button
                  size="small"
                  loading={preview.isPending}
                  onClick={() =>
                    preview.mutate({
                      id: r.id,
                      purpose,
                      name: purpose === 'copy' && copyName.trim() ? copyName : undefined,
                    })
                  }
                >
                  恢复预览
                </Button>
              )}
              {canPrune && r.kind !== 'pre-restore' && (
                <Button
                  danger
                  size="small"
                  onClick={() => {
                    setDeletion(r);
                    setDeleteText('');
                    setDeletePassword('');
                  }}
                >
                  删除
                </Button>
              )}
            </>
          )}
        </Space>
      ),
    },
  ];
  const updateBatch = (key: string, patch: Partial<BatchRow>) =>
    setBatch((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const readFiles = async (files: File[]) => {
    cancelled.current = false;
    setUploading(true);
    const rows = files.map((f) => ({ key: crypto.randomUUID(), name: f.name, status: '等待预检' }));
    setBatch(rows);
    const sourceIds = new Set<string>();
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!,
          row = rows[i]!;
        if (cancelled.current) {
          updateBatch(row.key, { status: '已取消未开始项' });
          continue;
        }
        if (file.size > TRANSFER_LIMIT) {
          updateBatch(row.key, {
            status: '拒绝',
            error: '文件超过 32 MiB，暂不能从浏览器上传',
          });
          continue;
        }
        updateBatch(row.key, { status: '上传并校验中' });
        try {
          const item = await upload.mutateAsync({
            name: file.name.replace(/\.caiwubak$/i, '').slice(0, 60),
            base64: await base64(file),
          });
          const meta = item.metadata
            ? (JSON.parse(item.metadata) as NonNullable<BackupListItem['metadata']>)
            : null;
          if (meta && sourceIds.has(meta.book.id)) {
            updateBatch(row.key, {
              backupId: item.id,
              status: '重复来源 ID',
              error: '本批次已包含此账套；请单独预览所需版本',
            });
            continue;
          }
          if (meta) sourceIds.add(meta.book.id);
          if (canRestore) {
            const p = await preview.mutateAsync({
              id: item.id,
              purpose,
              name: purpose === 'copy' && copyName.trim() ? copyName : undefined,
            });
            updateBatch(row.key, {
              backupId: item.id,
              status: p.status === 'done' ? '已引入，不重复创建' : '预检通过',
              plan: p,
            });
          } else updateBatch(row.key, { backupId: item.id, status: '校验通过；无管理员恢复权限' });
        } catch (e) {
          updateBatch(row.key, {
            status: '拒绝',
            error: e instanceof Error ? e.message : '预检失败',
          });
        }
      }
    } finally {
      setUploading(false);
      refresh();
    }
  };
  if (result)
    return (
      <PageContainer title={result.purpose === 'overwrite' ? '已覆盖恢复账套' : '已恢复为新账套'}>
        <Alert
          type="success"
          title={
            result.purpose === 'overwrite'
              ? `账套「${result.name}」已恢复`
              : `新副本「${result.name}」已发布`
          }
          description={`${result.purpose === 'overwrite' ? '恢复前保护备份已保留。' : '原账套保留。'}请重新登录「${result.name}」，使用备份中的操作员及密码。`}
        />
        <Button
          type="primary"
          onClick={() => {
            sessionStore.set(null);
            queryClient.clear();
            window.location.assign('/');
          }}
        >
          重新登录
        </Button>
      </PageContainer>
    );
  return (
    <PageContainer
      title="备份恢复"
      subtitle="完整备份账套及所有业务数据。恢复前请核对来源、期间和目标账套。"
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="warning"
          title="恢复可新建账套，也可覆盖当前账套"
          description="覆盖前须生成保护备份、输入确认文字并核对当前管理员密码。恢复会替换全部业务数据与操作员资料，完成后请重新登录。请选择可信来源的新版备份包；原版 .bak 请使用原账导入功能。"
        />
        {deletion && (
          <Card title="删除受管备份确认">
            <p>
              备份：{deletion.name}；时间：{deletion.created_at}；大小：{size(deletion.bytes)}
              。删除后不能在本目录下载。
            </p>
            <Form layout="vertical" style={{ maxWidth: 620 }}>
              <Form.Item label={`请输入：删除备份 ${deletion.id}`}>
                <Input
                  aria-label="删除确认文字"
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                />
              </Form.Item>
              <Form.Item label="当前操作员密码">
                <Input.Password
                  aria-label="删除操作员密码"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="off"
                />
              </Form.Item>
              <Space>
                <Button
                  danger
                  disabled={!canPrune || deleteText !== `删除备份 ${deletion.id}`}
                  loading={prune.isPending}
                  onClick={() =>
                    prune.mutate({ id: deletion.id, text: deleteText, password: deletePassword })
                  }
                >
                  确认删除此备份
                </Button>
                <Button
                  disabled={prune.isPending}
                  onClick={() => {
                    setDeletion(null);
                    setDeletePassword('');
                  }}
                >
                  取消删除
                </Button>
              </Space>
            </Form>
          </Card>
        )}
        <Card title="手动完整备份">
          <p>
            当前账套：{view.data?.book.name}；期间：{view.data?.period?.period}；预计 SQLite 大小：
            {size(view.data?.estimatedBytes ?? 0)}。受管位置：{view.data?.managedRoot}
            /手动与保护。同名自动使用不同 ID。
          </p>
          <Space wrap>
            <Input
              aria-label="备份名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: 240 }}
            />
            <Button
              type="primary"
              disabled={!canCreate || busy}
              loading={create.isPending}
              onClick={() => create.mutate({ name, requestId: requestId.current })}
            >
              开始备份
            </Button>
            <Button onClick={refresh}>刷新状态</Button>
          </Space>
        </Card>
        <Card title="恢复目的与上传">
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Radio.Group
              aria-label="恢复目的"
              value={purpose}
              onChange={(e) => {
                setPurpose(e.target.value as 'copy' | 'overwrite');
                setPlan(null);
                setProtection(null);
                setPassword('');
              }}
              options={[
                { label: '恢复为新账套（原账套保留）', value: 'copy' },
                { label: '覆盖当前账套（先生成保护备份）', value: 'overwrite' },
              ]}
            />
            <Input
              aria-label="副本名称"
              placeholder="副本名称（可选；预览时自动生成新 ID）"
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              style={{ maxWidth: 400 }}
            />
            <label>
              选择本地可携带包（多选，单包 ≤32 MiB，逐包预检）：
              <input
                aria-label="上传备份包"
                type="file"
                accept=".caiwubak"
                multiple
                disabled={!canVerify || uploading}
                onChange={(e) => {
                  void readFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </label>
            {uploading && (
              <Button
                onClick={() => {
                  cancelled.current = true;
                }}
              >
                取消未开始的上传
              </Button>
            )}
            <DataTable
              tableId="backup-batch"
              rowKey="key"
              pagination={false}
              dataSource={batch}
              columns={[
                { key: 'file', title: '文件', dataIndex: 'name', width: 200 },
                {
                  key: 'target',
                  title: '恢复目标编号 / 名称',
                  width: 340,
                  render: (_, r) => (r.plan ? `${r.plan.target_id} / ${r.plan.target_name}` : '—'),
                },
                {
                  key: 'status',
                  title: '预检状态',
                  width: 220,
                  render: (_, r) => `${r.status} ${r.error ?? ''}`,
                },
                {
                  key: 'action',
                  title: '逐项恢复',
                  width: 180,
                  render: (_, r) =>
                    r.plan?.status === 'ready' && (
                      <Space>
                        <Button
                          onClick={() => {
                            if (r.plan?.purpose === 'overwrite' && r.backupId)
                              preview.mutate({ id: r.backupId, purpose: 'overwrite' });
                            else {
                              setPlan(r.plan!);
                              setProtection(null);
                              setText('');
                              setPassword('');
                            }
                          }}
                        >
                          确认此项
                        </Button>
                        <Button
                          onClick={() => {
                            cancelPlan.mutate({ id: r.plan!.id });
                            updateBatch(r.key, { status: '已取消', plan: undefined });
                          }}
                        >
                          取消此项
                        </Button>
                      </Space>
                    ),
                },
              ]}
            />
            <span style={{ color: '#666' }}>
              合法项独立引入；失败不删除已成功项。每项须由管理员复核并输入密码。成功后必须重新登录，可再次上传剩余包；已引入包不会重复建套。
            </span>
          </Space>
        </Card>
        {plan && (
          <Card title="恢复预览与确认">
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                { key: 'source', label: '来源账套', children: plan.metadata.book.name },
                { key: 'org', label: '单位', children: plan.metadata.book.orgName },
                {
                  key: 'product',
                  label: '产品 / 制度',
                  children: `${productName(plan.metadata.book.product)} / ${regimeNames[plan.metadata.book.regime] ?? plan.metadata.book.regime}`,
                },
                {
                  key: 'period',
                  label: '启用 / 当前期间',
                  children: `${plan.metadata.book.startPeriod} / ${plan.metadata.book.currentPeriod}`,
                },
                { key: 'date', label: '备份时间', children: plan.metadata.createdAt },
                { key: 'target', label: '当前目标账套', children: plan.targetBook.name },
                {
                  key: 'new',
                  label: '恢复目的 / 目标 ID',
                  children: `${plan.purpose === 'copy' ? '新副本' : '覆盖当前'}：${plan.target_name} / ${plan.target_id}`,
                },
                { key: 'sourceId', label: '来源账套编号', children: plan.metadata.book.id },
                {
                  key: 'targetPeriod',
                  label: '当前账套启用 / 当前期间',
                  children: `${plan.targetBook.startPeriod} / ${plan.targetPeriod ?? '无开放期间'}`,
                },
                {
                  key: 'expiry',
                  label: '确认有效期',
                  children: protection?.expiresAt ?? plan.expires_at,
                },
              ]}
            />
            <Alert
              style={{ margin: '12px 0' }}
              type="warning"
              title={
                plan.purpose === 'copy'
                  ? '创建独立新账套，继承备份内的操作员与全部数据；原账套保留'
                  : '覆盖会替换当前账套全部数据和操作员资料；请先确认来源账套与期间'
              }
            />
            {plan.purpose === 'overwrite' && (
              <Space orientation="vertical">
                <Button
                  disabled={!canCreate || !canVerify}
                  loading={prepare.isPending}
                  onClick={() => prepare.mutate({ planId: plan.id })}
                >
                  先生成恢复前保护备份
                </Button>
                {protection && (
                  <p>
                    保护备份：{protection.location}；时间：{protection.createdAt}
                    。请在 {protection.expiresAt} 前确认；准备后账套有变化须重新预览。
                  </p>
                )}
              </Space>
            )}
            <Form layout="vertical" style={{ maxWidth: 620 }}>
              <Form.Item label={`请输入：${plan.confirmation}`}>
                <Input
                  aria-label="恢复确认文字"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoComplete="off"
                />
              </Form.Item>
              <Form.Item label="当前账套管理员密码">
                <Input.Password
                  aria-label="管理员密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </Form.Item>
              <Space>
                <Button
                  type="primary"
                  disabled={
                    (plan.purpose === 'overwrite' && !protection?.available) ||
                    !password ||
                    text !== plan.confirmation ||
                    !canRestore ||
                    plan.status === 'done'
                  }
                  loading={restore.isPending}
                  onClick={() => restore.mutate({ planId: plan.id, text, password })}
                >
                  {plan.purpose === 'overwrite' ? '确认覆盖当前账套' : '确认恢复为新账套'}
                </Button>
                <Button
                  disabled={restore.isPending}
                  onClick={() => cancelPlan.mutate({ id: plan.id })}
                >
                  取消恢复
                </Button>
              </Space>
            </Form>
          </Card>
        )}
        <DataTable
          tableId="backup-list"
          rowKey="id"
          columns={columns}
          dataSource={list.data ?? []}
          loading={list.isLoading}
          scroll={{ x: 1370 }}
          pagination={{ pageSize: 10 }}
        />
        <Card title="系统自动备份设置">
          <Alert
            type="info"
            title={view.data?.runtimeStatus ?? '正在读取自动备份配置'}
            description={`上次成功：${view.data?.lastSuccess?.created_at ?? '暂无'}；上次失败：${view.data?.lastFailure ? `${view.data.lastFailure.created_at} ${view.data.lastFailure.reason}` : '暂无'}；下次：${view.data?.nextAt ?? (view.data?.config.enabled ? '由本地服务按设定间隔安排' : '已关闭')}。`}
          />
          {view.data && (
            <Form<BackupSettings>
              key={JSON.stringify(view.data.config)}
              layout="vertical"
              initialValues={view.data.config ?? DEFAULT_SETTINGS}
              disabled={!canSettings}
              onFinish={(v) => save.mutate(v)}
              style={{ maxWidth: 500, marginTop: 16 }}
            >
              <Form.Item name="enabled" label="启用自动备份（默认开启）" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item
                name="directory"
                label={`受管目录名（位于 ${view.data.managedRoot} 下）`}
                rules={[{ required: true, message: '请设置备份目录' }]}
              >
                <Input />
              </Form.Item>
              <Form.Item name="onStart" label="启动时备份" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="onExit" label="正常退出时备份" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="intervalMinutes" label="定时间隔 / 分钟">
                <InputNumber min={5} max={43200} />
              </Form.Item>
              <Form.Item name="keep" label="保留有效自动备份份数（手动及保护备份不轮替）">
                <InputNumber min={1} max={100} />
              </Form.Item>
              <Button htmlType="submit" loading={save.isPending}>
                保存自动备份配置
              </Button>
            </Form>
          )}
        </Card>
      </Space>
    </PageContainer>
  );
}

export default memo(BackupPage);
