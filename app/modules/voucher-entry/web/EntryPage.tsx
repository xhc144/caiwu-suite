import { Alert, Button, Drawer, Input, InputNumber, Modal, Select, Space, Spin, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { EntryRouter } from '../server/router';
import { formatMoney, periodOfDate, VOUCHER_STATUS_LABELS, type Voucher } from '@caiwu/core';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import {
  coreApi,
  getBusinessError,
  matchHotkey,
  notify,
  queryClient,
  usePermission,
  useSession,
  useTab,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import {
  isEntryDate,
  balanceCell,
  changeEntryDate,
  blankLine,
  monthDistance,
  type Entry,
  type Problem,
} from '../shared';
import { api } from './api';
import { confirm } from './dialogs';
import LineGrid, { LineDetails } from './LineGrid';
import PasteDialog from './PasteDialog';
import CalculatorDialog from './CalculatorDialog';
import { useSaveActivity } from './useSaveActivity';
import { AmountDraftContext, amountDraftHint, useAmountDrafts } from './amount-drafts';

type Bootstrap = inferRouterOutputs<EntryRouter>['bootstrap'];
const inputOf = (v: Voucher): Entry => ({
  voucherTypeId: v.voucherTypeId,
  date: v.date,
  attachments: v.attachments,
  note: v.note,
  number: v.number,
  lines: v.lines.map(
    ({
      summary,
      entrySide,
      cashflowDirection,
      accountId,
      dimensions,
      currency,
      exchangeRate,
      fcAmount,
      quantity,
      unitPrice,
      debit,
      credit,
      settlementMethodId,
      refNo,
      bizDate,
    }) => ({
      summary,
      entrySide,
      cashflowDirection,
      accountId,
      dimensions,
      currency,
      exchangeRate,
      fcAmount,
      quantity,
      unitPrice,
      debit,
      credit,
      settlementMethodId,
      refNo,
      bizDate,
    }),
  ),
  draft: v.status === 'draft',
});
function newKey(book: string) {
  const storage = `voucher-entry.new.${book}`;
  let key = sessionStorage.getItem(storage);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(storage, key);
  }
  return key;
}
export default function EntryPage() {
  const [filters] = useUrlFilters({ id: 0 });
  const session = useSession();
  const initial = useQuery(api.bootstrap.queryOptions());
  const existing = useQuery({
    ...api.get.queryOptions({ id: filters.id || 1 }),
    enabled: !!filters.id,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  if (initial.isLoading || (filters.id && (existing.isLoading || !existing.isFetchedAfterMount)))
    return <Spin />;
  if (!initial.data || (filters.id && (existing.isError || !existing.data)))
    return <Alert type="error" title="无法打开凭证，请刷新并核对编号和查看权限" />;
  return (
    <Editor
      key={`${filters.id}:${session?.bookId}`}
      boot={initial.data}
      voucher={filters.id ? existing.data!.voucher : null}
      sourceUrl={existing.data?.sourceUrl ?? null}
      editorKey={filters.id ? `edit-${filters.id}` : newKey(session?.bookId ?? '')}
    />
  );
}
function Editor({
  boot,
  voucher,
  sourceUrl,
  editorKey,
}: {
  boot: Bootstrap;
  voucher: Voucher | null;
  sourceUrl: string | null;
  editorKey: string;
}) {
  const navigate = useNavigate();
  const session = useSession();
  const tab = useTab();
  const canEdit = usePermission('voucher-entry.edit');
  const canTemplate = usePermission('voucher-entry.template');
  const initial: Entry = voucher
    ? inputOf(voucher)
    : {
        voucherTypeId: boot.types.find((t) => !t.disabled)?.id ?? 0,
        date: boot.current?.startDate ?? boot.today,
        attachments: 0,
        lines: [blankLine(), blankLine(), blankLine()],
        draft: true,
      };
  const policy = useQuery(coreApi.voucherPolicy.get.queryOptions());
  const [data, setData] = useState(initial);
  const [header, setHeader] = useState(voucher);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('正在恢复编辑缓冲');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [active, setActive] = useState(0);
  const [details, setDetails] = useState(false);
  const [paste, setPaste] = useState(false);
  const [calculator, setCalculator] = useState<{
    line: number;
    side: 'debit' | 'credit' | null;
  } | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const templateEpoch = useRef(0);
  useEffect(
    () => () => {
      templateEpoch.current += 1;
    },
    [],
  );
  const [templateChoice, setTemplateChoice] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState<{ code: string; name: string } | null>(null);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [changed, setChanged] = useState(0);
  const live = useRef({
    data: initial,
    savedData: initial,
    header: voucher,
    bufferRevision: 0,
    version: 0,
    savedVersion: 0,
  });
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const amountSide = useRef<'debit' | 'credit'>('debit');
  const moneyFocused = useRef(false);
  const { pending, saving, startSaving, finishSaving } = useSaveActivity();
  const readonly =
    !ready ||
    !canEdit ||
    conflict ||
    !!(
      header &&
      (header.source || header.voided || header.status === 'audited' || header.status === 'posted')
    );
  const persist = useMutation(api.save.mutationOptions());
  const saveTemplate = useMutation(api.saveTemplate.mutationOptions());
  const templates = useQuery({
    ...api.templates.queryOptions({ keyword: '' }),
    enabled: templateOpen,
  });
  const neighbors = useQuery({
    ...api.neighbors.queryOptions({ id: header?.id ?? 1 }),
    enabled: !!header?.id,
  });
  const hint = useQuery({
    ...api.numberHint.queryOptions({ date: data.date, type: data.voucherTypeId }),
    enabled: isEntryDate(data.date) && data.voucherTypeId > 0,
  });
  const title = `凭证 ${header?.displayNo ?? '新增'}`;
  const titleSetter = useRef(tab.setTitle);
  titleSetter.current = tab.setTitle;
  useEffect(() => {
    titleSetter.current(title);
  }, [title]);

  useEffect(() => {
    let liveEffect = true;
    void queryClient
      .fetchQuery({ ...api.buffer.queryOptions({ key: editorKey }), staleTime: 0 })
      .then(async (buffer) => {
        if (!liveEffect) return;
        let restoredStatus = '已恢复；尚未修改';
        if (buffer) {
          live.current.bufferRevision = buffer.revision;
          const current =
            voucher ??
            (buffer.voucherId
              ? (
                  await queryClient.fetchQuery({
                    ...api.get.queryOptions({ id: buffer.voucherId }),
                    staleTime: 0,
                  })
                ).voucher
              : null);
          if (!liveEffect) return;
          if (current) {
            live.current.header = current;
            setHeader(current);
          }
          const staleBuffer = current && buffer.voucherRevision !== current.revision;
          if (staleBuffer) {
            live.current.data = inputOf(current);
            setData(inputOf(current));
            restoredStatus = '已载入服务端新版本；旧编辑缓冲未自动覆盖，恢复前请核对';
          } else if (!current || current.status === 'draft' || !voucher) {
            live.current.data = buffer.data;
            setData(buffer.data);
          } else if (
            buffer.data.draft &&
            JSON.stringify({ ...buffer.data, draft: false }) !==
              JSON.stringify({ ...initial, draft: false })
          ) {
            restoredStatus = '存在未提交编辑缓冲，可点击“恢复编辑缓冲”继续';
          }
        }
        live.current.savedData = live.current.data;
        setReady(true);
        setStatus(restoredStatus);
      })
      .catch(() => {
        if (liveEffect) {
          setStatus('恢复失败，请刷新');
          setError('读取编辑缓冲失败');
        }
      });
    return () => {
      liveEffect = false;
    };
    // 初始化只读取这个编辑器自己的缓冲。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey]);

  const change = (next: Entry) => {
    if (readonly) return;
    live.current.data = next;
    live.current.version += 1;
    setData(next);
    setChanged(live.current.version);
    setError('');
    setStatus('等待自动保存');
  };
  const amountDrafts = useAmountDrafts(() => change(live.current.data));
  const hasChanges = useCallback(
    () => live.current.version !== live.current.savedVersion || amountDrafts.values.size > 0,
    [amountDrafts.values],
  );
  const focus = (line: number, field: string) => {
    setActive(Math.max(0, line));
    setTimeout(() => {
      const row = root.current?.querySelector(`[data-line="${Math.max(0, line)}"]`);
      const target =
        row?.querySelector<HTMLElement>(`[data-field="${field}"]`) ??
        document.querySelector<HTMLElement>(`[role="dialog"] [data-field="${field}"]`);
      (target?.tagName === 'INPUT' ? target : target?.querySelector<HTMLElement>('input'))?.focus();
      row?.scrollIntoView({ block: 'nearest' });
    }, 0);
  };
  const rejectInvalidAmount = (automatic = false) => {
    const invalid = amountDrafts.values.values().next().value;
    if (!invalid) return false;
    setError(amountDraftHint(invalid));
    setStatus('金额格式有误，修正后再保存');
    if (!automatic && tab.active) {
      if (invalid.field === 'fcAmount') setDetails(true);
      focus(invalid.line - 1, invalid.field);
    }
    return true;
  };
  const save = (draft: boolean, automatic = false): Promise<boolean> => {
    const operation = async () => {
      if (readonly || !ready || pending.current) return false;
      if (rejectInvalidAmount(automatic)) return false;
      // 排队期间前一次保存可能已清除 dirty；仅自动保存跳过，手动草稿仍须执行。
      if (automatic && live.current.version === live.current.savedVersion) return true;
      const snapshot = { ...live.current.data, draft };
      const version = live.current.version;
      const current = live.current.header;
      let confirmFuture = false;
      let confirmNumberChange = false;
      let acknowledgeCashflowUnknown = false;
      if (!draft && isEntryDate(snapshot.date)) {
        if (monthDistance(snapshot.date, boot.today) > 0) {
          confirmFuture = await confirm(
            '确认未来期间',
            `凭证日期 ${snapshot.date}，所属期间 ${periodOfDate(snapshot.date)}。请核对是否误填年份。`,
          );
          if (!confirmFuture) return false;
        }
        if (
          current?.number != null &&
          (current.period !== periodOfDate(snapshot.date) ||
            current.voucherTypeId !== snapshot.voucherTypeId ||
            (snapshot.number != null && snapshot.number !== current.number))
        ) {
          confirmNumberChange = await confirm(
            '编号影响预览',
            `原凭证：${current.period} ${current.displayNo}；新期间：${periodOfDate(snapshot.date)}，新类型：${boot.types.find((t) => t.id === snapshot.voucherTypeId)?.code}，编号：${snapshot.number ?? '由服务端重新分配'}。原编号可能留下断号，账套编号策略保持原设置。`,
          );
          if (!confirmNumberChange) return false;
        }
        const unknown = snapshot.lines.flatMap((l, n) => {
          const a = boot.accounts.find((a) => a.id === l.accountId);
          const item = boot.items.find((i) => i.id === l.dimensions?.cashflow);
          return a?.cashflowRequired &&
            item &&
            !['inflow', 'outflow', 'internal'].includes(String(item.attrs.cashflowDirection))
            ? [n + 1]
            : [];
        });
        if (unknown.length) {
          acknowledgeCashflowUnknown = await confirm(
            '现金流量方向待核验',
            `第 ${unknown.join('、')} 行方向未配置，无法核验。建议先到基础档案配置；如现在保存，这些行仍需人工核验。`,
          );
          if (!acknowledgeCashflowUnknown) return false;
        }
      }
      // 确认弹窗等待期间仍可能编辑，不能把新出现的非法文本作为旧金额提交。
      if (rejectInvalidAmount(automatic)) return false;
      setStatus('保存中');
      startSaving();
      try {
        const result = await persist.mutateAsync({
          key: editorKey,
          id: current?.id,
          expectedRevision: current?.revision,
          bufferRevision: live.current.bufferRevision,
          data: snapshot,
          confirmFuture,
          confirmNumberChange,
          acknowledgeCashflowUnknown,
        });
        live.current.header = result.voucher;
        live.current.bufferRevision = result.bufferRevision;
        live.current.savedVersion = version;
        live.current.savedData = snapshot;
        setHeader(result.voucher);
        if (result.voucher)
          queryClient.setQueryData(api.get.queryKey({ id: result.voucher.id }), {
            voucher: result.voucher,
            sourceUrl: null,
          });
        // 同一凭证可从新建 UUID 或 edit-id 读取；其它缓存别名必须重新读取。
        void queryClient.invalidateQueries({
          queryKey: api.buffer.queryKey(),
          refetchType: 'none',
        });
        setStatus(
          result.coreError
            ? `编辑缓冲已保存；core 草稿未保存：${result.coreError}`
            : draft
              ? result.voucher?.status === 'pending'
                ? '编辑缓冲已保存，正式凭证待手动保存'
                : '草稿与编辑缓冲已保存'
              : `已保存 ${result.voucher?.displayNo}`,
        );
        if (live.current.version !== version) setStatus('上一版已保存，当前新修改等待自动保存');
        if (!draft) {
          notify.success(`已保存 ${result.voucher?.displayNo}`);
          void queryClient.invalidateQueries({ queryKey: api.neighbors.queryKey() });
          void queryClient.invalidateQueries({ queryKey: api.context.queryKey() });
        }
        return true;
      } catch (e) {
        const business = getBusinessError(e);
        setStatus('保存失败');
        setError(business?.message ?? '保存失败，请检查输入后重试');
        if (business?.code === 'VOUCHER_STALE') {
          setConflict(true);
          setError('另一个窗口已保存新版本，请刷新后核对；本窗口未覆盖服务端');
        }
        const problems = business?.details?.problems as Problem[] | undefined;
        if (problems?.[0] && problems[0].line > 0) {
          const problem = problems[0];
          if (['quantity', 'fcAmount', 'exchangeRate'].includes(problem.field)) setDetails(true);
          focus(problem.line - 1, problem.field);
        }
        return false;
      } finally {
        finishSaving();
      }
    };
    const task = tail.current.then(operation, operation);
    tail.current = task;
    return task;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!ready || readonly || !changed || leave) return;
    const timer = setTimeout(() => {
      if (live.current.version !== live.current.savedVersion) void saveRef.current(true, true);
    }, 850);
    return () => clearTimeout(timer);
  }, [changed, ready, readonly, leave]);
  const requestLeave = (action: () => void) => {
    if (pending.current) {
      void tail.current.then(() => handlers.current.requestLeave(action));
      return;
    }
    if (hasChanges()) setLeave(() => action);
    else action();
  };
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (hasChanges() || pending.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [pending, hasChanges]);
  useUnsavedChanges({
    title: header?.displayNo ? `凭证 ${header.displayNo}` : '凭证录入',
    dirty: ready && (hasChanges() || saving),
    version: live.current.version,
    save: () => saveRef.current(true),
    discard: async () => {
      await tail.current;
      const state = live.current;
      amountDrafts.clear();
      state.data = state.savedData;
      state.version += 1;
      state.savedVersion = state.version;
      setData(state.data);
      setChanged(state.version);
      setError('');
      setLeave(null);
    },
  });
  const insert = () => {
    amountDrafts.remap((line) => (line > active + 1 ? line + 1 : line));
    const lines = [...live.current.data.lines];
    lines.splice(active + 1, 0, blankLine());
    change({ ...live.current.data, lines });
    focus(active + 1, 'summary');
  };
  const remove = () => {
    amountDrafts.remap((line) =>
      line === active + 1 ? null : line > active + 1 ? line - 1 : line,
    );
    const lines = live.current.data.lines.filter((_, i) => i !== active);
    if (!lines.length) lines.push(blankLine());
    change({ ...live.current.data, lines });
    focus(Math.min(active, lines.length - 1), 'summary');
  };
  const balance = () => {
    if (rejectInvalidAmount()) return;
    if (!moneyFocused.current) {
      notify.info('请先定位到当前行的借方或贷方金额格');
      return;
    }
    try {
      (document.activeElement as HTMLElement | null)?.blur();
      change({
        ...live.current.data,
        lines: balanceCell(live.current.data.lines, active, amountSide.current),
      });
      focus(active, amountSide.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : '找平失败，请核对其它行金额');
    }
  };
  const swap = () => {
    if (rejectInvalidAmount()) return;
    if (moneyFocused.current) (document.activeElement as HTMLElement | null)?.blur();
    change({
      ...live.current.data,
      lines: live.current.data.lines.map((l, i) =>
        i === active ? { ...l, debit: l.credit ?? 0, credit: l.debit ?? 0 } : l,
      ),
    });
    if (moneyFocused.current) focus(active, amountSide.current);
  };
  const balanceCopy = () => {
    if (rejectInvalidAmount()) return;
    const lines = [...live.current.data.lines];
    const l = lines[active];
    if (!l) return;
    amountDrafts.remap((line) => (line > active + 1 ? line + 1 : line));
    lines.splice(active + 1, 0, { ...l, dimensions: { ...l.dimensions }, debit: 0, credit: 0 });
    const side = l.debit ? 'credit' : 'debit';
    change({ ...live.current.data, lines: balanceCell(lines, active + 1, side) });
    focus(active + 1, side);
  };
  const handlers = useRef({ save, insert, remove, balance, swap, balanceCopy, requestLeave });
  handlers.current = { save, insert, remove, balance, swap, balanceCopy, requestLeave };
  useEffect(() => {
    if (!tab.active) return;
    let replaying = false;
    const guard = (event: MouseEvent) => {
      if (replaying || (!pending.current && !hasChanges())) return;
      const target = event.target as HTMLElement;
      if (frame.current?.contains(target)) return;
      const navigation = target.closest<HTMLElement>(
        '.ant-tabs-tab-remove, .ant-tabs-tab, [role="menuitem"], a[href^="/"]',
      );
      if (!navigation) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handlers.current.requestLeave(() => {
        replaying = true;
        navigation.click();
        replaying = false;
      });
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [tab.active, pending, hasChanges]);
  useEffect(() => {
    if (!tab.active) return;
    const listener = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        e.keyCode === 229 ||
        details ||
        paste ||
        calculator ||
        templateOpen ||
        templateName ||
        leave
      )
        return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const h = handlers.current;
      if (matchHotkey(e, 'Ctrl+F4')) {
        stop();
        h.requestLeave(() => tab.close());
        return;
      }
      if (matchHotkey(e, 'F6')) {
        stop();
        setDetails(true);
        return;
      }
      if (matchHotkey(e, 'F3')) {
        stop();
        h.requestLeave(() => {
          void navigate('/m/accounts');
        });
        return;
      }
      if (matchHotkey(e, 'Ctrl+T')) {
        stop();
        h.requestLeave(() => {
          void navigate(`/m/voucher-book?action=copy&id=${live.current.header?.id ?? ''}`);
        });
        return;
      }
      if (matchHotkey(e, 'Ctrl+P')) {
        stop();
        h.requestLeave(() => {
          void navigate(`/m/print-settings?voucherId=${live.current.header?.id ?? ''}`);
        });
        return;
      }
      if (matchHotkey(e, 'F9')) {
        stop();
        setCalculator({ line: active, side: moneyFocused.current ? amountSide.current : null });
        return;
      }
      if (readonly) return;
      if (matchHotkey(e, 'Ctrl+S') || matchHotkey(e, 'F5')) {
        stop();
        void h.save(false);
      } else if (matchHotkey(e, 'Ctrl+I')) {
        stop();
        h.insert();
      } else if (matchHotkey(e, 'Ctrl+K') || matchHotkey(e, 'Ctrl+D')) {
        stop();
        h.remove();
      } else if (
        matchHotkey(e, 'Ctrl+H') ||
        (e.key === '=' &&
          ['debit', 'credit'].includes((e.target as HTMLElement).getAttribute('data-field') ?? ''))
      ) {
        stop();
        h.balance();
      } else if (matchHotkey(e, 'F7')) {
        stop();
        h.balanceCopy();
      } else if (matchHotkey(e, 'F8')) {
        stop();
        h.swap();
      } else if (matchHotkey(e, 'F4')) {
        stop();
        focus(active, 'accountId');
      } else if (
        e.key === 'Enter' &&
        root.current?.contains(e.target as Node) &&
        (e.target as HTMLElement).getAttribute('role') !== 'combobox'
      ) {
        const inputs = [
          ...root.current.querySelectorAll<HTMLInputElement>('tbody input:not(:disabled)'),
        ].filter(
          (input) =>
            input.offsetParent !== null &&
            (input.hasAttribute('data-field') || input.closest('[data-field]')),
        );
        const i = inputs.indexOf(e.target as HTMLInputElement);
        if (i >= 0) {
          stop();
          if (inputs[i + 1]) inputs[i + 1]!.focus();
          else {
            h.insert();
          }
        }
      }
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, [
    tab.active,
    tab,
    readonly,
    active,
    details,
    paste,
    calculator,
    templateOpen,
    templateName,
    leave,
    navigate,
  ]);

  const reset = async () => {
    if (
      !(await confirm(
        '重新输入',
        header
          ? '当前凭证仍保留在账套中，本操作开始一张新凭证；未保存的修改将放弃。'
          : '放弃当前编辑内容并开始一张新凭证？',
      ))
    )
      return;
    sessionStorage.removeItem(`voucher-entry.new.${session?.bookId ?? ''}`);
    window.location.assign('/m/voucher-entry/new');
  };
  const startNew = () => {
    sessionStorage.removeItem(`voucher-entry.new.${session?.bookId ?? ''}`);
    window.location.assign('/m/voucher-entry/new');
  };
  const goReview = async () => {
    const current = live.current.header;
    if (!current) {
      notify.info('请先正式保存凭证');
      return;
    }
    try {
      const checked = await queryClient.fetchQuery({
        ...api.reviewCheck.queryOptions({ id: current.id }),
        staleTime: 0,
      });
      if (
        checked.warnings.length &&
        !(await confirm('现金流量方向待核验', checked.warnings.map((p) => p.message).join('；')))
      )
        return;
      void navigate(`/m/voucher-book?period=${current.period}&status=pending`);
    } catch (e) {
      const b = getBusinessError(e);
      setError(b?.message ?? '审核入口检查失败，请刷新');
      const p = (b?.details?.problems as Problem[] | undefined)?.[0];
      if (p?.line) focus(p.line - 1, p.field);
    }
  };
  const totalDebit = data.lines.reduce((n, l) => n + (l.debit ?? 0), 0);
  const totalCredit = data.lines.reduce((n, l) => n + (l.credit ?? 0), 0);
  const saveAsTemplate = async () => {
    if (!templateName || rejectInvalidAmount()) return;
    const unknown = await confirm(
      '保存模版',
      '模版将保留分录和辅助项，不携带凭证编号、来源和审核信息。现金流量方向未配置的行仍需人工核验。',
    );
    if (!unknown || rejectInvalidAmount()) return;
    try {
      await saveTemplate.mutateAsync({
        ...templateName,
        voucherTypeId: data.voucherTypeId,
        lines: data.lines,
        acknowledgeCashflowUnknown: true,
      });
      notify.success('模版已保存');
      setTemplateName(null);
    } catch {
      /* 统一业务提示 */
    }
  };
  const safeTotals =
    Number.isSafeInteger(totalDebit) &&
    Number.isSafeInteger(totalCredit) &&
    Number.isSafeInteger(totalDebit - totalCredit);
  const unverifiedCashflow = data.lines.flatMap((l, n) => {
    const a = boot.accounts.find((x) => x.id === l.accountId);
    const item = boot.items.find((x) => x.id === l.dimensions?.cashflow);
    return a?.cashflowRequired &&
      item &&
      !['inflow', 'outflow', 'internal'].includes(String(item.attrs.cashflowDirection))
      ? [`第${n + 1}行 ${item.code} 方向未配置，无法核验`]
      : [];
  });
  const displayMoney = (amount: number) =>
    Number.isSafeInteger(amount) ? formatMoney(amount) : '超出安全整数分范围';
  const content = (
    <div ref={frame}>
      <PageContainer
        title="凭证录入"
        subtitle="正式保存后由服务端分配编号；F5 / Ctrl+S 保存，Ctrl+D / Ctrl+K 删行"
      >
        <Space wrap>
          <Button
            type="primary"
            disabled={readonly || !ready}
            loading={persist.isPending}
            onClick={() => void save(false)}
          >
            保存
          </Button>
          <Button
            disabled={readonly || !ready}
            onClick={() =>
              void save(false).then((ok) => {
                if (ok) requestLeave(startNew);
              })
            }
          >
            保存并新增
          </Button>
          <Button disabled={readonly || !ready} onClick={() => void save(true)}>
            保存草稿/缓冲
          </Button>
          <Button disabled={readonly} onClick={insert}>
            插行（Ctrl+I）
          </Button>
          <Button disabled={readonly} onClick={remove}>
            删行
          </Button>
          <Button disabled={readonly} onClick={balance}>
            找平（Ctrl+H）
          </Button>
          <Button disabled={readonly} onClick={balanceCopy}>
            平衡复制（F7）
          </Button>
          <Button disabled={readonly} onClick={swap}>
            借贷互换（F8）
          </Button>
          <Button
            onClick={() =>
              requestLeave(() => {
                void reset();
              })
            }
          >
            重新输入
          </Button>
          <Button disabled={readonly} onClick={() => setTemplateOpen(true)}>
            读入模版
          </Button>
          <Button disabled={!canTemplate} onClick={() => setTemplateName({ code: '', name: '' })}>
            转成模版
          </Button>
          <Button disabled={readonly} onClick={() => setPaste(true)}>
            Excel 粘贴
          </Button>
          <Button
            onClick={() =>
              setCalculator({
                line: active,
                side: moneyFocused.current ? amountSide.current : null,
              })
            }
          >
            计算器（F9）
          </Button>
          {header && (
            <Button
              onClick={() =>
                void queryClient
                  .fetchQuery({ ...api.buffer.queryOptions({ key: editorKey }), staleTime: 0 })
                  .then((b) => {
                    if (b)
                      void confirm(
                        '恢复编辑缓冲',
                        `缓冲对应 revision ${b.voucherRevision ?? '未建凭证'}；当前服务端 revision ${header?.revision ?? '未建凭证'}。确认恢复？旧缓冲不会自动覆盖新版本。`,
                      ).then((ok) => {
                        if (ok) {
                          amountDrafts.clear();
                          change(b.data);
                        }
                      });
                  })
              }
              disabled={readonly}
            >
              恢复编辑缓冲
            </Button>
          )}
        </Space>
        <Space wrap style={{ marginTop: 12 }}>
          {(['first', 'previous', 'next', 'last'] as const).map((key, i) => (
            <Button
              key={key}
              disabled={!neighbors.data?.[key]}
              onClick={() =>
                requestLeave(() => {
                  void navigate(`/m/voucher-entry/edit?id=${neighbors.data![key]}`);
                })
              }
            >
              {['首张', '上一张', '下一张', '末张'][i]}
            </Button>
          ))}
          <Button
            onClick={() =>
              requestLeave(() => {
                void goReview();
              })
            }
          >
            去审核
          </Button>
          <Button
            onClick={() =>
              requestLeave(() => {
                void navigate(`/m/voucher-book?action=copy&id=${header?.id ?? ''}`);
              })
            }
          >
            复制凭证
          </Button>
          <Button
            onClick={() =>
              requestLeave(() => {
                void navigate(`/m/voucher-book?action=reverse&id=${header?.id ?? ''}`);
              })
            }
          >
            反冲凭证
          </Button>
          <Button
            onClick={() =>
              requestLeave(() => {
                void navigate('/m/cashier');
              })
            }
          >
            出纳读取/单据生成
          </Button>
          <Button
            onClick={() =>
              requestLeave(() => {
                void navigate('/m/accounts');
              })
            }
          >
            科目维护
          </Button>
          <Button
            onClick={() =>
              requestLeave(() => {
                void navigate(`/m/period-close?period=${header?.period ?? ''}`);
              })
            }
          >
            期末处理/反过账
          </Button>
          <Button
            onClick={() =>
              requestLeave(() => {
                void navigate(`/m/print-settings?voucherId=${header?.id ?? ''}`);
              })
            }
          >
            打印
          </Button>
        </Space>
        {ready && readonly && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            title={conflict ? '版本冲突：请刷新后核对' : '当前凭证只读'}
            description={
              header?.source
                ? `来源：${header.source.module} / ${header.source.type} / ${header.source.id}`
                : '已审核、过账、作废或没有编辑权限时不能修改。'
            }
            action={
              sourceUrl ? (
                <Button onClick={() => void navigate(sourceUrl)}>查看来源</Button>
              ) : undefined
            }
          />
        )}
        {!!unverifiedCashflow.length && (
          <Alert
            type="warning"
            title="现金流量仍待核验"
            description={unverifiedCashflow.join('；')}
          />
        )}
        <div role="status" style={{ margin: '12px 0' }}>
          {status}
        </div>
        {error && (
          <Alert
            type="error"
            title={error}
            action={
              conflict ? <Button onClick={() => window.location.reload()}>刷新</Button> : undefined
            }
          />
        )}
        <Alert
          type="info"
          title="core 草稿不分配编号、不进入账表；未选科目的行仅保留在本模块编辑缓冲。正式凭证的自动保存只写缓冲，需手动保存才能提交修改。"
        />
        <Space wrap style={{ marginTop: 16 }}>
          <label>
            凭证类型
            <Select
              aria-label="凭证类型"
              style={{ width: 150 }}
              disabled={readonly}
              value={data.voucherTypeId || undefined}
              options={boot.types.map((t) => ({
                value: t.id,
                label: `${t.code} ${t.name}`,
                disabled: t.disabled,
              }))}
              onChange={(v) => change({ ...data, voucherTypeId: v, number: null })}
            />
          </label>
          <label>
            日期
            <Input
              aria-label="凭证日期"
              style={{ width: 150 }}
              disabled={readonly}
              value={data.date}
              placeholder="YYYY-MM-DD"
              onChange={(e) => change(changeEntryDate(live.current.data, e.target.value))}
            />
          </label>
          <label>
            附单据数
            <InputNumber
              aria-label="附单据数"
              min={0}
              max={9999}
              disabled={readonly}
              value={data.attachments}
              onChange={(v) => change({ ...data, attachments: v ?? 0 })}
            />
          </label>
          <label>
            {policy.data?.numbering === 'manual' ? '凭证编号（必填）' : '凭证编号（自动分配）'}
            <InputNumber
              aria-label="手动编号"
              min={1}
              disabled={readonly || !policy.data || policy.data.numbering === 'automatic'}
              value={data.number}
              onChange={(v) => change({ ...data, number: v })}
            />
          </label>
          <Tag>{header?.displayNo ?? `自动编号提示 ${hint.data ?? '—'}（未占号）`}</Tag>
          <Tag>{header ? VOUCHER_STATUS_LABELS[header.status] : '尚未保存'}</Tag>
          {header && (
            <a
              href={`/m/voucher-entry/edit?id=${header.id}`}
              onClick={(event) => {
                event.preventDefault();
                requestLeave(() => window.location.assign(`/m/voucher-entry/edit?id=${header.id}`));
              }}
            >
              重新打开凭证
            </a>
          )}
        </Space>
        <p style={{ marginTop: 10 }}>
          制单：{header?.createdBy.name ?? session?.user.name}；审核：
          {header?.auditedBy?.name ?? '—'}
          ；记账：{header?.postedBy?.name ?? '—'}
        </p>
        <div ref={root}>
          <LineGrid
            lines={data.lines}
            accounts={boot.accounts}
            items={boot.items}
            date={data.date}
            methods={boot.methods}
            summaries={boot.summaries}
            readonly={readonly}
            active={active}
            onActive={(i, field) => {
              setActive(i);
              moneyFocused.current = field === 'debit' || field === 'credit';
              if (field === 'debit' || field === 'credit') amountSide.current = field;
            }}
            onChange={(lines) => change({ ...live.current.data, lines })}
            onInfo={() => setDetails(true)}
          />
        </div>
        <p style={{ marginTop: 16 }}>
          借方合计 {displayMoney(totalDebit)}；贷方合计 {displayMoney(totalCredit)}；
          <span
            data-testid="difference"
            style={{ color: safeTotals && totalDebit === totalCredit ? '#18823a' : '#c33' }}
          >
            差额 {safeTotals ? formatMoney(totalDebit - totalCredit) : '合计超出范围，请核对'}
          </span>
        </p>
        <p style={{ color: '#666' }}>
          汇兑损益尚未实现：需要明确期末汇率、汇兑损益科目配置、按辅助项折算及幂等生成契约；此处不生成推测凭证。合同及财务/预算双体系校验尚缺核心契约。
        </p>
        <Drawer
          open={details}
          title={`第${active + 1}行分录信息`}
          size={480}
          focusable={{ focusTriggerAfterClose: false }}
          onClose={() => setDetails(false)}
          afterOpenChange={(open) => {
            if (
              !open &&
              (document.activeElement === document.body ||
                document.activeElement?.closest('[data-voucher-line-details]'))
            )
              requestAnimationFrame(() => {
                if (
                  document.activeElement === document.body ||
                  document.activeElement?.closest('[data-voucher-line-details]')
                )
                  root.current
                    ?.querySelector<HTMLInputElement>(
                      `[data-line="${active}"] input[data-field="summary"]`,
                    )
                    ?.focus();
              });
          }}
          destroyOnHidden
        >
          {data.lines[active] && (
            <div data-voucher-line-details>
              <LineDetails
                line={data.lines[active]}
                index={active}
                accounts={boot.accounts}
                items={boot.items}
                methods={boot.methods}
                readonly={readonly}
                onChange={(patch) =>
                  change({
                    ...live.current.data,
                    lines: live.current.data.lines.map((l, i) =>
                      i === active ? { ...l, ...patch } : l,
                    ),
                  })
                }
              />
            </div>
          )}
        </Drawer>
        {paste && (
          <PasteDialog
            onCancel={() => setPaste(false)}
            onApply={(lines) => {
              amountDrafts.clear();
              change({ ...data, lines });
              setPaste(false);
              focus(0, 'summary');
            }}
          />
        )}
        {calculator && (
          <CalculatorDialog
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
              !readonly && calculator.side
                ? (cents) => {
                    const { line, side } = calculator;
                    amountDrafts.clearField(line + 1, side!);
                    change({
                      ...live.current.data,
                      lines: live.current.data.lines.map((value, index) =>
                        index === line ? { ...value, [side!]: cents } : value,
                      ),
                    });
                    setCalculator(null);
                    focus(line, side!);
                  }
                : undefined
            }
          />
        )}
        <Modal
          title="读入凭证模版"
          open={templateOpen}
          onCancel={() => {
            templateEpoch.current += 1;
            setTemplateOpen(false);
          }}
          okText="确认替换当前分录"
          okButtonProps={{ disabled: !templateChoice }}
          onOk={() => {
            const requestedEpoch = ++templateEpoch.current;
            if (templateChoice)
              void queryClient
                .fetchQuery({
                  ...api.template.queryOptions({ id: templateChoice }),
                  staleTime: 0,
                })
                .then(async (t) => {
                  if (requestedEpoch !== templateEpoch.current) return;
                  if (
                    !(await confirm(
                      '调用模版',
                      `用 ${t.code} ${t.name} 替换当前分录？失效引用需重新选择，保存前会重新校验。`,
                    ))
                  )
                    return;
                  if (requestedEpoch !== templateEpoch.current) return;
                  amountDrafts.clear();
                  change({
                    ...live.current.data,
                    voucherTypeId: t.voucher_type_id,
                    lines: t.lines,
                    number: null,
                  });
                  if (t.validation.problems.length || t.validation.warnings.length)
                    setError(
                      [...t.validation.problems, ...t.validation.warnings]
                        .map((p) => p.message)
                        .join('；'),
                    );
                  setTemplateOpen(false);
                });
          }}
        >
          <Select
            aria-label="选择凭证模版"
            style={{ width: '100%' }}
            showSearch={{ filterOption: (q, o) => (o?.label ?? '').includes(q) }}
            options={(templates.data ?? []).map((t) => ({
              value: t.id,
              label: `${t.code} ${t.name}`,
            }))}
            value={templateChoice}
            onChange={setTemplateChoice}
          />
        </Modal>
        <Modal
          title="转成凭证模版"
          open={!!templateName}
          onCancel={() => setTemplateName(null)}
          onOk={() => void saveAsTemplate()}
          okText="保存模版"
        >
          <Input
            aria-label="模版编码"
            maxLength={4}
            placeholder="编码（最多4位）"
            value={templateName?.code}
            onChange={(e) =>
              setTemplateName((old) => ({ code: e.target.value, name: old?.name ?? '' }))
            }
          />
          <Input
            aria-label="模版名称"
            placeholder="名称"
            value={templateName?.name}
            onChange={(e) =>
              setTemplateName((old) => ({ code: old?.code ?? '', name: e.target.value }))
            }
          />
        </Modal>
        <Modal
          title="尚有未持久化内容"
          open={!!leave}
          onCancel={() => setLeave(null)}
          footer={
            <Space>
              <Button onClick={() => setLeave(null)}>取消</Button>
              <Button
                danger
                onClick={() => {
                  const action = leave;
                  flushSync(() => {
                    // 放弃只撤销尚未持久化的编辑；壳的离开保护仍会检查其它页面。
                    const state = live.current;
                    amountDrafts.clear();
                    state.data = state.savedData;
                    state.version += 1;
                    state.savedVersion = state.version;
                    setData(state.data);
                    setChanged(state.version);
                    setError('');
                    setStatus('已放弃未保存修改，保留上次持久化内容');
                    setLeave(null);
                  });
                  action?.();
                }}
              >
                放弃修改
              </Button>
              <Button
                type="primary"
                onClick={() =>
                  void save(true).then((ok) => {
                    if (ok && !hasChanges()) {
                      const action = leave;
                      flushSync(() => setLeave(null));
                      action?.();
                    }
                  })
                }
              >
                保存缓冲并离开
              </Button>
            </Space>
          }
        >
          保存到编辑缓冲、放弃本次修改，或取消离开。
        </Modal>
      </PageContainer>
    </div>
  );
  return <AmountDraftContext.Provider value={amountDrafts}>{content}</AmountDraftContext.Provider>;
}
