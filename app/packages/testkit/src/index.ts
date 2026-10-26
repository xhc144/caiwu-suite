// 测试夹具。单测里用：
//   const t = await createTestBook();
//   await seedVouchers(t.svc, [{ date: '2026-01-05', lines: [...], status: 'posted' }]);
//   ...
//   await t.close();
export * from './book';
export * from './vouchers';
export * from './app';
