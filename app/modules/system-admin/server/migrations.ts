import { defineMigrations } from '@caiwu/db';

// 本阶段复用 core 表；不另建用户、权限或日志副本。
export const migrations = defineMigrations([]);
