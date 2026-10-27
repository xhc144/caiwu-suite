import type { InventoryService } from '../inventory';
import type { ServiceContext } from './context';
import type { CoreServices } from './services';

/** 注册无状态工厂；每次操作绑定传入的原始 svc，禁止缓存账套或操作员实例。 */
export type InventoryProviderFactory = (svc: CoreServices) => InventoryService;
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
