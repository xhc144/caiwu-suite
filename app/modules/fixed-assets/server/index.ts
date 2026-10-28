import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { fixedAssetsRouter } from './router';
import { assetDepartmentReferences } from './departments';
import { assetPeriodDependencies } from './period-dependencies';
export default defineServerModule(manifest, {
  router: fixedAssetsRouter,
  migrations,
  providers: {
    dimensionReferences: [assetDepartmentReferences],
    periodDependencies: [assetPeriodDependencies],
  },
});
