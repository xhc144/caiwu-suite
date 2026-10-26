import { moduleApi } from '@caiwu/web-kit';
import type { BooksRouter } from '../server/router';
export const api = moduleApi<BooksRouter>('books');
