import { defineManifest } from '@caiwu/core';
export default defineManifest({
  id: 'payroll',
  name: '工资',
  products: ['minfei', 'chengben'],
  permissions: [
    ['hr.view', '查看人事档案'],
    ['hr.edit', '维护人事档案及部门'],
    ['salary.view', '查看工资及计税明细'],
    ['salary.edit', '维护工资结构及录入'],
    ['salary.calculate', '计算工资'],
    ['tax.configure', '确认计税参数'],
    ['voucher', '工资凭证'],
    ['close', '工资结账'],
    ['reopen', '工资反结账'],
    ['export', '导出及打印工资'],
  ].map(([id, name]) => ({ id: `payroll.${id}`, name: name! })),
  menu: [
    { group: 'payroll', title: '工资综合查询', path: '/query', permission: 'payroll.salary.view' },
    { group: 'payroll', title: '工资管理', path: '/', permission: 'payroll.salary.view' },
    { group: 'payroll', title: '人事档案', path: '/employees', permission: 'payroll.hr.view' },
    {
      group: 'payroll',
      title: '工资结构与公式',
      path: '/structure',
      permission: 'payroll.salary.edit',
    },
    { group: 'payroll', title: '工资报表', path: '/reports', permission: 'payroll.salary.view' },
    { group: 'payroll', title: '计税参数', path: '/tax', permission: 'payroll.tax.configure' },
  ],
  sources: [{ type: 'batch', name: '工资批次', path: '/batch?id={id}' }],
});
