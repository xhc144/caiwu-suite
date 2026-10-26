import { Alert, Button, Drawer, Input, Select, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { queryClient } from '@caiwu/web-kit';
import type { ReportTemplate } from '../shared';
import { api } from './api';
import { preparePaste, type PasteMode } from './paste';

export function PasteDrawer({
  template,
  start,
  disabled,
  onApply,
  onClose,
}: {
  template: ReportTemplate;
  start: string;
  disabled: boolean;
  onApply(template: ReportTemplate): void;
  onClose(): void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<PasteMode>('target');
  const [preview, setPreview] = useState<ReturnType<typeof preparePaste> & { input: string }>();
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const active = useRef(true),
    running = useRef(false);
  const latest = useRef({ template, disabled });
  latest.current = { template, disabled };
  const epoch = useRef(0);
  useEffect(() => {
    if (disabled) epoch.current++;
  }, [disabled]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const build = () => {
    try {
      setPreview({ ...preparePaste(template, start, text, mode), input: JSON.stringify(template) });
      setError('');
    } catch (e) {
      setPreview(undefined);
      setError(e instanceof Error ? e.message : '无法预览粘贴');
    }
  };
  const apply = async () => {
    if (!preview || disabled || running.current) return;
    running.current = true;
    setWorking(true);
    const input = preview.input,
      ticket = epoch.current;
    if (JSON.stringify(template) !== input) {
      running.current = false;
      setWorking(false);
      setError('报表草稿已变化，请重新预览粘贴范围');
      return;
    }
    try {
      const formulas = [
        ...new Set(preview.changes.filter((c) => c.kind === 'formula').map((c) => c.source)),
      ];
      for (let i = 0; i < formulas.length; i += 4) {
        const checks = await Promise.all(
          formulas.slice(i, i + 4).map(async (source) => ({
            source,
            result: await queryClient.fetchQuery(api.validateFormula.queryOptions({ source })),
          })),
        );
        const bad = checks.find((c) => !c.result.valid);
        if (bad)
          throw new Error(
            `${preview.changes.find((c) => c.kind === 'formula' && c.source === bad.source)!.address}：${bad.result.message}`,
          );
      }
      if (!active.current || latest.current.disabled || ticket !== epoch.current) return;
      if (JSON.stringify(latest.current.template) !== input)
        throw new Error('报表草稿已变化，请关闭粘贴并重新选择范围');
      onApply(preview.template);
      onClose();
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : '粘贴失败，原草稿未改变');
    } finally {
      running.current = false;
      if (active.current) setWorking(false);
    }
  };
  return (
    <Drawer
      getContainer={false}
      open
      title={`区域粘贴（从 ${start} 开始）`}
      size={680}
      onClose={onClose}
    >
      <Alert
        type="info"
        title="粘贴表格的制表符文本，先预览再确认覆盖"
        description="空白字段会清空目标格；保留目标类型时，未定义的目标格按文本处理。金额输入元并精确转换为整数分。公式须明确选择公式类型或粘贴到已有公式格，不会把普通文本自动执行。"
      />
      <Select
        aria-label="粘贴类型"
        style={{ width: '100%', marginBlock: 12 }}
        disabled={disabled || working}
        value={mode}
        options={[
          { value: 'target', label: '保留目标单元格类型' },
          { value: 'text', label: '全部作为文本' },
          { value: 'money', label: '全部作为金额（元）' },
          { value: 'number', label: '全部作为普通数值' },
          { value: 'formula', label: '全部作为公式（保留目标单位，未定义格默认本币分）' },
        ]}
        onChange={(value) => {
          setMode(value);
          setPreview(undefined);
        }}
      />
      <Input.TextArea
        aria-label="区域粘贴内容"
        value={text}
        disabled={disabled || working}
        autoSize={{ minRows: 6, maxRows: 14 }}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(undefined);
        }}
      />
      <p>
        每次最多500格、文本1MB、每格2000字；不改变格式和合并范围。单格公式语法通过后仍须实际生成检查单位、引用和除零。
      </p>
      {preview && (
        <Alert
          type="warning"
          style={{ marginBlock: 12 }}
          title={`将覆盖 ${preview.range} 共 ${preview.count} 格，其中已有内容 ${preview.overwritten} 格`}
          description="确认仅修改当前草稿；整批成功或整批不变。可撤销，须保存后才写入账套。"
        />
      )}
      {error && (
        <Alert
          type="error"
          style={{ marginBlock: 12 }}
          title={error}
          description="原草稿未改变。"
        />
      )}
      <Space style={{ marginTop: 12 }}>
        <Button disabled={disabled || working} onClick={build}>
          预览粘贴
        </Button>
        <Button
          type="primary"
          disabled={disabled || working || !preview}
          aria-busy={working}
          onClick={() => void apply()}
        >
          确认粘贴到草稿
        </Button>
        <Button onClick={onClose}>取消</Button>
      </Space>
    </Drawer>
  );
}
