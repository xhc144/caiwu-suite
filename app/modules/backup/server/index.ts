import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { backupRouter } from './router';
export default defineServerModule(manifest, { router: backupRouter, migrations });
