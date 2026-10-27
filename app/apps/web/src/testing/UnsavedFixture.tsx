import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  coreApi,
  queryClient,
  useRequiredSession,
  useUnsavedChanges,
  useSubmission,
} from '@caiwu/web-kit';
import { MoneyInput } from '@caiwu/ui';
import type { InputRef } from 'antd';

/** Only reachable through the development-only example module; stores synthetic text in sessionStorage. */
export default function UnsavedFixture() {
  const location = useLocation(),
    navigate = useNavigate(),
    session = useRequiredSession();
  const name = location.pathname.endsWith('/b') ? '乙编辑页' : '甲编辑页';
  const key = `caiwu.fixture.${session.bookId}.${name}`;
  const [saved, setSaved] = useState(() => sessionStorage.getItem(key) ?? '');
  const [draft, setDraft] = useState(saved),
    [fail, setFail] = useState(false),
    [money, setMoney] = useState<number | null>(0);
  const input = useRef<InputRef>(null);
  const submission = useSubmission();
  const save = async () => {
    if (fail) throw new Error('模拟保存冲突');
    await queryClient.fetchQuery({ ...coreApi.auth.me.queryOptions(), staleTime: 0 });
    sessionStorage.setItem(key, draft);
    setSaved(draft);
    return true;
  };
  useUnsavedChanges({
    title: name,
    dirty: draft !== saved,
    version: draft,
    save,
    discard: () => setDraft(saved),
  });
  return (
    <section style={{ padding: 24 }}>
      <h1>{name}</h1>
      <label>
        合成文本
        <input
          aria-label="合成文本"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <label>
        <input type="checkbox" checked={fail} onChange={(event) => setFail(event.target.checked)} />
        模拟保存冲突
      </label>
      <MoneyInput aria-label="合成金额" ref={input} value={money} onChange={setMoney} />
      <output data-testid="fixture-money">{money}</output>
      <button onClick={() => input.current?.focus()}>聚焦金额</button>
      <button onClick={() => void navigate('/m/example/shared/a')}>打开甲编辑页</button>
      <button onClick={() => void navigate('/m/example/shared/b')}>打开乙编辑页</button>
      <button
        disabled={submission.isSubmitting}
        onClick={() => {
          void submission.submit(save).catch(() => {});
        }}
      >
        保存合成内容
      </button>
      <button
        onClick={() => {
          void queryClient
            .fetchQuery({ ...coreApi.auth.me.queryOptions(), staleTime: 0 })
            .catch(() => {});
        }}
      >
        刷新合成页面
      </button>
      <button
        onClick={() => {
          void queryClient.cancelQueries();
        }}
      >
        取消加载
      </button>
      <button onClick={() => void navigate(`/m/example/shared/slot${Math.random()}`)}>
        打开合成标签
      </button>
    </section>
  );
}
