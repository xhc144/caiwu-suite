import { useLayoutEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { useSessionCommitPending } from './unsaved';

/** Keep the old session's forms, tabs and portals read-only until final cleanup ends. */
export function SessionCommitBoundary({
  bookId,
  children,
}: {
  bookId: string;
  children: ReactNode;
}) {
  const pending = useSessionCommitPending(bookId);
  const status = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!pending) return;
    const previous = document.activeElement;
    status.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [pending]);
  const protect = (event: SyntheticEvent) => {
    if (!pending) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      data-session-book={bookId}
      style={{ position: 'relative', height: '100%', minHeight: '100%' }}
    >
      <div
        inert={pending}
        aria-busy={pending}
        style={{ height: '100%' }}
        onBeforeInputCapture={protect}
        onInputCapture={protect}
        onChangeCapture={protect}
        onSubmitCapture={protect}
        onClickCapture={protect}
        onDoubleClickCapture={protect}
        onPointerDownCapture={protect}
        onKeyDownCapture={protect}
        onKeyUpCapture={protect}
        onPasteCapture={protect}
        onCutCapture={protect}
        onDropCapture={protect}
        onCompositionStartCapture={protect}
        onFocusCapture={(event) => {
          if (!pending) return;
          protect(event);
          status.current?.focus();
        }}
      >
        {children}
      </div>
      {pending && (
        <div
          ref={status}
          role="status"
          aria-live="assertive"
          aria-label="正在保存登录信息"
          tabIndex={-1}
          onKeyDown={protect}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1_000_000,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(245, 245, 245, 0.92)',
            color: '#222',
          }}
        >
          <p>正在保存，请稍候。完成前暂时不能编辑或提交其他页面。</p>
        </div>
      )}
    </div>
  );
}
