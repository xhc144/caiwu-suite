import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** 离开操作会等待保存队列；队列释放前同步更新壳登记的保存状态。 */
export function useSaveActivity() {
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  return {
    pending,
    saving,
    startSaving() {
      pending.current = true;
      setSaving(true);
    },
    finishSaving() {
      flushSync(() => {
        pending.current = false;
        setSaving(false);
      });
    },
  };
}
