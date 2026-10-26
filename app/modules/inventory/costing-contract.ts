// 兼容库存模块既有导入；共享契约只有 core 这一份定义。
export {
  CostingCommitSchema,
  CostingCancelSchema,
  VoucherSourceSchema,
  type CostingCommitInput,
  type CostingCancelInput,
  type VoucherSourceInput,
} from '@caiwu/core';
