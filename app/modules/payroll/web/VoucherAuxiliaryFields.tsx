import { Button, Form, Select, Space, Typography } from 'antd';
import { DIMENSION_TYPES } from '@caiwu/core';
import { AccountSelect, DimensionSelect } from '@caiwu/ui';
import type { Employee } from '../shared';

export default function VoucherAuxiliaryFields({
  employees,
  onChange,
}: {
  employees: Employee[];
  onChange: () => void;
}) {
  return (
    <>
      <Typography.Title level={5}>凭证辅助核算</Typography.Title>
      <p>
        按科目配置项目、客供、个人等档案。指定人员的设置完整覆盖该科目的通用设置；未填写的部门取工资快照，其它项取科目默认档案。须填写科目要求的全部辅助核算。
      </p>
      <Form.List name="auxiliaries">
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name, ...rest }) => (
              <div key={key} style={{ border: '1px solid #ddd', padding: 12, marginBottom: 12 }}>
                <Space wrap align="start">
                  <Form.Item
                    {...rest}
                    name={[name, 'accountId']}
                    label={`辅助核算科目${name + 1}`}
                    rules={[{ required: true }]}
                  >
                    <AccountSelect style={{ width: 260 }} />
                  </Form.Item>
                  <Form.Item
                    {...rest}
                    name={[name, 'employeeId']}
                    label={`适用工资人员${name + 1}（留空为全部）`}
                  >
                    <Select
                      allowClear
                      showSearch={{ optionFilterProp: 'label' }}
                      style={{ width: 240 }}
                      options={employees.map((e) => ({
                        value: e.id,
                        label: `${e.code} ${e.name}`,
                      }))}
                    />
                  </Form.Item>
                  {DIMENSION_TYPES.map((type) => (
                    <Form.Item
                      key={type.id}
                      {...rest}
                      name={[name, 'values', type.id]}
                      label={`${type.name}${name + 1}`}
                    >
                      <DimensionSelect type={type.id} allowClear style={{ width: 180 }} />
                    </Form.Item>
                  ))}
                  <Button
                    danger
                    onClick={() => {
                      remove(name);
                      onChange();
                    }}
                  >
                    删除辅助设置
                  </Button>
                </Space>
              </div>
            ))}
            <Button
              onClick={() => {
                add({ values: {} });
                onChange();
              }}
            >
              增加辅助核算设置
            </Button>
          </>
        )}
      </Form.List>
    </>
  );
}
