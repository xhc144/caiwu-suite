import { Alert, Button, Drawer, Input, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { queryClient } from '@caiwu/web-kit';
import { CheckSchema, type ReportTemplate } from '../shared';
import { api } from './api';

export function ChecksEditor({
  checks,
  disabled,
  onChange,
  onClose,
}: {
  checks: ReportTemplate['checks'];
  disabled: boolean;
  onChange(checks: ReportTemplate['checks']): void;
  onClose(): void;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ text: string; valid: boolean; input: string }>();
  const active = useRef(true);
  const latest = useRef({ checks, disabled });
  latest.current = { checks, disabled };
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const validate = async () => {
    if (disabled || running.current) return;
    running.current = true;
    setChecking(true);
    const input = JSON.stringify(checks);
    try {
      const errors: string[] = [];
      for (const [index, check] of checks.entries()) {
        const parsed = CheckSchema.safeParse(check);
        if (!parsed.success) {
          errors.push(`第${index + 1}项：${parsed.error.issues.map((i) => i.message).join('；')}`);
          continue;
        }
        const checked = await Promise.all(
          [check.left, check.right].map((source) =>
            queryClient.fetchQuery(api.validateFormula.queryOptions({ source })),
          ),
        );
        checked.forEach((v, side) => {
          if (!v.valid)
            errors.push(
              `第${index + 1}项「${check.name}」${side === 0 ? '左' : '右'}式：${v.message}`,
            );
        });
      }
      if (
        active.current &&
        !latest.current.disabled &&
        JSON.stringify(latest.current.checks) === input
      )
        setResult({
          input,
          valid: !errors.length,
          text: errors.length
            ? errors.join('；')
            : '审核语法校验通过；单位、差额和实际引用将在生成时校验',
        });
    } catch (e) {
      if (
        active.current &&
        !latest.current.disabled &&
        JSON.stringify(latest.current.checks) === input
      )
        setResult({
          input,
          valid: false,
          text: e instanceof Error ? e.message : '审核语法校验失败，请重试',
        });
    } finally {
      running.current = false;
      if (active.current) setChecking(false);
    }
  };
  return (
    <Drawer getContainer={false} open title="审核公式（勾稽）" size={680} onClose={onClose}>
      <Alert
        type="info"
        title="逐项比较左右表达式；差额绝对值不超过阈值才通过"
        description="左右必须同单位、同币种。金额按分四舍五入后比较，数量/比例保留10位小数；无法计算显示错误。引用与报表使用同一期间、口径和账套快照。"
      />
      {checks.map((check, index) => (
        <fieldset key={index} style={{ marginTop: 16 }}>
          <legend>审核项 {index + 1}</legend>
          <Space orientation="vertical" style={{ display: 'flex' }}>
            {(['name', 'left', 'right', 'tolerance'] as const).map((key) => (
              <label key={key}>
                {
                  {
                    name: '名称',
                    left: '左表达式',
                    right: '右表达式',
                    tolerance: '阈值（金额为分）',
                  }[key]
                }
                <Input
                  aria-label={`审核${index + 1}${{ name: '名称', left: '左表达式', right: '右表达式', tolerance: '阈值' }[key]}`}
                  disabled={disabled}
                  value={check[key]}
                  onChange={(e) =>
                    onChange(
                      checks.map((v, i) => (i === index ? { ...v, [key]: e.target.value } : v)),
                    )
                  }
                />
              </label>
            ))}
            <Button
              disabled={disabled}
              danger
              onClick={() => onChange(checks.filter((_, i) => i !== index))}
            >
              移除此审核项
            </Button>
          </Space>
        </fieldset>
      ))}
      <Space wrap style={{ marginTop: 16 }}>
        <Button
          disabled={disabled || checks.length >= 100}
          onClick={() =>
            onChange([
              ...checks,
              { name: `审核${checks.length + 1}`, left: 'A1', right: 'A1', tolerance: '0' },
            ])
          }
        >
          增加审核项
        </Button>
        <Button
          disabled={disabled || !checks.length || checking}
          aria-busy={checking}
          onClick={() => void validate()}
        >
          校验审核语法
        </Button>
      </Space>
      {result && result.input === JSON.stringify(checks) && (
        <Alert
          style={{ marginTop: 12 }}
          type={result.valid ? 'success' : 'warning'}
          title={result.text}
        />
      )}
      <p>
        关闭抽屉保留修改；使用报表的保存按钮持久化。语法通过不代表勾稽通过，请生成报表查看实际审核结果。
      </p>
    </Drawer>
  );
}
