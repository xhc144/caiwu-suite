import {
  Alert,
  Button,
  Card,
  Checkbox,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Input,
  InputNumber,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { DIMENSION_TYPES, formatMoney, formatPeriod, VOUCHER_STATUS_LABELS } from '@caiwu/core';
import { queryClient, useAccounts, useCurrentPeriod, usePermission } from '@caiwu/web-kit';
import {
  DataTable,
  PageContainer,
  PeriodPicker,
  PeriodRangePicker,
  useUrlFilters,
} from '@caiwu/ui';
import type { inferRouterOutputs } from '@trpc/server';
import type { PeriodCloseRouter } from '../server/router';
import type { TransferRule } from '../shared';
import RuleDrawer from './RuleDrawer';
import ExchangePanel from './ExchangePanel';
import TransferBatchPanel from './TransferBatchPanel';
import { api } from './api';

type Output = inferRouterOutputs<PeriodCloseRouter>;
export default function PeriodClosePage() {
  const navigate = useNavigate();
  const current = useCurrentPeriod();
  const [filters, setFilters] = useUrlFilters({ period: 0, from: 0, to: 0, source: '' });
  const currentPeriod = current?.period ?? 0;
  useEffect(() => {
    if (!filters.period && !filters.source && currentPeriod)
      setFilters({
        period: currentPeriod,
        from: filters.from || currentPeriod,
        to: filters.to || currentPeriod,
      });
  }, [currentPeriod, filters.period, filters.source, filters.from, filters.to, setFilters]);
  const period = filters.period || Number(filters.source.split(':')[0]) || current?.period || 0;
  const range = { from: filters.from || period, to: filters.to || period };
  const check = useQuery({ ...api.check.queryOptions({ period }), enabled: !!period });
  const list = useQuery(api.rules.queryOptions());
  const { byId } = useAccounts();
  const canPost = usePermission('period-close.post');
  const canUnpost = usePermission('period-close.unpost');
  const canEdit = usePermission('period-close.transfer.edit');
  const canGenerate = usePermission('period-close.transfer.generate');
  const canClose = usePermission('period-close.close');
  const canReopen = usePermission('period-close.reopen');
  const canYearEnd = usePermission('period-close.year-end');
  const [editing, setEditing] = useState<TransferRule | 'new' | null>(null);
  const [selection, setSelection] = useState<number[] | null>(null);
  const ruleIds = selection ?? list.data?.filter((r) => r.enabled).map((r) => r.id) ?? [];
  const [preview, setPreview] = useState<Output['preview'] | null>(null);
  const [ordered, setOrdered] = useState(false);
  const [voucherNumbers, setVoucherNumbers] = useState<Record<string, number>>({});
  const [numberPreview, setNumberPreview] = useState<Output['renumberPreview'] | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<{ id: number; displayNo: string; reason: string }[]>([]);
  const [allowPnl, setAllowPnl] = useState(false);
  const [ackDrafts, setAckDrafts] = useState(false);
  const [numberSecond, setNumberSecond] = useState(false);
  const [numberText, setNumberText] = useState('');
  const [annualPreview, setAnnualPreview] = useState<Output['yearEndPreview'] | null>(null);
  const [rangePreview, setRangePreview] = useState<Output['closeRangePreview'] | null>(null);
  const [reversePlan, setReversePlan] = useState<Output['reverseYearPreview'] | null>(null);
  const [backup, setBackup] = useState<Output['backupReverseYear'] | null>(null);
  const [reverseText, setReverseText] = useState('');
  const refresh = () => queryClient.invalidateQueries();
  const done = (r: { message: string }) => {
    setMessages((m) => [r.message, ...m].slice(0, 8));
    void refresh();
  };
  const post = useMutation(
    api.post.mutationOptions({
      onSuccess: (r) => {
        done(r);
        setSkipped(r.skipped);
      },
    }),
  );
  const unpost = useMutation(api.unpost.mutationOptions({ onSuccess: done }));
  const close = useMutation(api.close.mutationOptions({ onSuccess: done }));
  const closeRange = useMutation(
    api.closeRange.mutationOptions({
      onSuccess: (r) => {
        setRangePreview(null);
        done(r);
      },
    }),
  );
  const reopen = useMutation(api.reopen.mutationOptions({ onSuccess: done }));
  const generate = useMutation(
    api.generate.mutationOptions({
      onSuccess: (r) => {
        done(r);
        setPreview(null);
      },
    }),
  );
  const remove = useMutation(api.removeRule.mutationOptions({ onSuccess: () => void refresh() }));
  const deleteGenerated = useMutation(
    api.deleteGenerated.mutationOptions({
      onSuccess: () => {
        done({ message: '结转凭证已删除，可重新预览' });
      },
    }),
  );
  const renumber = useMutation(
    api.renumber.mutationOptions({
      onSuccess: (r) => {
        done(r);
        setNumberPreview(null);
        setNumberSecond(false);
        setNumberText('');
      },
    }),
  );
  const yearEnd = useMutation(
    api.yearEnd.mutationOptions({
      onSuccess: (r) => {
        setAnnualPreview(null);
        done(r);
      },
    }),
  );
  const annualQuery = useQuery({
    ...api.yearEndPreview.queryOptions({ year: Math.trunc(period / 100) }),
    enabled: false,
  });
  const prepareReverse = useMutation(
    api.backupReverseYear.mutationOptions({
      onSuccess: (r) => {
        setReversePlan(null);
        setReverseText('');
        setBackup(r);
      },
    }),
  );
  const reverseYear = useMutation(
    api.reverseYear.mutationOptions({
      onSuccess: (r) => {
        setBackup(null);
        done(r);
        setFilters({
          period: r.sourceYear * 100 + 12,
          from: r.sourceYear * 100 + 12,
          to: r.sourceYear * 100 + 12,
        });
      },
    }),
  );
  const reverseQuery = useQuery({
    ...api.reverseYearPreview.queryOptions({ year: Math.trunc(period / 100) }),
    enabled: false,
  });
  const workflow = useMutation(
    api.workflow.mutationOptions({
      onSuccess: (r) => {
        done({ message: `${r.stage}：${r.message}` });
        setSkipped(r.posting.skipped);
        if (r.preview) {
          setOrdered(false);
          setVoucherNumbers({});
          setPreview(r.preview);
        }
      },
    }),
  );
  const previewQuery = useQuery({
    ...api.preview.queryOptions({ period, ruleIds }),
    enabled: false,
  });
  const numberQuery = useQuery({ ...api.renumberPreview.queryOptions({ period }), enabled: false });
  const rangeQuery = useQuery({ ...api.closeRangePreview.queryOptions(range), enabled: false });
  const busy =
    post.isPending ||
    unpost.isPending ||
    generate.isPending ||
    close.isPending ||
    closeRange.isPending ||
    reopen.isPending ||
    renumber.isPending ||
    yearEnd.isPending ||
    workflow.isPending ||
    prepareReverse.isPending ||
    reverseYear.isPending;
  return (
    <PageContainer
      title="过账与结账"
      subtitle="检查 → 过账 → 结转 → 其他操作员审核 → 过账 → 结账；逆操作在本页办理"
    >
      <Space wrap>
        <label>
          检查期间{' '}
          <PeriodPicker
            aria-label="检查期间"
            value={period || undefined}
            onChange={(p) => {
              setFilters({ period: p, from: p, to: p });
              setPreview(null);
            }}
          />
        </label>
        <label>
          操作范围{' '}
          <PeriodRangePicker value={range.from ? range : undefined} onChange={setFilters} />
        </label>
        <Button onClick={() => void refresh()}>重新检查</Button>
      </Space>
      <Space wrap style={{ margin: '16px 0' }}>
        {canPost && (
          <Button type="primary" disabled={!period || busy} onClick={() => post.mutate(range)}>
            过账
          </Button>
        )}
        {canUnpost && (
          <Popconfirm
            title={`确认反过账 ${range.from}—${range.to}？`}
            description="仅已过账变为已审核；已结账月份及后期依赖会阻止。"
            onConfirm={() => unpost.mutate({ ...range, confirmed: true })}
          >
            <Button disabled={busy}>反过账</Button>
          </Popconfirm>
        )}
        <Button
          disabled={!period || busy}
          onClick={() =>
            void previewQuery.refetch().then((r) => {
              if (r.data) {
                setOrdered(false);
                setVoucherNumbers({});
                setPreview(r.data);
              }
            })
          }
        >
          结转预览
        </Button>
        {canClose && (
          <Popconfirm
            title={`确认结账 ${formatPeriod(period || 202601)}？`}
            description="结账后核心将禁止保存本期凭证；草稿不会自动转正式。"
            onConfirm={() =>
              close.mutate({
                period,
                confirmed: true,
                allowUntransferredPnl: allowPnl,
                acknowledgeDrafts: ackDrafts,
              })
            }
          >
            <Button disabled={busy}>结账</Button>
          </Popconfirm>
        )}
        {canReopen && (
          <Popconfirm
            title={`从 ${range.to} 向前反结账至 ${range.from}？`}
            description="同年反结账保留手工期初；跨年须先合法撤销后年度业务，再在线备份并撤销最近年结。"
            onConfirm={() => reopen.mutate({ ...range, confirmed: true })}
          >
            <Button disabled={busy}>反结账</Button>
          </Popconfirm>
        )}
        {canClose && (
          <Button
            disabled={busy}
            onClick={() => void rangeQuery.refetch().then((r) => r.data && setRangePreview(r.data))}
          >
            连续结账预览
          </Button>
        )}
        {canPost && canGenerate && canClose && (
          <Popconfirm
            title="确认按阶段办理一键期末？"
            description="过账后展示结转预览；新凭证必须等待其他操作员审核，再次运行继续。"
            onConfirm={() => workflow.mutate({ period, ruleIds, confirmed: true })}
          >
            <Button disabled={busy}>一键过账 → 结转 → 结账</Button>
          </Popconfirm>
        )}
      </Space>
      {messages.length > 0 && (
        <Alert
          type="info"
          title={messages[0]}
          description={messages.slice(1).map((m, i) => (
            <div key={i}>{m}</div>
          ))}
          showIcon
        />
      )}
      {skipped.length > 0 && (
        <Card title="本次跳过的凭证" size="small">
          <Space wrap>
            {skipped.map((v) => (
              <Button
                key={v.id}
                type="link"
                onClick={() => void navigate(`/m/voucher-entry/edit?id=${v.id}`)}
              >
                {v.displayNo}：{v.reason}
              </Button>
            ))}
          </Space>
        </Card>
      )}
      {check.data && (
        <>
          <h3>{`${formatPeriod(period)} · ${check.data.period.status === 'closed' ? '已结账' : '开放'}${check.data.allPassed ? ' · 检查全部通过' : ''}`}</h3>
          <DataTable
            tableId="period-close.checks"
            rowKey="id"
            loading={check.isFetching}
            dataSource={check.data.items}
            columns={[
              { key: 'title', title: '检查项目', dataIndex: 'title', width: 190 },
              {
                key: 'pass',
                title: '结果',
                width: 100,
                render: (_, r) => (
                  <Tag color={r.pass ? 'success' : 'error'}>{r.pass ? '通过' : '不通过'}</Tag>
                ),
              },
              { key: 'detail', title: '具体对象 / 原因', dataIndex: 'detail', width: 600 },
              {
                key: 'action',
                title: '处理',
                width: 110,
                render: (_, r) => (
                  <Button type="link" onClick={() => void navigate(r.to)}>
                    去处理
                  </Button>
                ),
              },
            ]}
          />
          <Space wrap>
            {check.data.vouchers.map((v) => (
              <Button
                type="link"
                key={v.id}
                onClick={() => void navigate(`/m/voucher-entry/edit?id=${v.id}`)}
              >
                {v.displayNo} · {VOUCHER_STATUS_LABELS[v.status]}
              </Button>
            ))}
          </Space>
          {check.data.drafts.length > 0 && (
            <Alert
              type="warning"
              title={`另有 ${check.data.drafts.length} 张草稿，不计正式账，也不会自动审核或过账`}
              description={
                <Space wrap>
                  {check.data.drafts.map((v) => (
                    <Button
                      type="link"
                      key={v.id}
                      onClick={() => void navigate(`/m/voucher-entry/edit?id=${v.id}`)}
                    >
                      {v.displayNo}（ID {v.id}）
                    </Button>
                  ))}
                </Space>
              }
            />
          )}
          {canClose && (
            <Space orientation="vertical" style={{ margin: '12px 0' }}>
              <Checkbox checked={allowPnl} onChange={(e) => setAllowPnl(e.target.checked)}>
                明确确认损益未结转仍继续结账（检查保持不通过，并记日志）
              </Checkbox>
              <Checkbox checked={ackDrafts} onChange={(e) => setAckDrafts(e.target.checked)}>
                明确确认保留草稿且不计正式账，结账后草稿无法转正式
              </Checkbox>
              <Button
                onClick={() =>
                  void numberQuery.refetch().then((r) => r.data && setNumberPreview(r.data))
                }
              >
                编号整理预览
              </Button>
            </Space>
          )}
          {check.data.generated.length > 0 && (
            <Card title="已生成结转凭证" size="small">
              {check.data.generated.map((g) => (
                <Space key={g.voucherId} style={{ marginRight: 16 }}>
                  <Button
                    type="link"
                    onClick={() => void navigate(`/m/voucher-entry/edit?id=${g.voucherId}`)}
                  >
                    {g.voucher?.displayNo} ·{' '}
                    {g.voucher ? VOUCHER_STATUS_LABELS[g.voucher.status] : ''}
                  </Button>
                  {canGenerate && (
                    <Popconfirm
                      title="确认删除并准备重新生成？"
                      description="只允许本模块的草稿或待审核凭证；后期依赖及已审核/已过账会阻止。"
                      onConfirm={() =>
                        deleteGenerated.mutate({ period, ruleId: g.ruleId, confirmed: true })
                      }
                    >
                      <Button danger>删除结转凭证</Button>
                    </Popconfirm>
                  )}
                </Space>
              ))}
              <Button
                type="link"
                onClick={() => void navigate(`/m/voucher-book?period=${period}&status=pending`)}
              >
                请其他操作员审核
              </Button>
            </Card>
          )}
          <Card title="年结前置" size="small" style={{ margin: '12px 0' }}>
            <p>
              {check.data.yearEnd.year} 年已结 {check.data.yearEnd.closed}/
              {check.data.yearEnd.total} 个月；
              {check.data.yearEnd.completed ? '已年结' : '尚未年结'}
              。年结要求全年已结、正式账平衡、损益余额清零、目标年度无手工期初或业务；生成下一年逐桶期初并重置累计。
            </p>
            {canYearEnd && (
              <Button
                disabled={busy}
                onClick={() =>
                  void annualQuery.refetch().then((r) => r.data && setAnnualPreview(r.data))
                }
              >
                年结预览
              </Button>
            )}
            {canReopen && canYearEnd && (
              <Button
                disabled={busy}
                onClick={() =>
                  void reverseQuery.refetch().then((r) => {
                    if (r.data) setReversePlan(r.data);
                  })
                }
              >
                逆年结预览 / 在线备份
              </Button>
            )}
          </Card>
        </>
      )}
      <Card
        title="结转设置与执行顺序"
        extra={canEdit && <Button onClick={() => setEditing('new')}>新增结转类型</Button>}
      >
        <Button
          disabled={busy}
          onClick={() => {
            setSelection(null);
            setPreview(null);
          }}
        >
          全选启用结转类型
        </Button>
        <p style={{ color: 'var(--ant-color-text-secondary)' }}>
          损益科目按本账套类别识别，转入科目由用户显式设置；自定义按所选余额或本期发生额及比例转出。编辑、删除、启停已有来源的类型须先合法撤销来源凭证。
        </p>
        <DataTable<TransferRule>
          tableId="period-close.rules"
          rowKey="id"
          dataSource={list.data ?? []}
          columns={[
            {
              key: 'selected',
              title: '执行',
              width: 75,
              render: (_, r) => (
                <Checkbox
                  aria-label={`选择 ${r.code}`}
                  disabled={!r.enabled}
                  checked={ruleIds.includes(r.id)}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked ? [...ruleIds, r.id] : ruleIds.filter((id) => id !== r.id),
                    )
                  }
                />
              ),
            },
            { key: 'order', title: '顺序', dataIndex: 'order', width: 75 },
            { key: 'code', title: '代码', dataIndex: 'code', width: 100 },
            { key: 'name', title: '说明', dataIndex: 'name', width: 160 },
            {
              key: 'kind',
              title: '内容',
              width: 100,
              render: (_, r) => (r.kind === 'pnl' ? '损益' : '自定义'),
            },
            {
              key: 'target',
              title: '转入',
              width: 180,
              render: (_, r) =>
                `${byId.get(r.targetAccountId)?.code ?? ''} ${byId.get(r.targetAccountId)?.name ?? ''}`,
            },
            {
              key: 'enabled',
              title: '启停',
              width: 80,
              render: (_, r) => (r.enabled ? '启用' : '停用'),
            },
            {
              key: 'actions',
              title: '操作',
              width: 180,
              render: (_, r) =>
                canEdit && (
                  <Space>
                    <Button type="link" onClick={() => setEditing(r)}>
                      编辑 / 启停
                    </Button>
                    <Popconfirm
                      title="删除该结转类型？"
                      onConfirm={() => remove.mutate({ id: r.id })}
                    >
                      <Button type="link" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
            },
          ]}
        />
      </Card>
      <ExchangePanel key={`exchange-${period}`} period={period} />
      <TransferBatchPanel period={period} ruleIds={ruleIds} disabled={busy} />
      {editing && (
        <RuleDrawer
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh()}
        />
      )}
      <Modal
        open={!!preview}
        title="月度结转预览"
        width={920}
        okText="确认生成待审核凭证"
        cancelText="取消"
        onCancel={() => setPreview(null)}
        confirmLoading={generate.isPending}
        okButtonProps={{
          disabled:
            !ordered ||
            !canGenerate ||
            (preview?.numbering === 'manual' &&
              preview.items.some(
                (item) =>
                  !item.zero && !item.existingVoucherId && !voucherNumbers[String(item.ruleId)],
              )),
        }}
        onOk={() =>
          preview &&
          generate.mutate({
            period: preview.period,
            ruleIds: preview.items.map((i) => i.ruleId),
            previewToken: preview.previewToken,
            confirmed: ordered,
            voucherNumbers,
          })
        }
      >
        <p>{preview?.message}</p>
        {preview?.items.map((item) => (
          <Card
            key={item.ruleId}
            size="small"
            title={`${item.order}. ${item.code} ${item.name}`}
            style={{ marginBottom: 8 }}
          >
            {preview.numbering === 'manual' && !item.existingVoucherId && !item.zero && (
              <label>
                结转凭证号{' '}
                <InputNumber
                  aria-label={`结转凭证号 ${item.code}`}
                  min={1}
                  max={2147483647}
                  precision={0}
                  value={voucherNumbers[String(item.ruleId)]}
                  onChange={(value) =>
                    setVoucherNumbers((previous) => {
                      const next = { ...previous };
                      if (value == null) delete next[String(item.ruleId)];
                      else next[String(item.ruleId)] = value;
                      return next;
                    })
                  }
                />
              </label>
            )}
            {item.cashflowChecks.length > 0 && (
              <div>
                现金流方向：
                {item.cashflowChecks
                  .map(
                    (c) =>
                      `第${c.line}行项目 ${c.itemId}（${{ inflow: '流入', outflow: '流出', internal: '内部转移' }[c.direction]}）`,
                  )
                  .join('；')}
              </div>
            )}
            {item.existingVoucherId ? (
              <span>已有凭证 ID {item.existingVoucherId}，本次不重复生成</span>
            ) : item.zero ? (
              <span>转出金额为零，不生成空凭证</span>
            ) : (
              <>
                <div>
                  借方 {formatMoney(item.debit)} / 贷方 {formatMoney(item.credit)}
                </div>
                {item.lines.map((l, i) => (
                  <div key={i}>
                    {byId.get(l.accountId!)?.code} {byId.get(l.accountId!)?.name} 借{' '}
                    {formatMoney(l.debit)} 贷 {formatMoney(l.credit)} {l.currency ?? ''}{' '}
                    {l.fcAmount != null ? formatMoney(l.fcAmount) : ''}{' '}
                    {l.exchangeRate ? `汇率 ${l.exchangeRate}` : ''}{' '}
                    {l.quantity && l.quantity !== '0' ? `数量 ${l.quantity}` : ''}{' '}
                    {l.unitPrice ? `本币单价 ${l.unitPrice}` : ''}{' '}
                    {Object.entries(l.dimensions ?? {})
                      .filter(([, id]) => id != null)
                      .map(
                        ([type, id]) =>
                          `${DIMENSION_TYPES.find((d) => d.id === type)?.name ?? type}=${id}`,
                      )
                      .join('；')}
                  </div>
                ))}
              </>
            )}
          </Card>
        ))}
        <Checkbox checked={ordered} onChange={(e) => setOrdered(e.target.checked)}>
          已确认以上顺序、逐步更新后的基数和分录
        </Checkbox>
      </Modal>
      <Modal
        open={!!rangePreview}
        title="本年连续结账预览"
        okText="确认连续结账"
        cancelText="取消"
        confirmLoading={closeRange.isPending}
        okButtonProps={{ disabled: !rangePreview?.allPassed }}
        onCancel={() => setRangePreview(null)}
        onOk={() =>
          rangePreview &&
          closeRange.mutate({
            from: rangePreview.from,
            to: rangePreview.to,
            previewToken: rangePreview.previewToken,
            confirmed: true,
          })
        }
      >
        <p>
          逐月检查全部通过才可结账；存在草稿或损益余额时请回到单月处理。中途失败整批回滚，不自动年结。
        </p>
        {rangePreview?.items.map((item) => (
          <div key={item.period}>
            <Tag color={item.ready ? 'success' : 'error'}>{formatPeriod(item.period)}</Tag>
            {item.ready ? '通过' : item.problems.join('；')}
            {!item.ready && (
              <Button
                type="link"
                onClick={() => {
                  setRangePreview(null);
                  setFilters({ period: item.period });
                }}
              >
                处理 {formatPeriod(item.period)}
              </Button>
            )}
          </div>
        ))}
      </Modal>
      <Modal
        open={!!numberPreview && !numberSecond}
        title="编号整理预览（第一次确认）"
        okText="继续确认影响"
        cancelText="取消"
        onCancel={() => setNumberPreview(null)}
        onOk={() => {
          setNumberText('');
          setNumberSecond(true);
        }}
      >
        <p>{numberPreview?.message}</p>
        {numberPreview?.changes.length
          ? numberPreview.changes.map((c) => (
              <div key={c.id}>
                {c.type}：{c.oldNumber} → {c.number}（凭证 ID {c.id}）
              </div>
            ))
          : '没有需要整理的编号'}
      </Modal>
      <Modal
        open={!!annualPreview}
        title="年结检查与逐桶期初预览"
        width={940}
        okText="确认年结"
        cancelText="取消"
        confirmLoading={yearEnd.isPending}
        okButtonProps={{ disabled: !annualPreview?.allPassed }}
        onCancel={() => setAnnualPreview(null)}
        onOk={() => annualPreview && yearEnd.mutate({ year: annualPreview.year, confirmed: true })}
      >
        <p>
          将生成 {annualPreview?.targetYear}{' '}
          年期间及以下年初，下一年度累计归零；已有手工期初或业务会阻止覆盖。
        </p>
        {annualPreview?.checks.map((c) => (
          <div key={c.id}>
            <Tag color={c.pass ? 'success' : 'error'}>{c.pass ? '通过' : '不通过'}</Tag>
            {c.title}：{c.detail}
            <Button
              type="link"
              onClick={() => {
                setAnnualPreview(null);
                void navigate(c.to);
              }}
            >
              去处理
            </Button>
          </div>
        ))}
        <DataTable
          tableId="period-close.annual-preview"
          rowKey="key"
          dataSource={annualPreview?.rows ?? []}
          columns={[
            { key: 'account', title: '科目', dataIndex: 'accountCode', width: 100 },
            {
              key: 'dims',
              title: '辅助项',
              width: 260,
              render: (_, r) =>
                Object.entries(r.dimensions)
                  .filter(([, id]) => id != null)
                  .map(
                    ([type, id]) =>
                      `${DIMENSION_TYPES.find((d) => d.id === type)?.name ?? type}=${id}`,
                  )
                  .join('；'),
            },
            { key: 'currency', title: '币种', dataIndex: 'currency', width: 80 },
            { key: 'balance', title: '下一年期初', dataIndex: 'balance', money: true, width: 130 },
            { key: 'foreign', title: '外币', dataIndex: 'fcBalance', money: true, width: 130 },
            { key: 'qty', title: '数量', dataIndex: 'quantity', width: 100 },
          ]}
        />
      </Modal>
      <Modal
        open={!!reversePlan}
        title="逆年结影响预览"
        width={880}
        okText="先执行在线备份"
        cancelText="取消"
        confirmLoading={prepareReverse.isPending}
        onCancel={() => setReversePlan(null)}
        onOk={() => reversePlan && prepareReverse.mutate({ year: reversePlan.sourceYear })}
      >
        <p>{reversePlan?.impact}</p>
        <p>
          下一步会在本账套运行时数据目录生成受管 SQLite
          在线快照。只有备份成功后，才会出现文字确认；取消或备份失败不会修改账套。
        </p>
        <DataTable
          tableId="period-close.reverse-year-rows"
          rowKey="id"
          dataSource={reversePlan?.rows ?? []}
          columns={[
            { key: 'account', title: '科目', dataIndex: 'accountCode', width: 100 },
            {
              key: 'dimensions',
              title: '辅助项',
              width: 280,
              render: (_, r) =>
                Object.entries(r.dimensions)
                  .filter(([, id]) => id != null)
                  .map(
                    ([type, id]) =>
                      `${DIMENSION_TYPES.find((d) => d.id === type)?.name ?? type}=${id}`,
                  )
                  .join('；'),
            },
            { key: 'currency', title: '币种', dataIndex: 'currency', width: 80 },
            { key: 'balance', title: '派生期初', dataIndex: 'balance', money: true, width: 130 },
            { key: 'foreign', title: '外币', dataIndex: 'fcBalance', money: true, width: 130 },
            { key: 'quantity', title: '数量', dataIndex: 'quantity', width: 100 },
          ]}
        />
      </Modal>
      <Modal
        open={!!backup}
        title="在线备份成功：再次确认逆年结"
        width={760}
        okText="确认撤销年结"
        cancelText="取消"
        confirmLoading={reverseYear.isPending}
        okButtonProps={{ danger: true, disabled: reverseText !== backup?.plan.confirmationText }}
        onCancel={() => {
          setBackup(null);
          setReverseText('');
        }}
        onOk={() =>
          backup &&
          reverseYear.mutate({
            year: backup.plan.sourceYear,
            backupId: backup.backupId,
            confirmed: true,
            confirmText: reverseText,
          })
        }
      >
        <Alert type="success" title={backup?.message} />
        <p>{backup?.plan.impact}</p>
        <p>受管备份：{backup?.relativePath}</p>
        <label>
          请输入 {backup?.plan.confirmationText}
          <Input
            aria-label="逆年结确认文字"
            value={reverseText}
            onChange={(e) => setReverseText(e.target.value)}
          />
        </label>
      </Modal>
      <Modal
        open={!!numberPreview && numberSecond}
        title="编号整理（第二次确认）"
        okText="确定"
        cancelText="取消"
        confirmLoading={renumber.isPending}
        okButtonProps={{
          danger: true,
          disabled: numberText !== '影响已打印凭证和账册，编号不可直接恢复',
        }}
        onCancel={() => {
          setNumberSecond(false);
          setNumberText('');
        }}
        onOk={() =>
          numberPreview &&
          renumber.mutate({
            period,
            previewToken: numberPreview.previewToken,
            confirmed: true,
            confirmText: numberText,
          })
        }
      >
        <p>{numberPreview?.message}</p>
        <label>
          请输入 影响已打印凭证和账册，编号不可直接恢复
          <Input
            aria-label="确认文字"
            value={numberText}
            onChange={(e) => setNumberText(e.target.value)}
          />
        </label>
      </Modal>
    </PageContainer>
  );
}
