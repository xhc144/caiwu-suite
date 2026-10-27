import { Alert, Button, Drawer, Input, Modal, Select, Space, Table } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { type VoucherLineInput } from '@caiwu/core';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import { notify, queryClient, usePermission } from '@caiwu/web-kit';
import { blankLine } from '../shared';
import { api } from './api';
import { confirm } from './dialogs';
import LineGrid, { LineDetails } from './LineGrid';

type TemplateDraft = {
  id?: number;
  revision?: number;
  code: string;
  name: string;
  voucherTypeId: number;
  lines: VoucherLineInput[];
};
export default function TemplatePage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters({ keyword: '' });
  const list = useQuery(api.templates.queryOptions({ keyword: filters.keyword }));
  const boot = useQuery(api.bootstrap.queryOptions());
  const canEdit = usePermission('voucher-entry.template');
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [active, setActive] = useState(0);
  const [details, setDetails] = useState(false);
  const [issues, setIssues] = useState('');
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const save = useMutation(api.saveTemplate.mutationOptions());
  const remove = useMutation(api.removeTemplate.mutationOptions());
  const change = (value: TemplateDraft) => {
    setDraft(value);
    setDirty(true);
  };
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  const close = async () => {
    if (dirty && !(await confirm('放弃模版修改', '本次修改尚未保存，确定放弃？'))) return;
    setDraft(null);
    setDirty(false);
  };
  const submit = async () => {
    if (!draft) return;
    const hasUnknown = draft.lines.some((l) => {
      const a = boot.data?.accounts.find((a) => a.id === l.accountId);
      const item = boot.data?.items.find((i) => i.id === l.dimensions?.cashflow);
      return (
        a?.cashflowRequired &&
        item &&
        !['inflow', 'outflow', 'internal'].includes(String(item.attrs.cashflowDirection))
      );
    });
    if (
      hasUnknown &&
      !(await confirm(
        '现金流量方向未配置',
        '方向未配置，无法核验。确认保留待核验的模版，或取消并先维护现金流量档案。',
      ))
    )
      return;
    try {
      await save.mutateAsync({ ...draft, acknowledgeCashflowUnknown: hasUnknown });
      notify.success('凭证模版已保存');
      setDraft(null);
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: api.templates.queryKey() });
    } catch {
      /* 框架显示可操作的业务提示 */
    }
  };
  return (
    <PageContainer
      title="凭证模版"
      subtitle="编码最多 4 位。调用前保留原内容，确认后才替换分录；保存时重新校验引用。"
      extra={
        <Button
          disabled={!canEdit || !boot.data}
          onClick={() => {
            setDraft({
              code: '',
              name: '',
              voucherTypeId: boot.data!.types.find((t) => !t.disabled)?.id ?? 0,
              lines: [blankLine(), blankLine()],
            });
            setIssues('');
            setDirty(false);
          }}
        >
          新增模版
        </Button>
      }
    >
      <Input.Search
        aria-label="搜索模版"
        placeholder="编码或名称"
        value={filters.keyword}
        onChange={(e) => setFilters({ keyword: e.target.value })}
        style={{ maxWidth: 360, marginBottom: 16 }}
      />
      <Table
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data ?? []}
        columns={[
          { title: '编码', dataIndex: 'code' },
          { title: '名称', dataIndex: 'name' },
          {
            title: '操作',
            render: (_, t) => (
              <Space>
                <Button
                  onClick={() =>
                    void queryClient
                      .fetchQuery({ ...api.template.queryOptions({ id: t.id }), staleTime: 0 })
                      .then((v) => {
                        setDraft({
                          id: v.id,
                          revision: v.revision,
                          code: v.code,
                          name: v.name,
                          voucherTypeId: v.voucher_type_id,
                          lines: v.lines,
                        });
                        setIssues(
                          [...v.validation.problems, ...v.validation.warnings]
                            .map((p) => p.message)
                            .join('；'),
                        );
                        setDirty(false);
                      })
                  }
                >
                  {canEdit ? '编辑分录与名称' : '查看'}
                </Button>
                <Button
                  danger
                  disabled={!canEdit}
                  onClick={() =>
                    void confirm(
                      '删除凭证模版',
                      `删除 ${t.code} ${t.name}？已调用生成的凭证仍保留。`,
                    ).then(async (ok) => {
                      if (!ok) return;
                      await remove.mutateAsync({ id: t.id, revision: t.revision });
                      await queryClient.invalidateQueries({ queryKey: api.templates.queryKey() });
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Button onClick={() => void navigate('/m/voucher-entry/new')}>返回凭证录入</Button>
      <Modal
        title={draft?.id ? '编辑凭证模版' : '新增凭证模版'}
        open={!!draft}
        width="95vw"
        onCancel={() => void close()}
        onOk={() => void submit()}
        okText="保存模版"
        okButtonProps={{ disabled: !canEdit }}
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        {draft && boot.data && (
          <>
            {issues && <Alert type="warning" title="模版引用需核对" description={issues} />}
            <Space wrap>
              <label>
                模版编码
                <Input
                  aria-label="模版编码"
                  value={draft.code}
                  maxLength={4}
                  disabled={!canEdit}
                  onChange={(e) => change({ ...draft, code: e.target.value })}
                />
              </label>
              <label>
                模版名称
                <Input
                  aria-label="模版名称"
                  value={draft.name}
                  disabled={!canEdit}
                  onChange={(e) => change({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                凭证类型
                <Select
                  aria-label="模版凭证类型"
                  style={{ width: 160 }}
                  value={draft.voucherTypeId}
                  disabled={!canEdit}
                  options={boot.data.types.map((t) => ({
                    value: t.id,
                    label: t.name,
                    disabled: t.disabled,
                  }))}
                  onChange={(v) => change({ ...draft, voucherTypeId: v })}
                />
              </label>
              <Button
                disabled={!canEdit}
                onClick={() => change({ ...draft, lines: [...draft.lines, blankLine()] })}
              >
                增加分录
              </Button>
              <Button
                disabled={!canEdit || draft.lines.length < 2}
                onClick={() => {
                  change({ ...draft, lines: draft.lines.filter((_, i) => i !== active) });
                  setActive(0);
                }}
              >
                删除当前行
              </Button>
            </Space>
            <p style={{ color: '#666' }}>
              只保存模板头和分录，不保存来源、原编号、制单/审核/过账人或原凭证 revision。
            </p>
            <LineGrid
              lines={draft.lines}
              accounts={boot.data.accounts}
              items={boot.data.items}
              date={boot.data.current?.startDate ?? boot.data.today}
              methods={boot.data.methods}
              summaries={boot.data.summaries}
              readonly={!canEdit}
              active={active}
              onActive={setActive}
              onChange={(lines) => change({ ...draft, lines })}
              onInfo={() => setDetails(true)}
            />
          </>
        )}
      </Modal>
      <Drawer
        title={`第${active + 1}行模版分录信息`}
        open={details}
        size={480}
        onClose={() => setDetails(false)}
      >
        {draft && boot.data && draft.lines[active] && (
          <LineDetails
            line={draft.lines[active]}
            index={active}
            accounts={boot.data.accounts}
            items={boot.data.items}
            methods={boot.data.methods}
            readonly={!canEdit}
            onChange={(patch) =>
              change({
                ...draft,
                lines: draft.lines.map((l, i) => (i === active ? { ...l, ...patch } : l)),
              })
            }
          />
        )}
      </Drawer>
    </PageContainer>
  );
}
