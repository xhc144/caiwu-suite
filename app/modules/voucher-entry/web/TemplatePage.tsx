import { Alert, Button, Drawer, Input, Modal, Select, Space, Table } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router';
import { type VoucherLineInput } from '@caiwu/core';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import {
  matchHotkey,
  notify,
  queryClient,
  usePermission,
  useTab,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import { blankLine } from '../shared';
import { api } from './api';
import { confirm } from './dialogs';
import LineGrid, { LineDetails } from './LineGrid';
import CalculatorDialog, { type CalculatorDialogHandle } from './CalculatorDialog';

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
  const tab = useTab();
  const [filters, setFilters] = useUrlFilters({ keyword: '' });
  const list = useQuery(api.templates.queryOptions({ keyword: filters.keyword }));
  const boot = useQuery(api.bootstrap.queryOptions());
  const canEdit = usePermission('voucher-entry.template');
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const calculatorFocus = useRef<CalculatorDialogHandle>(null);
  const [active, setActive] = useState(0);
  const [details, setDetails] = useState(false);
  const [calculator, setCalculator] = useState<{
    line: number;
    side: 'debit' | 'credit' | null;
  } | null>(null);
  const amountSide = useRef<'debit' | 'credit' | null>(null);
  const [issues, setIssues] = useState('');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const version = useRef(0);
  const pending = useRef(false);
  const confirming = useRef(false);
  const ask = async (title: string, content: string) => {
    confirming.current = true;
    try {
      return await confirm(title, content);
    } finally {
      confirming.current = false;
    }
  };
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const save = useMutation(api.saveTemplate.mutationOptions());
  const remove = useMutation(api.removeTemplate.mutationOptions());
  const change = (value: TemplateDraft) => {
    draftRef.current = value;
    version.current += 1;
    dirtyRef.current = true;
    setDraft(value);
    setDirty(true);
  };
  const openDraft = (value: TemplateDraft) => {
    draftRef.current = value;
    version.current += 1;
    dirtyRef.current = false;
    setDraft(value);
    setDirty(false);
    setActive(0);
    setDetails(false);
    setNotice('');
  };
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || pending.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  const close = async () => {
    if (pending.current) {
      notify.info('模版正在保存，请等待响应后再关闭');
      return false;
    }
    if (dirtyRef.current && !(await ask('放弃模版修改', '本次修改尚未保存，确定放弃？')))
      return false;
    flushSync(() => {
      draftRef.current = null;
      dirtyRef.current = false;
      setDraft(null);
      setDirty(false);
      setDetails(false);
    });
    return true;
  };
  const submit = async () => {
    const snapshot = draftRef.current;
    if (!snapshot || !canEdit || pending.current) return false;
    const savedVersion = version.current;
    pending.current = true;
    try {
      const hasUnknown = snapshot.lines.some((l) => {
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
        !(await ask(
          '现金流量方向未配置',
          '方向未配置，无法核验。确认保留待核验的模版，或取消并先维护现金流量档案。',
        ))
      )
        return false;
      const id = await save.mutateAsync({ ...snapshot, acknowledgeCashflowUnknown: hasUnknown });
      if (version.current === savedVersion) {
        draftRef.current = null;
        dirtyRef.current = false;
        setDraft(null);
        setDirty(false);
        setDetails(false);
        notify.success('凭证模版已保存');
      } else if (draftRef.current) {
        // 响应只推进持久化标识；期间的新输入继续保留，并基于新 revision 再保存。
        const current = { ...draftRef.current, id, revision: (snapshot.revision ?? 0) + 1 };
        draftRef.current = current;
        setDraft(current);
        setNotice('上一版模版已保存，当前新修改尚未保存');
      }
      await queryClient.invalidateQueries({ queryKey: api.templates.queryKey() });
    } catch {
      /* 框架显示可操作的业务提示 */
      return false;
    } finally {
      pending.current = false;
    }
    return !dirtyRef.current;
  };
  useUnsavedChanges({
    title: '凭证模版',
    dirty: dirty || pending.current,
    version: version.current,
    save: submit,
    discard: () => {
      if (pending.current) {
        notify.info('模版正在保存，请等待响应后再关闭');
        throw new Error('模版正在保存');
      }
      draftRef.current = null;
      dirtyRef.current = false;
      setDraft(null);
      setDirty(false);
      setDetails(false);
      setCalculator(null);
    },
  });
  const focus = (index: number, field: string) => {
    setActive(index);
    setTimeout(() => {
      const cell = root.current?.querySelector<HTMLElement>(
        `[data-line="${index}"] [data-field="${field}"]`,
      );
      (cell?.tagName === 'INPUT' ? cell : cell?.querySelector<HTMLElement>('input'))?.focus();
    }, 0);
  };
  const insert = () => {
    const current = draftRef.current;
    if (!current || !canEdit || current.lines.length >= 999) return;
    const lines = [...current.lines];
    lines.splice(active + 1, 0, blankLine());
    change({ ...current, lines });
    focus(active + 1, 'summary');
  };
  const removeLine = () => {
    const current = draftRef.current;
    if (!current || !canEdit || current.lines.length < 2) return;
    const lines = current.lines.filter((_, i) => i !== active);
    change({ ...current, lines });
    focus(Math.min(active, lines.length - 1), 'summary');
  };
  const reset = async () => {
    const current = draftRef.current;
    if (
      !current ||
      !canEdit ||
      !(await ask('重新输入模版分录', '清空当前分录？已保存的模版在再次存盘前保持原样。'))
    )
      return;
    change({ ...current, lines: [blankLine(), blankLine()] });
    focus(0, 'summary');
  };
  const keyboard = useRef((e: KeyboardEvent) => {
    void e;
  });
  keyboard.current = (e) => {
    if (
      !draftRef.current ||
      details ||
      calculator ||
      e.isComposing ||
      e.keyCode === 229 ||
      confirming.current
    )
      return;
    const stop = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (matchHotkey(e, 'Ctrl+F4')) {
      stop();
      void close();
    } else if (matchHotkey(e, 'F6')) {
      stop();
      setDetails(true);
    } else if (matchHotkey(e, 'F9')) {
      stop();
      setCalculator({ line: active, side: amountSide.current });
    } else if (matchHotkey(e, 'F3') || matchHotkey(e, 'Ctrl+T')) {
      stop();
      const to = matchHotkey(e, 'F3') ? '/m/accounts' : '/m/voucher-book?action=copy';
      void close().then((ok) => {
        if (ok) void navigate(to);
      });
    } else if (canEdit) {
      if (matchHotkey(e, 'F5') || matchHotkey(e, 'Ctrl+S')) {
        stop();
        void submit();
      } else if (matchHotkey(e, 'Ctrl+I')) {
        stop();
        insert();
      } else if (matchHotkey(e, 'Ctrl+D') || matchHotkey(e, 'Ctrl+K')) {
        stop();
        removeLine();
      } else if (matchHotkey(e, 'F4')) {
        stop();
        focus(active, 'accountId');
      } else if (
        e.key === 'Enter' &&
        (e.target as HTMLElement).getAttribute('role') !== 'combobox'
      ) {
        const inputs = [
          ...(root.current?.querySelectorAll<HTMLInputElement>('tbody input:not(:disabled)') ?? []),
        ].filter(
          (input) =>
            input.offsetParent !== null &&
            (input.hasAttribute('data-field') || input.closest('[data-field]')),
        );
        const index = inputs.indexOf(e.target as HTMLInputElement);
        if (index >= 0) {
          stop();
          if (inputs[index + 1]) inputs[index + 1]!.focus();
          else insert();
        }
      }
    }
  };
  useEffect(() => {
    if (!tab.active) return;
    const listener = (e: KeyboardEvent) => keyboard.current(e);
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, [tab.active]);
  return (
    <PageContainer
      title="凭证模版"
      subtitle="编码最多 4 位。调用前保留原内容，确认后才替换分录；保存时重新校验引用。"
      extra={
        <Button
          disabled={!canEdit || !boot.data}
          onClick={() => {
            openDraft({
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
                        openDraft({
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
        afterOpenChange={(open) => {
          // 父层入场会重新聚焦；将焦点交还给仍在打开的计算器算式。
          if (open) calculatorFocus.current?.focusExpression();
        }}
        width="95vw"
        onCancel={() => void close()}
        onOk={() => void submit()}
        okText="保存模版"
        okButtonProps={{ disabled: !canEdit }}
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        {draft && boot.data && (
          <div ref={root}>
            {issues && <Alert type="warning" title="模版引用需核对" description={issues} />}
            {notice && <Alert type="info" title={notice} />}
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
              <Button disabled={!canEdit} onClick={insert}>
                插入分录（Ctrl+I）
              </Button>
              <Button disabled={!canEdit || draft.lines.length < 2} onClick={removeLine}>
                删除当前行
              </Button>
              <Button disabled={!canEdit} onClick={() => void reset()}>
                重新输入分录
              </Button>
              <Button onClick={() => setDetails(true)}>分录信息（F6）</Button>
              <Button onClick={() => setCalculator({ line: active, side: amountSide.current })}>
                计算器（F9）
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
              onActive={(index, field) => {
                setActive(index);
                amountSide.current = field === 'debit' || field === 'credit' ? field : null;
              }}
              onChange={(lines) => change({ ...draft, lines })}
              onInfo={() => setDetails(true)}
            />
          </div>
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
      {calculator && (
        <CalculatorDialog
          ref={calculatorFocus}
          onClose={() => {
            const { line, side } = calculator;
            setCalculator(null);
            if (side) focus(line, side);
          }}
          target={
            calculator.side
              ? `第${calculator.line + 1}行${calculator.side === 'debit' ? '借方' : '贷方'}`
              : undefined
          }
          onApply={
            canEdit && calculator.side
              ? (cents) => {
                  const current = draftRef.current;
                  const { line, side } = calculator;
                  if (current && side)
                    change({
                      ...current,
                      lines: current.lines.map((value, index) =>
                        index === line ? { ...value, [side]: cents } : value,
                      ),
                    });
                  setCalculator(null);
                  if (side) focus(line, side);
                }
              : undefined
          }
        />
      )}
    </PageContainer>
  );
}
