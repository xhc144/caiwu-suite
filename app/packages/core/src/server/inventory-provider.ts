import type {
  InventoryCostingCapability,
  InventorySnapshot,
  InvoiceIssueInput,
  InvoiceIssuePlan,
  InvoiceIssueSaveInput,
} from '../inventory';
import type { ServiceContext } from './context';
import type { CoreServices } from './services';

/** 注册无状态工厂；每次操作绑定传入的原始 svc，禁止缓存账套或操作员实例。 */
export interface InventoryProvider {
  snapshot(period: number): Promise<InventorySnapshot>;
  with<T>(run: (inventory: InventoryCostingCapability) => Promise<T>): Promise<T>;
  /** 可选扩展，旧 provider 不必提供；实现必须复核来源、权限、期间、版本、库存及确认。 */
  previewInvoiceIssue?(input: InvoiceIssueInput): Promise<InvoiceIssuePlan>;
  /** 绑定原始 invoice svc，必须在当前 core 事务中执行，不得伪装成 inventory/costing。 */
  saveInvoiceIssue?(input: InvoiceIssueSaveInput): Promise<{ id: number; revision: number }>;
}
export type InventoryProviderFactory = (svc: CoreServices) => InventoryProvider;
export interface CoreServiceProviders {
  readonly inventory?: InventoryProviderFactory;
  readonly dimensionReferences?: readonly ((
    ctx: ServiceContext,
    id: number,
  ) => Promise<DependencyBlock[]>)[];
  readonly periodDependencies?: readonly ((
    ctx: ServiceContext,
    input: PeriodWriteCheck,
  ) => Promise<DependencyBlock[]>)[];
}

export interface DependencyBlock {
  category: string;
  count: number;
  to?: string;
}
export interface PeriodWriteCheck {
  period: number;
  oldPeriod?: number;
  action?: string;
  mode?: 'business' | 'opening' | 'year-close' | 'year-reopen';
}
