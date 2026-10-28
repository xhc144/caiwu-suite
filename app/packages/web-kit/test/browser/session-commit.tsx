import { useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SessionCommitBoundary } from '../../src/session-commit';
import { sessionStore, type SessionState } from '../../src/session';
import { unsavedPages, useUnsavedChanges } from '../../src/unsaved';

sessionStore.set({ bookId: 'a', token: 'synthetic-token' } as SessionState);

function App() {
  const [text, setText] = useState('已保存打印稿');
  const [saved, setSaved] = useState(text);
  const [portal, setPortal] = useState('抽屉原稿');
  const [other, setOther] = useState('另账套原稿');
  const [requests, setRequests] = useState(0);
  const [submissions, setSubmissions] = useState(0);
  const [otherSubmissions, setOtherSubmissions] = useState(0);
  const [loggedOut, setLoggedOut] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  useUnsavedChanges({
    title: '打印设置',
    dirty: text !== saved,
    version: text,
    save: async () => {
      setSaved(text);
    },
  });
  const save = async () => {
    const outcome = await unsavedPages.saveSessionChange(
      'a',
      'password',
      async () => 'save',
      async (context) =>
        context!.commit(async () => {
          setRequests((n) => n + 1);
          const response = await fetch('/credential', { method: 'POST' });
          if (!response.ok) throw new Error('凭据写入失败');
          context!.afterLeave(async () => {
            await fetch('/cleanup', { method: 'POST' });
            setLoggedOut(true);
          });
          return { sessionRevoked: true };
        }),
    );
    setResult(`${outcome.allowed}/${outcome.sessionRevoked}`);
    if (outcome.error instanceof Error) setError(outcome.error.message);
  };
  return (
    <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: 350 }}>
      <SessionCommitBoundary bookId="a">
        {loggedOut ? (
          <p>请重新登录</p>
        ) : (
          <>
            <form
              aria-label="甲表单"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmissions((n) => n + 1);
              }}
            >
              <input
                aria-label="打印草稿"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <button type="submit">甲提交</button>
            </form>
            <button onClick={() => void save()}>改密</button>
            {createPortal(
              <input
                style={{ position: 'fixed', bottom: 20, left: 20 }}
                aria-label="甲抽屉"
                value={portal}
                onChange={(event) => setPortal(event.target.value)}
              />,
              document.body,
            )}
          </>
        )}
        <output aria-label="凭据请求数">{requests}</output>
        <output aria-label="甲提交数">{submissions}</output>
        <output aria-label="协调结果">{result}</output>
        {error && <p role="alert">{error}</p>}
      </SessionCommitBoundary>
      <SessionCommitBoundary bookId="b">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setOtherSubmissions((n) => n + 1);
          }}
        >
          <input
            aria-label="乙草稿"
            value={other}
            onChange={(event) => setOther(event.target.value)}
          />
          <button type="submit">乙提交</button>
        </form>
        <output aria-label="乙提交数">{otherSubmissions}</output>
      </SessionCommitBoundary>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
