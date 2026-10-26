// 检查最终包，而非开发机的 node_modules。原生 ABI 还须由安装后启动回归验证。
module.exports = async (context) => {
  const { existsSync, readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const resources = path.join(context.appOutDir, 'resources');
  const archive = readFileSync(path.join(resources, 'app.asar'));
  const jsonLength = archive.readUInt32LE(12);
  if (jsonLength > 16 * 1024 * 1024 || jsonLength + 16 > archive.length) {
    throw new Error('安装包 ASAR 目录无效');
  }
  const tree = JSON.parse(archive.subarray(16, 16 + jsonLength).toString('utf8'));
  const entry = (name) => name.split('/').reduce((node, part) => node?.files?.[part], tree);
  for (const name of [
    'dist/main.cjs',
    'dist/preload.cjs',
    'dist/server.cjs',
    'package.json',
    'node_modules/better-sqlite3/lib/database.js',
    'node_modules/bindings/bindings.js',
  ]) {
    if (!entry(name)) throw new Error(`安装包缺少 ${name}`);
  }
  const native = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
  if (!entry(native)?.unpacked || !existsSync(path.join(resources, 'app.asar.unpacked', native))) {
    throw new Error('安装包缺少解包的 SQLite 原生模块');
  }
  if (!existsSync(path.join(resources, 'web/index.html'))) throw new Error('安装包缺少 web dist');
  console.log('桌面安装内容检查通过：main / preload / server / web / SQLite（ABI 待启动验证）');
};
