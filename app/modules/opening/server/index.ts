import { defineServerModule } from '@caiwu/server-kit';
import manifest from '../manifest';
import { openingRouter } from './router';
export default defineServerModule(manifest, { router: openingRouter });
