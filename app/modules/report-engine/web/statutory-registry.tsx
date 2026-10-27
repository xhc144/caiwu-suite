import type { StatutoryProfile } from '../shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Select, Space, Tabs } from 'antd';
import { MoneyText } from '@caiwu/ui';
import type { EnterpriseConfig, EnterpriseResult, SourceData } from '../templates/enterprise/model';
import {
  EnterpriseConfiguration,
  EnterpriseStatements,
} from '../templates/enterprise/statutory.web';
import {
  SmallBusinessConfiguration,
  SmallBusinessStatementView,
} from '../templates/small-business/statutory.web';
import type { PreparedSmallBusiness } from '../templates/small-business/statutory.server';
import type {
  SmallPublicConfiguration,
  SmallPublicSource,
} from '../server/statutory-small-business';
import { NonprofitConfigurationPanel } from '../templates/nonprofit/statutory.web';
import type { NonprofitGeneration } from '../templates/nonprofit/statutory.server';
import type {
  NonprofitPublicConfiguration,
  NonprofitPublicSource,
} from '../server/statutory-nonprofit';
import type { StatutoryDraftCallbacks } from './statutory-draft';

/** 服务和页面登记同一真实定义；以后新增制度在这里提供其配置及结果组件。 */
export function StatutoryConfiguration(
  props: {
    definitionId: string;
    configuration: StatutoryProfile['configuration'];
    source: unknown;
    onSave(configuration: StatutoryProfile['configuration']): Promise<void>;
    onPeriodChange(period: number, scope: 'month' | 'yearToDate' | 'annual'): void;
    onOptionsChange(
      options: StatutoryProfile['configuration'],
      period: number,
      scope: 'month' | 'yearToDate' | 'annual',
    ): void;
    onGenerate(): Promise<void>;
  } & StatutoryDraftCallbacks,
) {
  if (props.definitionId === 'small-business')
    return (
      <SmallConfigurationEditor
        {...props}
        configuration={props.configuration as SmallPublicConfiguration}
        source={props.source as SmallPublicSource}
      />
    );
  if (props.definitionId === 'nonprofit-2026')
    return (
      <NonprofitConfigurationEditor
        key={Math.floor((props.configuration as NonprofitPublicConfiguration).period / 100)}
        {...props}
        configuration={props.configuration as NonprofitPublicConfiguration}
        source={props.source as NonprofitPublicSource}
      />
    );
  if (props.definitionId !== 'enterprise-2019-appendix2')
    return <p>所选报表暂不可用，请返回列表。</p>;
  return (
    <EnterpriseConfiguration
      initial={props.configuration as EnterpriseConfig}
      source={props.source as SourceData}
      onSave={props.onSave}
      onPeriodChange={props.onPeriodChange}
      onDirtyChange={props.onDirtyChange}
      onSaveReady={props.onSaveReady}
    />
  );
}
export function StatutoryResult({
  definitionId,
  result,
}: {
  definitionId: string;
  result: unknown;
}) {
  if (definitionId === 'small-business') {
    const p = result as PreparedSmallBusiness;
    return (
      <>
        {p.statements.map((s) => (
          <SmallBusinessStatementView
            key={s.code}
            statement={s}
            orgName={p.orgName}
            period={p.period}
            comparisonNote={p.comparisonNote}
          />
        ))}
      </>
    );
  }
  if (definitionId === 'nonprofit-2026') {
    const s = (result as NonprofitGeneration).statement;
    return (
      <section>
        <h2>{s.name}</h2>
        <p>
          {s.organization} {s.period.from}至{s.period.to} 单位：元
        </p>
        {s.notes.map((n) => (
          <Alert key={n} type="info" title={n} />
        ))}
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>项目</th>
                {s.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row) => (
                <tr key={row.id}>
                  <th>{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={i}>{typeof v === 'number' ? <MoneyText value={v} /> : v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  if (definitionId !== 'enterprise-2019-appendix2') return <p>所选报表暂不可用，请返回列表。</p>;
  return <EnterpriseStatements result={result as EnterpriseResult} />;
}
function SmallConfigurationEditor(
  props: {
    configuration: SmallPublicConfiguration;
    source: SmallPublicSource;
    onSave(configuration: StatutoryProfile['configuration']): Promise<void>;
    onPeriodChange(period: number, scope: 'month' | 'annual'): void;
  } & StatutoryDraftCallbacks,
) {
  const [value, setValue] = useState(props.configuration.value);
  const draft = useRef(value),
    inFlight = useRef<Promise<void> | null>(null);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const save = async () => {
    if (inFlight.current) return inFlight.current;
    const submitted = draft.current;
    const run = (async () => {
      setSaving(true);
      setError('');
      try {
        await props.onSave({ ...props.configuration, value: submitted });
        if (draft.current === submitted) props.onDirtyChange?.(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败');
        throw e;
      } finally {
        setSaving(false);
      }
    })();
    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
  };
  useLayoutEffect(() => {
    props.onSaveReady?.(save);
  });
  return (
    <>
      <Space wrap>
        <label>
          报告期间{' '}
          <Select
            aria-label="报告期间"
            value={props.configuration.period}
            style={{ width: 130 }}
            options={props.source.periods.map((p) => ({
              value: p.period,
              label: String(p.period),
            }))}
            onChange={(p) => props.onPeriodChange(p, props.configuration.scope)}
          />
        </label>
        <Select
          aria-label="比较口径"
          value={props.configuration.scope}
          options={[
            { value: 'month', label: '月报（含本年累计）' },
            { value: 'annual', label: '完整年度及上年度' },
          ]}
          onChange={(scope) => props.onPeriodChange(props.configuration.period, scope)}
        />
      </Space>
      {error && <Alert type="error" title={error} />}
      <SmallBusinessConfiguration
        value={value}
        accounts={props.source.accounts}
        entries={props.source.entries}
        analysisRows={props.source.analysisRows}
        openingRows={props.source.openingRows}
        startPeriod={props.source.book.startPeriod}
        onChange={(next) => {
          draft.current = next;
          setValue(next);
        }}
        onDirtyChange={props.onDirtyChange}
        onSave={() => void save().catch(() => {})}
        saving={saving}
      />
    </>
  );
}
function NonprofitConfigurationEditor(
  props: {
    configuration: NonprofitPublicConfiguration;
    source: NonprofitPublicSource;
    onSave(configuration: StatutoryProfile['configuration']): Promise<void>;
    onOptionsChange(
      options: StatutoryProfile['configuration'],
      period: number,
      scope: 'month' | 'yearToDate' | 'annual',
    ): void;
    onGenerate(): Promise<void>;
  } & StatutoryDraftCallbacks,
) {
  const [current, setCurrent] = useState(props.configuration.current);
  const [previous, setPrevious] = useState(props.configuration.previous);
  const currentDraft = useRef(current),
    previousDraft = useRef(previous);
  const currentSave = useRef<(() => Promise<void>) | null>(null);
  const previousSave = useRef<(() => Promise<void>) | null>(null);
  const collecting = useRef(false),
    editVersion = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const dirty = (changed: boolean) => {
    if (changed) editVersion.current++;
    props.onDirtyChange?.(changed);
  };
  const saveCombined = async (initiator?: 'current' | 'previous') => {
    if (inFlight.current) return inFlight.current;
    const submitted = editVersion.current;
    const run = (async () => {
      collecting.current = true;
      try {
        if (initiator !== 'current' && currentSave.current) await currentSave.current();
        if (initiator !== 'previous' && previousSave.current) await previousSave.current();
      } finally {
        collecting.current = false;
      }
      await props.onSave({
        ...props.configuration,
        current: currentDraft.current,
        ...(previousDraft.current ? { previous: previousDraft.current } : {}),
      });
      if (editVersion.current !== submitted) props.onDirtyChange?.(true);
    })();
    inFlight.current = run;
    try {
      await run;
    } finally {
      inFlight.current = null;
    }
  };
  useLayoutEffect(() => {
    props.onSaveReady?.(() => saveCombined());
  });
  const [error, setError] = useState('');
  const periods = props.source.periods.map((p) => ({ period: p.period, label: String(p.period) }));
  return (
    <>
      {error && <Alert type="warning" title={error} />}
      <Tabs
        items={[
          {
            key: 'current',
            label: '本年资料',
            children: (
              <NonprofitConfigurationPanel
                key={current.year}
                sources={props.source.current}
                initial={current}
                request={props.source.request}
                periods={periods}
                onDirtyChange={dirty}
                onSaveReady={(save) => {
                  currentSave.current = save;
                }}
                onDraftChange={(value) => {
                  currentDraft.current = value;
                  setCurrent(value);
                }}
                onRequestChange={(r) => {
                  if (r.code !== props.source.request.code) {
                    setError('当前配置绑定所选报表，其他报表请返回报表管理新增。');
                    return;
                  }
                  setError('');
                  props.onOptionsChange(
                    r,
                    r.to,
                    r.kind === 'annual' ? 'annual' : r.kind === 'month' ? 'month' : 'yearToDate',
                  );
                }}
                onSave={async (value) => {
                  currentDraft.current = value;
                  setCurrent(value);
                  if (!collecting.current) await saveCombined('current');
                }}
                onGenerate={() => props.onGenerate()}
              />
            ),
          },
          ...(props.source.previous && props.configuration.previous
            ? [
                {
                  key: 'previous',
                  label: '上年比较资料',
                  children: (
                    <>
                      <Alert
                        type="info"
                        title="本年及比较年资料均需核实并保存，比较年报表不单独生成。"
                      />
                      <NonprofitConfigurationPanel
                        key={props.configuration.previous.year}
                        sources={props.source.previous}
                        initial={previous ?? props.configuration.previous}
                        request={props.source.previousRequest}
                        periods={periods}
                        onDirtyChange={dirty}
                        onSaveReady={(save) => {
                          previousSave.current = save;
                        }}
                        onDraftChange={(value) => {
                          previousDraft.current = value;
                          setPrevious(value);
                        }}
                        onRequestChange={() =>
                          setError('比较期间随本年自动选择，请在本年资料中修改。')
                        }
                        onSave={async (value) => {
                          previousDraft.current = value;
                          setPrevious(value);
                          if (!collecting.current) await saveCombined('previous');
                        }}
                        onGenerate={async () => {
                          throw new Error('请通过本年资料生成包含比较数据的报表');
                        }}
                      />
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
