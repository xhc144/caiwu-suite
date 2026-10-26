import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChecksEditor } from '../../web/ChecksEditor';

describe('w_bb_def 审核定义必填反馈', () => {
  it.each([
    ['name', '审核名称不能为空，且最多80字'],
    ['left', '左表达式不能为空，且最多2000字'],
    ['right', '右表达式不能为空，且最多2000字'],
  ])('缺少 %s 时使用中文说明，校验不改草稿', async (key, message) => {
    const onChange = vi.fn();
    render(
      <ChecksEditor
        checks={[{ name: '总额', left: 'A1', right: 'A1', tolerance: '0', [key]: '' }]}
        disabled={false}
        onChange={onChange}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '校验审核语法' }));
    expect(await screen.findByText(`第1项：${message}`)).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });
});
