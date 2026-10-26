import type { InventoryService } from '../inventory';
import type { CoreServices } from './services';

/** 注册无状态工厂；每次操作绑定传入的原始 svc，禁止缓存账套或操作员实例。 */
export type InventoryProviderFactory = (svc: CoreServices) => InventoryService;
export interface CoreServiceProviders {
  readonly inventory?: InventoryProviderFactory;
}
