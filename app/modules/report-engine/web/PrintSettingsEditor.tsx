import { Alert, Button, Checkbox, Drawer, Input, InputNumber, Select, Space } from 'antd';
import { useState } from 'react';
import { PrintSettingsSchema, type PrintSettings } from '../shared';

export function PrintSettingsEditor({
  value,
  disabled,
  onApply,
  onClose,
}: {
  value?: PrintSettings;
  disabled: boolean;
  onApply(value: PrintSettings): void;
  onClose(): void;
}) {
  const [settings, setSettings] = useState(() => PrintSettingsSchema.parse(value ?? {}));
  const [breaks, setBreaks] = useState(settings.rowBreaks.join(','));
  const [error, setError] = useState('');
  const apply = () => {
    if (disabled) return;
    const rowBreaks =
      breaks.trim() === ''
        ? []
        : breaks
            .trim()
            .split(/[,，、\s]+/)
            .map(Number);
    const parsed = PrintSettingsSchema.safeParse({ ...settings, rowBreaks });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('；'));
      return;
    }
    onApply(parsed.data);
  };
  return (
    <Drawer
      getContainer={false}
      open
      title="打印设置"
      size={560}
      onClose={onClose}
      extra={
        <Button type="primary" disabled={disabled} onClick={apply}>
          应用打印设置
        </Button>
      }
    >
      <Space orientation="vertical" size="middle" style={{ display: 'flex' }}>
        <Alert
          type="info"
          title="打印设置随报表定义保存"
          description="普通打印按纸张宽度适配并自动分页；手工分页线优先，合并单元格不会被拆开。请保存后生成报表，再打印结果。"
        />
        {error && <Alert type="error" title={error} />}
        <label>
          纸张{' '}
          <Select
            aria-label="打印纸张"
            value={settings.paperSize}
            disabled={disabled}
            style={{ width: 130 }}
            options={['A4', 'A5', 'B5'].map((v) => ({ value: v, label: v }))}
            onChange={(paperSize: PrintSettings['paperSize']) =>
              setSettings({ ...settings, paperSize })
            }
          />
        </label>
        <label>
          方向{' '}
          <Select
            aria-label="打印方向"
            value={settings.orientation}
            disabled={disabled}
            style={{ width: 130 }}
            options={[
              { value: 'portrait', label: '纵向' },
              { value: 'landscape', label: '横向' },
            ]}
            onChange={(orientation) => setSettings({ ...settings, orientation })}
          />
        </label>
        <label>
          页边距（毫米）{' '}
          <InputNumber
            aria-label="打印页边距"
            value={settings.marginMm}
            min={0}
            max={40}
            disabled={disabled}
            onChange={(marginMm) => marginMm !== null && setSettings({ ...settings, marginMm })}
          />
        </label>
        <label>
          重复表头行数{' '}
          <InputNumber
            aria-label="重复表头行数"
            value={settings.repeatRows}
            min={0}
            max={998}
            disabled={disabled}
            onChange={(repeatRows) =>
              repeatRows !== null && setSettings({ ...settings, repeatRows })
            }
          />
        </label>
        <label>
          在这些行之前分页{' '}
          <Input
            aria-label="分页行"
            placeholder="例如 20,40；留空自动分页"
            value={breaks}
            disabled={disabled}
            onChange={(e) => setBreaks(e.target.value)}
          />
        </label>
        <label>
          打印方式{' '}
          <Select
            aria-label="打印方式"
            value={settings.mode}
            disabled={disabled}
            style={{ width: 250 }}
            options={[
              { value: 'normal', label: '普通打印' },
              { value: 'overlay', label: '套打（预印表格）' },
            ]}
            onChange={(mode) => setSettings({ ...settings, mode })}
          />
        </label>
        <Checkbox
          checked={settings.showGrid}
          disabled={disabled || settings.mode === 'overlay'}
          onChange={(e) => setSettings({ ...settings, showGrid: e.target.checked })}
        >
          打印默认网格线
        </Checkbox>
        {settings.mode === 'overlay' && (
          <>
            <Alert
              type="info"
              title="套打仅打印数值与计算结果"
              description="文本、标题和网格已在预印纸上，套打不再重复打印；保持原行高列宽，不自动缩放。偏移相对于纸张页边距，请先用普通纸试印确认位置。"
            />
            <label>
              套打横向偏移（毫米）{' '}
              <InputNumber
                aria-label="套打横向偏移"
                value={settings.offsetXmm}
                min={-30}
                max={30}
                disabled={disabled}
                onChange={(offsetXmm) =>
                  offsetXmm !== null && setSettings({ ...settings, offsetXmm })
                }
              />
            </label>
            <label>
              套打纵向偏移（毫米）{' '}
              <InputNumber
                aria-label="套打纵向偏移"
                value={settings.offsetYmm}
                min={-30}
                max={30}
                disabled={disabled}
                onChange={(offsetYmm) =>
                  offsetYmm !== null && setSettings({ ...settings, offsetYmm })
                }
              />
            </label>
          </>
        )}
        <p>
          分页线与重复表头不能穿过合并单元格。取消或关闭窗口不应用这些设置；应用后仍可通过撤销恢复。
        </p>
      </Space>
    </Drawer>
  );
}
