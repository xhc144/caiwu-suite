import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { migrations } from './migrations';
import { masterdataRouter } from './router';

export default defineServerModule(manifest, { router: masterdataRouter, migrations });
