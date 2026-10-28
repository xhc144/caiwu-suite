import { useRef, useState } from 'react';
import { App, Button, Space, Tabs } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { queryClient, notify, useHotkey, useSubmission, useUnsavedChanges } from '@caiwu/web-kit';
import { defaultSettings, SettingsSchema, type Settings } from '../shared';
import { api } from './api';
import { continueAfterEdit, type UnsavedChoice } from './unsaved';
export default function SettingsEditor({
  settings,
  onClose,
}: {
  settings: Settings;
  onClose: () => void;
}) {
  const [value, setValue] = useState(settings);
  const [original, setOriginal] = useState(JSON.stringify(settings));
  const current = useRef(value),
    saved = useRef(original);
  current.current = value;
  saved.current = original;
  const version = JSON.stringify(value);
  const dirty = version !== original;
  const { submit, isSubmitting } = useSubmission();
  const { modal } = App.useApp();
  const save = useMutation(
    api.saveSettings.mutationOptions({
      onSuccess: () => {
        notify.success('打印设置已保存并立即生效');
        void queryClient.invalidateQueries({ queryKey: api.settings.queryKey() });
      },
    }),
  );
  const persist = () =>
    submit(async () => {
      const snapshot = current.current;
      const parsed = SettingsSchema.safeParse(snapshot);
      if (!parsed.success) {
        notify.error(parsed.error.issues[0]?.message ?? '设置无效');
        return false;
      }
      const stored = await save.mutateAsync(parsed.data);
      const serialized = JSON.stringify(stored);
      saved.current = serialized;
      setOriginal(serialized);
      return JSON.stringify(current.current) === JSON.stringify(snapshot);
    });
  useUnsavedChanges({
    title: '打印格式设置',
    dirty,
    version,
    save: persist,
    discard: async () => {
      await submit(async () => true);
      setValue(JSON.parse(saved.current) as Settings);
    },
  });
  const close = () => {
    if (isSubmitting) return;
    void continueAfterEdit(
      dirty,
      () =>
        new Promise<UnsavedChoice>((resolve) => {
          let choice: UnsavedChoice = 'cancel';
          const dialog = modal.confirm({
            title: '打印设置尚未保存',
            content: '保存修改后关闭，或放弃修改；取消会保留输入。',
            okText: '保存并继续',
            cancelText: '取消',
            onOk: () => {
              choice = 'save';
            },
            afterClose: () => resolve(choice),
            footer: (_, { OkBtn, CancelBtn }) => (
              <Space>
                <Button
                  danger
                  onClick={() => {
                    choice = 'discard';
                    dialog.destroy();
                  }}
                >
                  放弃修改
                </Button>
                <CancelBtn />
                <OkBtn />
              </Space>
            ),
          });
        }),
      persist,
      onClose,
    ).catch(() => {
      /* 保存失败保留输入。 */
    });
  };
  useHotkey('Ctrl+S', () => {
    void persist().catch(() => {});
  });
  const fields = (kind: 'voucher' | 'ledger') => {
    const s = value[kind];
    const change = (key: string, v: unknown) =>
      setValue((old) => ({ ...old, [kind]: { ...old[kind], [key]: v } }));
    const number = (key: keyof typeof s, label: string, min: number, max: number) => (
      <label key={key}>
        {label}
        <input
          type="number"
          min={min}
          max={max}
          step="any"
          value={String(s[key])}
          onChange={(e) => change(key, Number(e.target.value))}
        />
      </label>
    );
    const check = (key: keyof typeof s, label: string) => (
      <label key={key}>
        <input type="checkbox" checked={!!s[key]} onChange={(e) => change(key, e.target.checked)} />
        {label}
      </label>
    );
    return (
      <div className="print-form">
        <label>
          纸张
          <select value={s.paper} onChange={(e) => change('paper', e.target.value)}>
            <option value="A4">A4</option>
            <option value="A5">A5（148 × 210 毫米）</option>
            <option value="B5">B5（ISO，176 × 250 毫米）</option>
            <option value="custom">凭证纸 / 自定义毫米</option>
          </select>
        </label>
        {number('widthMm', '自定义宽度（毫米）', 80, 600)}
        {number('heightMm', '自定义高度（毫米）', 80, 600)}
        {kind === 'voucher' && (
          <>
            <label>
              每页凭证张数
              <select
                aria-label="每页凭证张数"
                value={s.perPage}
                onChange={(e) => change('perPage', Number(e.target.value))}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            {number('voucherGapMm', '合并凭证间距（毫米）', 0, 50)}
          </>
        )}
        {check('landscape', '横向打印')}
        {number('rows', '每页行数上限', 1, 100)}
        {number('fontSize', '字体大小（磅）', 6, 24)}
        <label>
          字体
          <select value={s.font} onChange={(e) => change('font', e.target.value)}>
            <option value="serif">宋体 / 衬线</option>
            <option value="sans-serif">黑体 / 无衬线</option>
          </select>
        </label>
        {number('scale', '实际打印比例（25–100%）', 25, 100)}
        {number('copies', '打印份数', 1, 99)}
        {(['top', 'right', 'bottom', 'left'] as const).map((side, i) => (
          <label key={side}>
            {['上', '右', '下', '左'][i]}边距（毫米）
            <input
              type="number"
              min={0}
              max={100}
              value={s.margins[side]}
              onChange={(e) => change('margins', { ...s.margins, [side]: Number(e.target.value) })}
            />
          </label>
        ))}
        {number('offsetX', '水平套打偏移（毫米）', -100, 100)}
        {number('offsetY', '垂直套打偏移（毫米）', -100, 100)}
        <label>
          打印单位名称
          <input
            maxLength={100}
            value={s.unitName}
            placeholder="留空使用当前账套单位"
            onChange={(e) => change('unitName', e.target.value)}
          />
        </label>
        {check('showUnit', '显示单位名称')}
        {kind === 'voucher' && (
          <>
            <label>
              会计主管姓名
              <input
                maxLength={40}
                value={s.supervisor}
                onChange={(e) => change('supervisor', e.target.value)}
              />
            </label>
            {check('showAccountCode', '打印科目编码')}
            {check('showAuxiliary', '打印辅助项目')}
            {check('deduplicateSummary', '摘要重复不显示')}
          </>
        )}
        {kind === 'ledger' && (
          <>
            {number('startPage', '账册开始页码', 1, 999999)}
            {check('continuousPage', '各科目连续页码')}
          </>
        )}
        {number('quantityDecimals', '数量保留小数位', 0, 6)}
        {check('color', '彩色打印')}
      </div>
    );
  };
  return (
    <>
      <Tabs
        items={[
          { key: 'voucher', label: '凭证设置', children: fields('voucher') },
          { key: 'ledger', label: '账册设置', children: fields('ledger') },
        ]}
      />
      <Space>
        <Button
          type="primary"
          loading={isSubmitting}
          onClick={() => {
            void persist()
              .then((complete) => {
                if (complete) onClose();
              })
              .catch(() => {});
          }}
        >
          保存设置
        </Button>
        <Button
          onClick={() =>
            modal.confirm({
              title: '恢复凭证和账册默认设置？',
              content: '点击保存设置后生效。',
              onOk: () => setValue(structuredClone(defaultSettings)),
            })
          }
        >
          恢复默认
        </Button>
        <Button disabled={isSubmitting} onClick={close}>
          关闭设置
        </Button>
      </Space>
    </>
  );
}
