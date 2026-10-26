import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { costingRouter } from './router';

export default defineServerModule(manifest, { router: costingRouter, migrations });
