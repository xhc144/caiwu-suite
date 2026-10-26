import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { useAdminConfirm } from '../web/confirm';

function Harness({ text, onResult }: { text: string; onResult: (value: boolean) => void }) {
  const [confirm, holder] = useAdminConfirm();
  return (
    <>
      {holder}
      <button
        onClick={async () =>
          onResult(
            await confirm({
              title: '操作确认',
              content: '该操作会影响当前账套数据或未保存内容。',
              confirmText: text,
            }),
          )
        }
      >
        开始操作
      </button>
    </>
  );
}
afterEach(cleanup);

describe('原窗口确认与取消保护', () => {
  it.each([
    ['w_xt_users / w_grant', 'm17clerk'],
    ['w_login_1', '切换用户'],
    ['w_xt_dlxx 恢复格式', '恢复默认'],
    ['w_xt_dlxx 扩大导出范围', '导出日志'],
    ['w_users 未保存退出', '放弃修改'],
    ['w_xt_kgzb_1 / _2 / _3 放弃初始化', '放弃初始化'],
  ])('%s 未输入或文字错误均不能确认，取消不执行', async (_window, text) => {
    const result = vi.fn();
    render(
      <ConfigProvider button={{ autoInsertSpace: false }}>
        <Harness text={text!} onResult={result} />
      </ConfigProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '开始操作' }));
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    const confirm = within(dialog).getByRole('button', { name: '确定' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('确认文字'), { target: { value: '错误确认' } });
    expect(confirm).toBeDisabled();
    fireEvent.keyDown(within(dialog).getByLabelText('确认文字'), {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
    });
    expect(result).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(result).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('w_grant / w_pass 目标文字匹配后支持键盘确认，只执行一次', async () => {
    const result = vi.fn();
    render(
      <ConfigProvider button={{ autoInsertSpace: false }}>
        <Harness text="目标用户" onResult={result} />
      </ConfigProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '开始操作' }));
    const input = await screen.findByLabelText('确认文字');
    fireEvent.change(input, { target: { value: '目标用户' } });
    expect(screen.getByRole('button', { name: '确定' })).toBeEnabled();
    await userEvent.type(input, '{Enter}');
    expect(result).toHaveBeenCalledExactlyOnceWith(true);
  });
});
