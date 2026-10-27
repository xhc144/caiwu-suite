import { Alert, Button, Input, Modal, Space } from 'antd';
import { useState } from 'react';
import { formatMoney } from '@caiwu/core';
import { calculateMoney } from '../calculator';

export default function CalculatorDialog({
  onClose,
  onApply,
  target,
}: {
  onClose: () => void;
  onApply?: (cents: number) => void;
  target?: string;
}) {
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState('');
  const change = (value: string) => {
    setExpression(value);
    setResult(null);
    setError('');
  };
  const compute = () => {
    try {
      setResult(calculateMoney(expression));
      setError('');
    } catch {
      setResult(null);
      setError('算式无效、除数为零或金额超出范围，请核对。');
    }
  };
  return (
    <Modal
      title="简易计算器（F9）"
      open
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>返回</Button>
          {onApply && (
            <Button
              type="primary"
              disabled={result == null}
              onClick={() => {
                if (result != null) onApply(result);
              }}
            >
              填入{target}
            </Button>
          )}
        </Space>
      }
    >
      <p>支持 + − × ÷ 和括号，输入使用 + - * /。结果四舍五入到分。</p>
      <Input
        aria-label="计算器算式"
        value={expression}
        maxLength={200}
        autoFocus
        onChange={(e) => change(e.target.value)}
        onPressEnter={compute}
      />
      <Space wrap style={{ marginTop: 12 }}>
        {['7', '8', '9', '+', '4', '5', '6', '-', '1', '2', '3', '*', '0', '.', '/', '(', ')'].map(
          (key) => (
            <Button key={key} onClick={() => change(expression + key)}>
              {key}
            </Button>
          ),
        )}
        <Button onClick={() => change(expression ? `-(${expression})` : '-')}>正负</Button>
        <Button onClick={() => change('')}>清除</Button>
        <Button onClick={compute}>计算（Enter）</Button>
      </Space>
      <p role="status">计算结果：{result == null ? '—' : formatMoney(result)}</p>
      {error && <Alert type="error" title={error} />}
    </Modal>
  );
}
