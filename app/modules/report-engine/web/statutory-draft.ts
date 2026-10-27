import { useCallback, useRef, useState } from 'react';
import { useUnsavedChanges } from '@caiwu/web-kit';

export type StatutoryDraftCallbacks = {
  onDirtyChange?(dirty: boolean): void;
  onSaveReady?(save: () => Promise<void>): void;
};

/** 每个页面实例独立登记；只把本次成功保存所对应的编辑版本标为已保存。 */
export function useStatutoryDraft(title: string, discard: () => void) {
  const state = useRef({ version: 0, saved: 0 });
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(0);
  const saver = useRef<(() => Promise<void>) | null>(null);
  const markDirty = useCallback((dirty: boolean) => {
    if (dirty) {
      state.current.version++;
      setVersion(state.current.version);
    }
    // 子表单的旧保存回调不能清除其他字段或保存期间产生的新编辑。
  }, []);
  const registerSave = useCallback((save: () => Promise<void>) => {
    saver.current = save;
  }, []);
  const persist = async <T>(run: () => Promise<T>) => {
    const submitted = state.current.version;
    const result = await run();
    state.current.saved = submitted;
    setSaved(submitted);
    return result;
  };
  useUnsavedChanges({
    title,
    dirty: version !== saved,
    version,
    save: async () => {
      if (!saver.current) return false;
      try {
        await saver.current();
        return state.current.version === state.current.saved;
      } catch {
        return false;
      }
    },
    discard: () => {
      discard();
      state.current.saved = state.current.version;
      setSaved(state.current.saved);
    },
  });
  return { dirty: version !== saved, version, markDirty, registerSave, persist };
}
