import { useLayoutEffect, useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnterpriseConfig, SourceData } from '../templates/enterprise/model';
import { EnterpriseConfigSchema } from '../templates/enterprise/model';
import { fixture } from './enterprise/fixture';
import { StatutoryConfiguration } from '../web/statutory-registry';
import { createEnterpriseDraftBridge } from '../web/enterprise-draft';

type ContractProps = {
  initial: EnterpriseConfig;
  source: SourceData;
  onDraftChange?(configuration: EnterpriseConfig): void;
  onPeriodChange?(period: number, scope: EnterpriseConfig['scope']): void;
  onDirtyChange?(dirty: boolean): void;
  onSave(configuration: EnterpriseConfig): Promise<void>;
};

const lifecycle = vi.hoisted(() => ({ mounted: 0, unmounted: 0 }));

/** 模拟企业作者新增的发布契约；不依赖或修改未交付的模板组件源码。 */
vi.mock('../templates/enterprise/statutory.web', () => ({
  EnterpriseConfiguration: function EnterpriseContract(props: ContractProps) {
    const [configuration, setConfiguration] = useState(props.initial);
    const current = useRef(configuration);
    const mounted = useRef(props);
    useLayoutEffect(() => {
      lifecycle.mounted++;
      mounted.current.onDraftChange?.(current.current);
      return () => {
        lifecycle.unmounted++;
      };
    }, []);
    const publish = (next: EnterpriseConfig) => {
      current.current = next;
      setConfiguration(next);
      props.onDraftChange?.(next);
      props.onDirtyChange?.(true);
    };
    return (
      <section>
        <input
          aria-label="模拟企业来源草稿"
          value={configuration.adoption.source}
          onChange={(event) =>
            publish({
              ...current.current,
              adoption: { ...current.current.adoption, source: event.target.value },
            })
          }
        />
        <output data-testid="enterprise-contract-period">{configuration.period}</output>
        <button onClick={() => publish(invalidDraft(current.current))}>发布临时无效草稿</button>
        <button
          onClick={() => {
            const before = current.current;
            const next = {
              ...before,
              period: before.period % 100 === 12 ? before.period + 89 : before.period + 1,
            };
            publish(next);
            props.onPeriodChange?.(next.period, next.scope);
          }}
        >
          模拟企业换期
        </button>
        <button onClick={() => void props.onSave(current.current)}>模拟企业保存</button>
      </section>
    );
  },
  EnterpriseStatements: () => null,
}));

function invalidDraft(configuration: EnterpriseConfig): EnterpriseConfig {
  return {
    ...configuration,
    adoption: { ...configuration.adoption, source: '', version: '' },
    adjustments: [
      ...configuration.adjustments,
      {
        period: configuration.period,
        statement: 'profit',
        row: 'revenue',
        amount: '-',
        kind: 'other',
        source: '尚未填写完整的调整',
        version: '',
      },
    ],
  };
}

function adapterProps(configuration?: EnterpriseConfig) {
  const { c, d } = fixture();
  return {
    definitionId: 'enterprise-2019-appendix2',
    configuration: configuration ?? { ...c, period: 202611, scope: 'month' as const },
    source: d,
    onSave: vi.fn(async (_configuration: EnterpriseConfig) => {}),
    onGenerate: vi.fn(async () => {}),
    onPeriodChange: vi.fn((_period: number, _scope: EnterpriseConfig['scope']) => {}),
    onOptionsChange: vi.fn(),
    onDirtyChange: vi.fn(),
    onDraftChange: vi.fn((_configuration: EnterpriseConfig) => {}),
  };
}

beforeEach(() => {
  lifecycle.mounted = 0;
  lifecycle.unmounted = 0;
});

describe('w_bb_def 企业公共适配器草稿发布契约', () => {
  it('转发挂载时完整配置及编辑中的空来源和未完成金额，不用保存校验过滤草稿', () => {
    const props = adapterProps();
    render(<StatutoryConfiguration {...props} />);
    expect(props.onDraftChange).toHaveBeenCalledExactlyOnceWith(props.configuration);
    fireEvent.click(screen.getByRole('button', { name: '发布临时无效草稿' }));
    const expected = invalidDraft(props.configuration);
    const published = props.onDraftChange.mock.calls.at(-1)![0];
    expect(published).toEqual(expected);
    expect(EnterpriseConfigSchema.safeParse(published).success).toBe(false);
    expect(published.cashAllocations).toEqual(props.configuration.cashAllocations);
    expect(published.rules).toEqual(props.configuration.rules);
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('换期先发布新期间的完整无效草稿，来源查询响应替换后保持同一编辑实例', () => {
    const props = adapterProps();
    const events: { type: string; period: number; configuration?: EnterpriseConfig }[] = [];
    props.onDraftChange.mockImplementation((configuration) => {
      events.push({ type: 'draft', period: configuration.period, configuration });
    });
    props.onPeriodChange.mockImplementation((period) => {
      events.push({ type: 'period', period });
    });
    const view = render(<StatutoryConfiguration {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '发布临时无效草稿' }));
    const expected = { ...invalidDraft(props.configuration), period: 202612 };
    fireEvent.click(screen.getByRole('button', { name: '模拟企业换期' }));
    expect(events.slice(-2)).toEqual([
      { type: 'draft', period: 202612, configuration: expected },
      { type: 'period', period: 202612 },
    ]);
    view.rerender(
      <StatutoryConfiguration
        {...props}
        configuration={{ ...props.configuration, period: 202612 }}
        source={{ ...props.source }}
      />,
    );
    expect(lifecycle).toEqual({ mounted: 1, unmounted: 0 });
    expect(screen.getByTestId('enterprise-contract-period')).toHaveTextContent('202612');
    expect(screen.getByRole('textbox', { name: '模拟企业来源草稿' })).toHaveValue('');
    expect(props.onDraftChange.mock.calls.at(-1)![0]).toEqual(expected);
  });

  it('旧调用方省略可选草稿回调仍能保存完整企业配置', async () => {
    const props = adapterProps();
    render(<StatutoryConfiguration {...props} onDraftChange={undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '模拟企业保存' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledExactlyOnceWith(props.configuration));
  });
});

describe('w_bb_def 企业换期草稿与来源查询快照', () => {
  it('连续换期保留完整无效草稿，迟到的旧期间来源响应不会使报告日倒退', async () => {
    const bridge = createEnterpriseDraftBridge(202611);
    const initial = invalidDraft(adapterProps().configuration);
    bridge.publish({ ...initial, period: 202612 });
    const decemberRequest = bridge.options();
    bridge.publish({ ...initial, period: 202701 });
    const januaryRequest = bridge.options();
    expect(decemberRequest).toEqual({
      enterpriseDraft: { configuration: { ...initial, period: 202612 }, sourcePeriod: 202611 },
    });
    expect(januaryRequest).toEqual({
      enterpriseDraft: { configuration: { ...initial, period: 202701 }, sourcePeriod: 202611 },
    });
    let resolveOld!: () => void;
    let resolveNew!: () => void;
    const oldResponse = new Promise<void>((resolve) => {
      resolveOld = resolve;
    }).then(() => bridge.acceptSource(202612));
    const newResponse = new Promise<void>((resolve) => {
      resolveNew = resolve;
    }).then(() => bridge.acceptSource(202701));
    resolveNew();
    await newResponse;
    resolveOld();
    await oldResponse;
    expect(bridge.options()).toEqual({
      enterpriseDraft: { configuration: { ...initial, period: 202701 }, sourcePeriod: 202701 },
    });
    expect(januaryRequest!.enterpriseDraft.sourcePeriod).toBe(202611);
    expect(decemberRequest!.enterpriseDraft.configuration.period).toBe(202612);
  });

  it('发布和取出均深拷贝，组件原对象及并发请求快照互相修改不会污染最新草稿', () => {
    const bridge = createEnterpriseDraftBridge(202611);
    const initial = invalidDraft(adapterProps().configuration);
    const expected = structuredClone(initial);
    bridge.publish(initial);
    const request = bridge.options()!;
    initial.adoption.source = '组件后续改动';
    initial.cashAllocations[0]!.parts[0]!.amount = '99999';
    request.enterpriseDraft.configuration.adjustments.at(-1)!.amount = '88888';
    request.enterpriseDraft.configuration.rules.splice(0, 1);
    expect(bridge.options()!.enterpriseDraft.configuration).toEqual(expected);
    expect(request.enterpriseDraft.configuration.cashAllocations).toEqual(expected.cashAllocations);
    bridge.publish({ ...expected, period: 202612 });
    expect(bridge.options()!.enterpriseDraft.configuration.period).toBe(202612);
    expect(request.enterpriseDraft.configuration.period).toBe(202611);
  });

  it('保存来源重建显式使用提交时配置，保存期间产生的新草稿仍保留在桥接器中', () => {
    const bridge = createEnterpriseDraftBridge(202611);
    const submitted = adapterProps().configuration;
    const later = invalidDraft({ ...submitted, period: 202612 });
    bridge.publish(later);
    const saveRequest = bridge.options(submitted)!;
    submitted.adoption.source = '调用方提交后继续编辑';
    expect(saveRequest.enterpriseDraft.configuration.period).toBe(202611);
    expect(saveRequest.enterpriseDraft.configuration.adoption.source).not.toBe(
      '调用方提交后继续编辑',
    );
    expect(saveRequest.enterpriseDraft.sourcePeriod).toBe(202611);
    expect(bridge.options()!.enterpriseDraft.configuration).toEqual(later);
    expect(EnterpriseConfigSchema.safeParse(later).success).toBe(false);
  });

  it('不同账套报表页面实例不串稿，显式放弃仅重置本实例及其来源报告日', () => {
    const bookA = createEnterpriseDraftBridge(202611);
    const bookB = createEnterpriseDraftBridge(202401);
    const first = invalidDraft(adapterProps().configuration);
    const second = {
      ...adapterProps().configuration,
      period: 202402,
      adoption: { ...first.adoption, source: '另一账套自己的依据' },
    };
    bookA.publish(first);
    bookB.publish(second);
    bookA.acceptSource(202701);
    expect(bookB.options()).toEqual({
      enterpriseDraft: { configuration: second, sourcePeriod: 202401 },
    });
    bookA.reset(202511);
    expect(bookA.options()).toBeUndefined();
    expect(bookA.options({ ...first, period: 202511 })).toEqual({
      enterpriseDraft: { configuration: { ...first, period: 202511 }, sourcePeriod: 202511 },
    });
    expect(bookB.options()).toEqual({
      enterpriseDraft: { configuration: second, sourcePeriod: 202401 },
    });
  });
});
