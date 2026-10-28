import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Descriptions, Form, Input, Modal, Space } from 'antd';
import { PageContainer, PeriodPicker } from '@caiwu/ui';
import { queryClient, useRequiredSession } from '@caiwu/web-kit';
import { api } from './api';

type Preview = {
  hash: string;
  expiresAt: number;
  bookName: string;
  originalStartPeriod: number;
  counts: {
    categories: number;
    employees: number;
    batches: number;
    rows: number;
    quantities: number;
    corrections: number;
  };
  retained: { categories: number; employees: number; batches: number; rows: number };
};
export default function InitializationDrawer() {
  const session = useRequiredSession();
  const [startPeriod, setStartPeriod] = useState(session.book.startPeriod);
  const [preserveData, setPreserveData] = useState(false);
  const [keepArchives, setKeepArchives] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [plan, setPlan] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ backup: { id: number }; startPeriod: number } | null>(
    null,
  );
  const inFlight = useRef(false);
  const preview = useMutation(api.previewInitialization.mutationOptions());
  const initialize = useMutation(api.applyInitialization.mutationOptions());
  const locked = preview.isPending || initialize.isPending;
  const resetPlan = () => {
    setPlan(null);
    setConfirmation('');
  };
  const previewImpact = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    resetPlan();
    try {
      setPlan(await preview.mutateAsync({ startPeriod, preserveData, keepArchives, password }));
    } catch {
      /* 业务错误由页面保留，输入不清空。 */
    } finally {
      inFlight.current = false;
    }
  };
  const apply = async () => {
    if (!plan || confirmation !== '初始化工资' || inFlight.current) return;
    inFlight.current = true;
    try {
      const saved = await initialize.mutateAsync({
        startPeriod,
        preserveData,
        keepArchives,
        password,
        hash: plan.hash,
        expiresAt: plan.expiresAt,
        confirmed: true,
        confirmation,
      });
      setResult(saved);
      setPassword('');
      resetPlan();
      await queryClient.invalidateQueries({ queryKey: api.pathKey() });
    } catch {
      /* 保存失败保留预览与输入，允许核对后重新预览。 */
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <PageContainer title="工资系统初始化">
      <Alert
        type="warning"
        showIcon
        title="初始化会清除所选工资数据，请先核对影响范围。"
        description="操作前会保存完整工资模块保护副本，并实际回装、重读核验。副本只包含工资模块；账务凭证、科目及其他模块数据保持原样。已有工资来源凭证或已结账月份须先处理。"
      />
      <p>
        <Link to="/m/payroll/transfer">查看工资模块保护副本及恢复</Link>
      </p>
      {!session.user.isAdmin ? (
        <Alert type="error" title="工资初始化仅限当前账套管理员操作。" />
      ) : (
        <>
          <Form layout="vertical" onFinish={() => void previewImpact()}>
            <Form.Item label="工资新启用期间">
              <PeriodPicker
                aria-label="工资新启用期间"
                value={startPeriod}
                disabled={locked}
                onChange={(period) => {
                  setStartPeriod(period);
                  resetPlan();
                }}
              />
            </Form.Item>
            <Form.Item>
              <Checkbox
                checked={preserveData}
                disabled={locked}
                onChange={(event) => {
                  setPreserveData(event.target.checked);
                  resetPlan();
                }}
              >
                保留原启用期间及以后的全部工资和档案
              </Checkbox>
              <p>
                保留原工资历史及累计计税来源；新启用期间以前的批次须先完成计算，此后仅供查询和累计。
              </p>
              <Checkbox
                checked={keepArchives || preserveData}
                disabled={locked || preserveData}
                onChange={(event) => {
                  setKeepArchives(event.target.checked);
                  resetPlan();
                }}
              >
                保留人事档案、工资结构、公式及设置
              </Checkbox>
            </Form.Item>
            <Form.Item label="当前管理员完整密码" required>
              <Input.Password
                aria-label="当前管理员完整密码"
                autoComplete="current-password"
                value={password}
                disabled={locked}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Form.Item>
            {preview.error && <Alert type="error" title={preview.error.message} />}
            <Button
              aria-label="预览初始化影响"
              htmlType="submit"
              loading={preview.isPending}
              disabled={!password || locked}
            >
              预览初始化影响
            </Button>
          </Form>
          {result && (
            <Alert
              type="success"
              title={`工资模块初始化完成，启用期间 ${result.startPeriod}，保护副本 ${result.backup.id} 已保留。`}
              action={<Link to="/m/payroll/transfer">核对或恢复保护副本</Link>}
            />
          )}
          <Modal
            open={!!plan}
            title="确认工资模块初始化"
            onCancel={() => {
              if (!locked) resetPlan();
            }}
            footer={null}
            destroyOnHidden
          >
            {plan && (
              <>
                <Descriptions
                  column={1}
                  items={[
                    { key: 'book', label: '目标账套', children: plan.bookName },
                    { key: 'old', label: '原工资启用期间', children: plan.originalStartPeriod },
                    { key: 'new', label: '新工资启用期间', children: startPeriod },
                    {
                      key: 'batch',
                      label: '工资批次',
                      children: `现有 ${plan.counts.batches} 批，保留 ${plan.retained.batches} 批，删除 ${plan.counts.batches - plan.retained.batches} 批`,
                    },
                    {
                      key: 'rows',
                      label: '工资人员行',
                      children: `现有 ${plan.counts.rows} 行，保留 ${plan.retained.rows} 行`,
                    },
                    {
                      key: 'employees',
                      label: '人事档案',
                      children: `现有 ${plan.counts.employees} 人，保留 ${plan.retained.employees} 人`,
                    },
                    {
                      key: 'categories',
                      label: '工资结构',
                      children: `现有 ${plan.counts.categories} 类，保留 ${plan.retained.categories} 类`,
                    },
                  ]}
                />
                <Alert
                  type="warning"
                  title="确认后先建立可核验工资模块保护副本，再执行初始化；失败时整笔回滚。"
                />
                <Form.Item label="输入“初始化工资”确认">
                  <Input
                    aria-label="初始化确认文字"
                    value={confirmation}
                    disabled={locked}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </Form.Item>
                {initialize.error && <Alert type="error" title={initialize.error.message} />}
                <Space>
                  <Button onClick={resetPlan} disabled={locked}>
                    取消初始化
                  </Button>
                  <Button
                    danger
                    type="primary"
                    loading={initialize.isPending}
                    disabled={locked || confirmation !== '初始化工资'}
                    onClick={() => void apply()}
                  >
                    确认初始化工资
                  </Button>
                </Space>
              </>
            )}
          </Modal>
        </>
      )}
    </PageContainer>
  );
}
