import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { fixedAssetsRouter } from './router';
export default defineServerModule(manifest, { router: fixedAssetsRouter, migrations });
