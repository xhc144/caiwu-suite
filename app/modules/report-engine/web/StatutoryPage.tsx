import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Input, Modal, Select, Space, Spin, Tabs } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { printHtml } from '@caiwu/print';
import {
  queryClient,
  useCurrentPeriod,
  usePeriods,
  usePermission,
  useSession,
} from '@caiwu/web-kit';
import { PageContainer, downloadBlob, useUrlFilters } from '@caiwu/ui';
import type { StatutoryProfile } from '../shared';
import { api, statutoryEditorOptions } from './api';
import { StatutoryConfiguration, StatutoryResult } from './statutory-registry';
import { useStatutoryDraft } from './statutory-draft';
import { createEnterpriseDraftBridge } from './enterprise-draft';
import type { EnterpriseConfig } from '../templates/enterprise/model';

type Selection = {
  id: number;
  definitionId: string;
  definitionRevision: number;
  reportKey: string;
  code: string;
  name: string;
  period: number;
  scope: 'month' | 'yearToDate' | 'annual';
};
export default function StatutoryPage() {
  const current = useCurrentPeriod();
  const session = useSession();
  const [selection] = useUrlFilters<Selection>({
    id: 0,
    definitionId: '',
    definitionRevision: 1,
    reportKey: '',
    code: '',
    name: '',
    period: current?.period ?? 202601,
    scope: 'month',
  });
  const profile = useQuery({
    ...api.statutory.get.queryOptions({ id: selection.id }),
    enabled: selection.id > 0,
  });
  if (selection.id && profile.isLoading) return <Spin />;
  if (profile.isError) return <Alert type="error" title="读取法定报表失败，请返回列表重试" />;
  return (
    <StatutoryEditor
      key={`${session?.bookId}-${selection.id}-${selection.definitionId}-${selection.reportKey}`}
      selection={selection}
      initial={profile.data}
    />
  );
}
function StatutoryEditor({
  selection,
  initial,
}: {
  selection: Selection;
  initial?: StatutoryProfile;
}) {
  const [profile, setProfile] = useState(initial);
  const identity = {
    definitionId: profile?.definitionId ?? selection.definitionId,
    definitionRevision: profile?.definitionRevision ?? selection.definitionRevision,
    reportKey: profile?.reportKey ?? selection.reportKey,
  };
  const savedConfig = profile?.configuration as
    { period: number; scope: Selection['scope'] } | undefined;
  const [period, setPeriod] = useState(savedConfig?.period ?? selection.period);
  const [scope, setScope] = useState(savedConfig?.scope ?? selection.scope);
  const [options, setOptions] = useState<StatutoryProfile['configuration'] | undefined>();
  const [code, setCode] = useState(profile?.code ?? selection.code);
  const [name, setName] = useState(profile?.name ?? selection.name);
  const [tab, setTab] = useState('configuration');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState<{ requestId: string; count: number } | null>(null);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const enterpriseDraft = useRef(
    createEnterpriseDraftBridge(savedConfig?.period ?? selection.period),
  );
  const draft = useStatutoryDraft(`法定报表：${name}`, () => {
    setCode(profile?.code ?? selection.code);
    setName(profile?.name ?? selection.name);
    setPeriod(savedConfig?.period ?? selection.period);
    setScope(savedConfig?.scope ?? selection.scope);
    setOptions(undefined);
    enterpriseDraft.current.reset(savedConfig?.period ?? selection.period);
    setDraftEpoch((epoch) => epoch + 1);
  });
  const canEdit = usePermission('report-engine.edit');
  const canGenerate = usePermission('report-engine.generate');
  const canExport = usePermission('report-engine.export');
  const periods = usePeriods();
  const valid = !!identity.definitionId && !!identity.reportKey;
  const editor = useQuery({
    ...statutoryEditorOptions({ ...identity, id: profile?.id, period, scope, options }),
    enabled: valid,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const lastEditor = useRef(editor.data);
  useLayoutEffect(() => {
    if (editor.data) lastEditor.current = editor.data;
    if (
      editor.data &&
      !editor.isPlaceholderData &&
      !editor.isError &&
      identity.definitionId === 'enterprise-2019-appendix2'
    ) {
      enterpriseDraft.current.acceptSource((editor.data.configuration as EnterpriseConfig).period);
    }
  }, [editor.data, editor.isPlaceholderData, editor.isError, identity.definitionId]);
  const editorData = editor.data ?? lastEditor.current;
  const snapshot = useQuery({
    ...api.statutory.snapshot.queryOptions({ id: profile?.id ?? 0, period }),
    enabled: !!profile,
  });
  const save = useMutation(api.statutory.save.mutationOptions());
  const generate = useMutation(
    api.statutory.generate.mutationOptions({
      onSuccess: (out, input) => {
        if (out.kind === 'confirmation') {
          setPending({ requestId: input.requestId, count: out.count });
          return;
        }
        setPending(null);
        setTab('result');
        queryClient.setQueryData(
          api.statutory.snapshot.queryKey({ id: input.id, period: input.period }),
          out.snapshot,
        );
      },
    }),
  );
  const run = (confirmUnposted = false, requestId: string = crypto.randomUUID()) => {
    if (profile)
      generate.mutate({
        id: profile.id,
        expectedRevision: profile.revision,
        period,
        requestId,
        confirmUnposted,
      });
  };
  const output = async (format: 'xlsx' | 'print') => {
    const displayed = snapshot.data;
    if (!profile || !displayed) return;
    setWorking(true);
    setError('');
    try {
      const out = await queryClient.fetchQuery({
        ...api.statutory.output.queryOptions({
          id: profile.id,
          period: displayed.period,
          format,
          snapshotId: displayed.id,
          expectedRevision: displayed.profile.revision,
        }),
        staleTime: 0,
      });
      if (
        out.snapshotId !== displayed.id ||
        out.revision !== displayed.profile.revision ||
        out.period !== displayed.period
      )
        throw new Error('导出结果与当前显示结果不一致，请刷新页面后重试');
      if (format === 'print' && out.printJob) await printHtml(out.printJob);
      else
        downloadBlob(
          new Blob([Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0))], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          `${profile.code}-${period}.xlsx`,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出或打印失败');
    } finally {
      setWorking(false);
    }
  };
  const result = snapshot.data;
  return (
    <PageContainer
      title={`法定报表：${name}`}
      subtitle="确认分类和来源后，仅按已过账凭证生成。完整财务报告还需附注及首次执行附件。"
      extra={<Link to="/m/report-engine">返回报表管理</Link>}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        {(!editorData || !canEdit) && (
          <>
            <label>
              报告期间{' '}
              <Select
                aria-label="报表生成期间"
                value={period}
                style={{ width: 130 }}
                options={periods.periods.map((p) => ({ value: p.period, label: String(p.period) }))}
                onChange={(p) => {
                  setPeriod(p);
                  setOptions(undefined);
                  setPending(null);
                  draft.markDirty(true);
                }}
              />
            </label>
            <Select
              aria-label="报表生成口径"
              value={scope}
              style={{ width: 180 }}
              options={[
                { value: 'month', label: '月报' },
                ...(identity.definitionId === 'small-business'
                  ? []
                  : [{ value: 'yearToDate', label: '年初至今' }]),
                { value: 'annual', label: '年报' },
              ]}
              onChange={(s) => {
                setScope(s);
                setOptions(undefined);
                setPending(null);
                draft.markDirty(true);
              }}
            />
          </>
        )}
        <label>
          报表编码{' '}
          <Input
            aria-label="法定报表编码"
            value={code}
            disabled={!canEdit}
            style={{ width: 90 }}
            onChange={(e) => {
              setCode(e.target.value);
              draft.markDirty(true);
            }}
          />
        </label>
        <label>
          报表名称{' '}
          <Input
            aria-label="法定报表名称"
            value={name}
            disabled={!canEdit}
            style={{ width: 240 }}
            onChange={(e) => {
              setName(e.target.value);
              draft.markDirty(true);
            }}
          />
        </label>
        {canGenerate && (
          <Button
            type="primary"
            disabled={!profile || editor.isFetching || draft.dirty}
            loading={generate.isPending}
            onClick={() => run()}
          >
            生成法定报表
          </Button>
        )}
        {canExport && (
          <>
            <Button disabled={!result} loading={working} onClick={() => void output('xlsx')}>
              导出法定报表 Excel
            </Button>
            <Button disabled={!result} loading={working} onClick={() => void output('print')}>
              A4 打印
            </Button>
          </>
        )}
      </Space>
      {(error || editor.isError || save.isError || generate.isError || snapshot.isError) && (
        <Alert
          type="error"
          showIcon
          title={
            error ||
            generate.error?.message ||
            save.error?.message ||
            editor.error?.message ||
            '读取结果失败，请重试'
          }
        />
      )}
      {profile && (
        <p>
          已保存配置版本 {profile.revision}；报告期间 {period}。来源变化后须核实并重新保存确认。
        </p>
      )}
      {editor.isFetching && <Spin />}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'configuration',
            label: '配置与来源确认',
            children: canEdit ? (
              editorData && (
                <StatutoryConfiguration
                  key={`${identity.definitionId}-${identity.reportKey}-${draftEpoch}`}
                  definitionId={identity.definitionId}
                  configuration={editorData.configuration}
                  source={editorData.source}
                  onDirtyChange={draft.markDirty}
                  onSaveReady={draft.registerSave}
                  onDraftChange={(configuration) =>
                    enterpriseDraft.current.publish(configuration as EnterpriseConfig)
                  }
                  onPeriodChange={(p, s) => {
                    setPeriod(p);
                    setScope(s);
                    setOptions(
                      identity.definitionId === 'enterprise-2019-appendix2'
                        ? enterpriseDraft.current.options()
                        : undefined,
                    );
                    setPending(null);
                    draft.markDirty(true);
                  }}
                  onOptionsChange={(options, p, s) => {
                    setOptions(options);
                    setPeriod(p);
                    setScope(s);
                    setPending(null);
                    draft.markDirty(true);
                  }}
                  onGenerate={async () => {
                    if (!canGenerate || !profile)
                      throw new Error('请先保存配置，并确认当前操作员有生成报表权限');
                    if (draft.dirty) throw new Error('请先保存当前配置修改，再生成报表');
                    await generate.mutateAsync({
                      id: profile.id,
                      expectedRevision: profile.revision,
                      period,
                      requestId: crypto.randomUUID(),
                      confirmUnposted: false,
                    });
                  }}
                  onSave={async (configuration) => {
                    if (editor.isFetching)
                      throw new Error('正在重新读取所选期间的来源，请读取完成后再保存');
                    if (editor.isError || !editor.data)
                      throw new Error('来源读取失败，请先选择有效期间并重试');
                    await draft.persist(async () => {
                      // 以这次提交的完整草稿重建来源，不用旧配置覆盖临时编辑；保存仍执行严格校验。
                      const rebuilt =
                        identity.definitionId === 'enterprise-2019-appendix2'
                          ? await queryClient.fetchQuery({
                              ...statutoryEditorOptions({
                                ...identity,
                                id: profile?.id,
                                period,
                                scope,
                                options: enterpriseDraft.current.options(
                                  configuration as EnterpriseConfig,
                                ),
                              }),
                              staleTime: 0,
                            })
                          : { configuration, source: editorData.source };
                      const saved = await save.mutateAsync({
                        ...identity,
                        id: profile?.id,
                        expectedRevision: profile?.revision,
                        code,
                        name,
                        configuration: rebuilt.configuration,
                      });
                      queryClient.setQueryData(
                        api.statutory.editor.queryKey({
                          ...identity,
                          id: saved.id,
                          period,
                          scope,
                          options,
                        }),
                        { configuration: saved.configuration, source: rebuilt.source },
                      );
                      setProfile(saved);
                      queryClient.setQueryData(api.statutory.get.queryKey({ id: saved.id }), saved);
                      await queryClient.invalidateQueries({
                        queryKey: api.statutory.list.queryKey(),
                      });
                      await queryClient.invalidateQueries({
                        queryKey: api.statutory.editor.queryKey({
                          ...identity,
                          id: saved.id,
                          period,
                          scope,
                          options,
                        }),
                      });
                      window.history.replaceState(
                        null,
                        '',
                        `/m/report-engine/statutory?id=${saved.id}`,
                      );
                    });
                  }}
                />
              )
            ) : (
              <p>当前操作员可查看已保存结果；修改配置需编辑报表权限。</p>
            ),
          },
          {
            key: 'result',
            label: '生成结果',
            children: result ? (
              <>
                <p>
                  成功结果：{result.generatedAt}；期间 {result.period}；生成时未过账{' '}
                  {result.unpostedCount} 张；配置版本 {result.profile.revision}
                </p>
                {profile?.revision !== result.profile.revision && (
                  <Alert type="warning" title="配置已更新，下方是上次成功结果，请重新生成" />
                )}
                <StatutoryResult
                  definitionId={result.profile.definitionId}
                  result={result.result}
                />
              </>
            ) : (
              <p>此期间尚无成功结果，请确认配置后生成。</p>
            ),
          },
        ]}
      />
      <Modal
        title="生成前发现未过账凭证"
        open={!!pending}
        onCancel={() => setPending(null)}
        okText="仅按已过账继续生成"
        onOk={() => pending && run(true, pending.requestId)}
        confirmLoading={generate.isPending}
      >
        <p>来源期间内有 {pending?.count} 张未过账凭证。继续生成仅使用已过账凭证。</p>
        <a href={`/m/voucher-book?period=${period}&status=pending`}>查看未过账凭证</a>
      </Modal>
    </PageContainer>
  );
}
