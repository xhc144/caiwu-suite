import { useRef, useState } from 'react';
import { Button, Modal, Space } from 'antd';
import { useSubmission, useUnsavedChanges } from '@caiwu/web-kit';

/** One edit version covers the form and its nested accessories or import preview. */
export function useAssetDraft(input: {
  title: string;
  save: () => Promise<boolean | void>;
  discard?: () => Promise<void> | void;
}) {
  const state = useRef({ dirty: false, version: 0 });
  const [, render] = useState(0);
  const latest = useRef(input);
  const closing = useRef<ReturnType<typeof Modal.confirm> | null>(null);
  latest.current = input;
  const submission = useSubmission();
  const update = () => render((value) => value + 1);
  const changed = () => {
    state.current = { dirty: true, version: state.current.version + 1 };
    update();
  };
  const clear = () => {
    state.current = { dirty: false, version: state.current.version + 1 };
    update();
  };
  const save = () =>
    submission.submit(async () => {
      const version = state.current.version;
      const result = await latest.current.save();
      if (result === false || state.current.version !== version) return false;
      clear();
      return true;
    });
  const discard = async () => {
    await latest.current.discard?.();
    clear();
  };
  useUnsavedChanges({
    title: input.title,
    dirty: state.current.dirty,
    version: state.current.version,
    save,
    discard,
  });
  const close = (onClose: () => void) => {
    if (submission.isSubmitting || closing.current) return;
    if (!state.current.dirty) return onClose();
    let saving = false;
    const dialog = Modal.confirm({
      title: '有未保存内容',
      transitionName: '',
      maskTransitionName: '',
      content: input.title,
      okText: '保存并关闭',
      cancelText: '继续编辑',
      afterClose: () => {
        closing.current = null;
      },
      onOk: async () => {
        saving = true;
        dialog.update({ cancelButtonProps: { disabled: true } });
        try {
          if (await save()) onClose();
        } finally {
          saving = false;
          dialog.update({ cancelButtonProps: { disabled: false } });
        }
      },
      footer: (_, { OkBtn, CancelBtn }) => (
        <Space wrap>
          <Button
            danger
            onClick={() => {
              if (saving) return;
              void discard().then(() => {
                dialog.destroy();
                onClose();
              });
            }}
          >
            放弃修改并关闭
          </Button>
          <CancelBtn />
          <OkBtn />
        </Space>
      ),
    });
    closing.current = dialog;
  };
  return {
    dirty: state.current.dirty,
    version: state.current.version,
    changed,
    clear,
    save,
    close,
    saving: submission.isSubmitting,
  };
}
