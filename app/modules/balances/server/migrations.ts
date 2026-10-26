import { defineMigrations } from '@caiwu/db';

// 业务余额由 core 管理；展示设置使用框架隔离的 settings，不另建缓存表。
export const migrations = defineMigrations([]);
