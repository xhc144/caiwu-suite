import { moduleApi } from '@caiwu/web-kit';
import type { ExampleRouter } from '../server/router';

// 本模块接口的类型来自自己的 router（只 import type，不会把服务端代码打包进前端）。
export const api = moduleApi<ExampleRouter>('example');
