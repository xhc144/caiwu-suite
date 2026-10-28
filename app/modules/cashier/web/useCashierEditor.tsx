import { useReducer, useRef, useState } from 'react';
import { Button, Modal, Space, type FormInstance } from 'antd';
import { useHotkey, useSubmission, useUnsavedChanges } from '@caiwu/web-kit';
import type { MoneyInputDraftState } from '@caiwu/ui';

/** 缓存原文；组件卸载的 null 只是生命周期通知。仅显式重置才清除草稿。 */
export function useMoneyDrafts(onEdit?: () => void) {
  const cache = useRef(new Map<string, MoneyInputDraftState>());
  const resets = useRef(new Map<string, number>());
  const epoch = useRef(0);
  const [, render] = useReducer((v: number) => v + 1, 0);
  const valid = (fields: readonly string[]) =>
    fields.every((name) => cache.current.get(name)?.valid !== false);
  return {
    valid,
    input(name: string) {
      return {
        draftText: cache.current.get(name)?.text,
        resetKey: `${epoch.current}:${resets.current.get(name) ?? 0}`,
        onDraftStateChange(state: MoneyInputDraftState | null) {
          if (!state) return;
          const previous = cache.current.get(name);
          cache.current.set(name, state);
          if (
            previous &&
            (previous.valid !== state.valid ||
              (previous.valid && state.valid
                ? previous.value !== state.value
                : previous.text !== state.text))
          ) {
            onEdit?.();
            render();
          }
        },
      };
    },
    rule(name: string) {
      return {
        validator: async () => {
          const state = cache.current.get(name);
          if (state && !state.valid) throw new Error(state.message);
        },
      };
    },
    preflight(form: FormInstance, fields: readonly string[]) {
      const invalid = fields.filter((name) => cache.current.get(name)?.valid === false);
      form.setFields(
        invalid.map((name) => {
          const state = cache.current.get(name)!;
          return { name, errors: [state.valid ? '' : state.message] };
        }),
      );
      return invalid.length === 0;
    },
    reset(name?: string) {
      if (name) {
        cache.current.delete(name);
        resets.current.set(name, (resets.current.get(name) ?? 0) + 1);
      } else {
        cache.current.clear();
        epoch.current += 1;
      }
      render();
    },
  };
}

/** 所有保存入口共用草稿预检；响应只确认发送时的版本。 */
export function useCashierEditor<V extends object>({
  form,
  title,
  fields,
  onSave,
  onClose,
}: {
  form: FormInstance<V>;
  title: string;
  fields: readonly (keyof V & string)[];
  onSave: (values: V) => Promise<void>;
  onClose: () => void;
}) {
  const version = useRef(0);
  const saved = useRef(0);
  const working = useRef(false);
  const [, render] = useReducer((v: number) => v + 1, 0);
  const [confirming, setConfirming] = useState(false);
  const [savedEarlier, setSavedEarlier] = useState(false);
  const { submit, isSubmitting } = useSubmission();
  const changed = () => {
    version.current += 1;
    render();
  };
  const money = useMoneyDrafts(changed);
  const save = () => {
    if (!money.preflight(form, fields)) return Promise.resolve(false);
    return submit(async () => {
      working.current = true;
      try {
        if (!money.preflight(form, fields)) return false;
        const values = await form.validateFields();
        if (!money.preflight(form, fields)) return false;
        const sentVersion = version.current;
        await onSave(structuredClone(values));
        saved.current = sentVersion;
        const clean = version.current === sentVersion;
        setSavedEarlier(!clean);
        render();
        if (clean) {
          money.reset();
          onClose();
        }
        return clean;
      } catch {
        // 表单显示校验错误，接口错误由共享层提示；失败保留全部输入。
        return false;
      } finally {
        working.current = false;
      }
    });
  };
  const discard = () => {
    if (working.current) throw new Error('正在保存，请等待保存结果后再放弃修改');
    saved.current = version.current;
    money.reset();
    form.resetFields();
    onClose();
  };
  useUnsavedChanges({
    title,
    dirty: version.current !== saved.current,
    version: version.current,
    save,
    discard,
  });
  useHotkey('Ctrl+S', () => {
    if (!confirming) void save();
  });
  return {
    money,
    changed,
    save,
    isSubmitting,
    savedEarlier,
    close() {
      if (working.current) return;
      if (version.current === saved.current) onClose();
      else setConfirming(true);
    },
    holder: (
      <Modal
        open={confirming}
        title="有未保存内容"
        onCancel={() => setConfirming(false)}
        footer={
          <Space>
            <Button onClick={() => setConfirming(false)}>取消</Button>
            <Button
              disabled={isSubmitting}
              onClick={() => {
                setConfirming(false);
                discard();
              }}
            >
              放弃修改并关闭
            </Button>
            <Button
              type="primary"
              loading={isSubmitting}
              onClick={() => {
                setConfirming(false);
                void save();
              }}
            >
              保存并关闭
            </Button>
          </Space>
        }
      >
        {title}有修改尚未保存，请选择如何处理。
      </Modal>
    ),
  };
}
