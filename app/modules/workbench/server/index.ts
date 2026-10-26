import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { workbenchRouter } from './router';
export default defineServerModule(manifest, { router: workbenchRouter, migrations });
