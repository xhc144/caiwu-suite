import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { periodCloseRouter } from './router';
export default defineServerModule(manifest, { router: periodCloseRouter, migrations });
