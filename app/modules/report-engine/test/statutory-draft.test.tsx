import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sessionStore, unsavedPages, type SessionState } from '@caiwu/web-kit';
import { EnterpriseConfiguration } from '../templates/enterprise/statutory.web';
import { fixture } from './enterprise/fixture';
import { initialConfiguration } from '../templates/small-business/configuration';
import { StatutoryConfiguration } from '../web/statutory-registry';
import { useStatutoryDraft } from '../web/statutory-draft';
import type { StatutoryProfile } from '../shared';

afterEach(() => {
  cleanup();
  unsavedPages.pages.clear();
  sessionStore.set(null);
  vi.restoreAllMocks();
});
const session = (bookId = 'book-A') =>
  sessionStore.set({ bookId, token: 'synthetic-token' } as SessionState);
function enterpriseEditor(
  onSave: (configuration: ReturnType<typeof fixture>['c']) => Promise<void>,
) {
  const { c, d } = fixture();
  function Editor() {
    const [epoch, setEpoch] = useState(0);
    const draft = useStatutoryDraft('企业法定报表', () => setEpoch((e) => e + 1));
    return (
      <EnterpriseConfiguration
        key={epoch}
        initial={c}
        source={d}
        onDirtyChange={draft.markDirty}
        onSaveReady={draft.registerSave}
        onSave={(value) => draft.persist(() => onSave(value))}
      />
    );
  }
  return { Editor, initial: c };
}
const sourceInput = () => screen.getAllByRole('textbox', { name: '依据来源' })[0]!;
it('w_bb_def 真实企业配置登记壳守卫；取消保留，保存期间的新编辑不被旧成功清除', async () => {
  session();
  let finish!: () => void;
  const onSave = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const { Editor } = enterpriseEditor(onSave);
  render(<Editor />);
  fireEvent.change(sourceInput(), { target: { value: '保存前的来源编辑' } });
  expect(unsavedPages.dirty('book-A')).toHaveLength(1);
  expect(await unsavedPages.leave('book-A', undefined, async () => 'cancel')).toBe(false);
  expect(sourceInput()).toHaveValue('保存前的来源编辑');
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = unsavedPages.leave('book-A', undefined, async () => 'save');
  });
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  fireEvent.change(sourceInput(), { target: { value: '保存中继续修改的来源' } });
  let allowed = true;
  await act(async () => {
    finish();
    allowed = await pending;
  });
  expect(allowed).toBe(false);
  expect(onSave.mock.calls[0]![0].adoption.source).toBe('保存前的来源编辑');
  expect(sourceInput()).toHaveValue('保存中继续修改的来源');
  expect(unsavedPages.dirty('book-A')).toHaveLength(1);
  await act(async () => {
    allowed = await unsavedPages.leave('book-A', undefined, async () => 'save');
  });
  expect(allowed).toBe(true);
  expect(onSave.mock.calls[1]![0].adoption.source).toBe('保存中继续修改的来源');
  expect(unsavedPages.dirty('book-A')).toHaveLength(0);
});
it('w_bb_def 保存失败仍脏；明确放弃才恢复已保存内容，账套登记互相隔离', async () => {
  session();
  const { Editor, initial } = enterpriseEditor(
    vi.fn().mockRejectedValue(new Error('合成保存失败')),
  );
  render(<Editor />);
  fireEvent.change(sourceInput(), { target: { value: '失败后仍要保留的编辑' } });
  let allowed = true;
  await act(async () => {
    allowed = await unsavedPages.leave('book-A', undefined, async () => 'save');
  });
  expect(allowed).toBe(false);
  expect(sourceInput()).toHaveValue('失败后仍要保留的编辑');
  expect(unsavedPages.dirty('book-A')).toHaveLength(1);
  expect(unsavedPages.dirty('book-B')).toHaveLength(0);
  await act(async () => {
    allowed = await unsavedPages.leave('book-A', undefined, async () => 'discard');
  });
  expect(allowed).toBe(true);
  expect(sourceInput()).toHaveValue(initial.adoption.source);
  expect(unsavedPages.dirty('book-A')).toHaveLength(0);
});
it('w_bb_def 小企受控配置通过同一壳守卫保存当前编辑', async () => {
  session();
  const onSave = vi.fn(async (_configuration: StatutoryProfile['configuration']) => {});
  function Editor() {
    const draft = useStatutoryDraft('小企法定报表', () => {});
    return (
      <StatutoryConfiguration
        definitionId="small-business"
        configuration={{ period: 202612, scope: 'annual', value: initialConfiguration('book-A') }}
        source={{
          accounts: [],
          entries: [],
          analysisRows: [],
          openingRows: [],
          periods: [{ period: 202612 }],
          book: { startPeriod: 202601 },
        }}
        onDirtyChange={draft.markDirty}
        onSaveReady={draft.registerSave}
        onSave={(value) => draft.persist(() => onSave(value))}
        onGenerate={async () => {}}
        onPeriodChange={() => {}}
        onOptionsChange={() => {}}
      />
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByRole('tab', { name: '比较年度' }));
  fireEvent.change(screen.getByRole('textbox', { name: '首次会计年度' }), {
    target: { value: '2026' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: '首年依据' }), {
    target: { value: '合成设立日期及首年依据' },
  });
  expect(unsavedPages.dirty('book-A')).toHaveLength(1);
  let allowed = false;
  await act(async () => {
    allowed = await unsavedPages.leave('book-A', undefined, async () => 'save');
  });
  expect(allowed).toBe(true);
  expect(onSave).toHaveBeenCalledOnce();
  expect(onSave.mock.calls[0]![0]).toMatchObject({
    value: { firstYear: { year: 2026, reason: '合成设立日期及首年依据' } },
  });
  expect(unsavedPages.dirty('book-A')).toHaveLength(0);
});
