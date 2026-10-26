import { defineMigrations } from '@caiwu/db';

// 格式通过 core.settings 按模块隔离持久化，不建立重复账表。
export const migrations = defineMigrations([]);
