# AGENTS.md — caiwu-suite 新版开发指南

这个仓库正在用现代技术重做一套老财务软件。原版是 PowerBuilder 9 写的润衡财务软件，有三个产品：轻松会计、民非企会计、成本会计。新版代码全部在 `app/` 下，TypeScript 全栈。会有很多个任务同时在这里开发，**每个任务只改自己拥有的目录**。

开始任何任务前，先读完本文件。

## 一条命令验收

```sh
cd app
pnpm install
pnpm check      # = typecheck + lint（含架构边界检查）+ prettier + 单测 + E2E，必须全绿
```

| 常用命令 | 作用 |
|---|---|
| `pnpm test` | 单测（Vitest）。`*.test.ts` 跑在 Node，`*.test.tsx` 跑在 jsdom |
| `pnpm e2e` | 构建网页 + Playwright E2E（真实本地服务 + 临时数据目录） |
| `pnpm fix` | 自动格式化 + 修 lint |
| `pnpm dev` | 开发模式：本地服务（自动重启）+ vite，打开 http://localhost:5173 |
| `pnpm exec vitest run modules/example` | 只跑某个目录的单测 |
| `pnpm exec playwright test modules/example` | 只跑某个模块的 E2E |

本机 Chromium 不在 Playwright 默认位置时，设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。Codex 云环境的配置见 `app/CODEX_SETUP.md`。

## 技术栈（已定，不要换）

- 前端：React 19 + Ant Design 6（中文）+ TanStack Query + React Router 8
- 本地服务：Fastify 5 + tRPC 11 + zod 4，只监听 127.0.0.1，带启动令牌
- 数据库：SQLite（better-sqlite3）+ Kysely。一个账套一个 `.caiwu` 文件
- 桌面：Electron 壳（`apps/desktop`）+ electron-builder（NSIS）
- 测试：Vitest、Testing Library、Playwright、fast-check
- TypeScript 6（strict、noUncheckedIndexedAccess），pnpm workspace

## 目录

```
app/
  apps/server/        本地服务（Fastify + tRPC），自动挂载所有模块
  apps/web/           前端壳：登录、导航、多标签页（shell/），自动发现所有模块的页面
  apps/desktop/       Electron 壳
  packages/core/      领域核心。src/*.ts 前后端共用（金额、期间、凭证类型、清单格式……）
                      src/server/ 只给服务端：核心表迁移、核心服务、账套存储
  packages/db/        SQLite 连接、迁移执行、事务
  packages/server-kit/ 服务端框架：tRPC 过程、登录会话、权限检查、模块登记
  packages/web-kit/   前端框架：接口客户端、登录状态、错误提示、标签页、快捷键
  packages/ui/        通用组件：金额输入、科目选择、数据表格、筛选栏……
  packages/print/     打印接口（最简实现）
  packages/testkit/   测试夹具：测试账套、造凭证、E2E 登录
  modules/<id>/       业务模块，一个目录一个模块（示范：modules/example）
  scripts/            生成模块注册表、边界检查、dev 启动
```

旧的 C#/WPF 实验版在仓库根目录的 `src/`、`tests/`、`packaging*/`，已冻结，**不读也不改**；`docs/acceptance/`、`.ai-handoff/` 同理。

## 全局规则

1. 新代码只放在 `app/`。不读也不改 `src/`、`tests/`、`packaging/`、`packaging-next/`、`docs/acceptance/`、`.ai-handoff/`。
2. **只改任务指定给你的目录**。`app/apps/*`、`app/packages/*` 是共享层，模块任务不许改。需要共享层改动时，写进 PR 描述的「需要的共享改动」，先在自己模块里临时实现。
3. **不加新依赖**。云端执行时通常没有网络，而且改锁文件会和别的任务冲突。常用库都已经装好：decimal.js、dayjs、zod、exceljs、pinyin-pro、echarts、fast-check、@tanstack/react-virtual。确实必须加依赖时，在 PR 描述里写明。
4. 模块是普通目录，**没有 package.json**。依赖从 `app/package.json` 解析，所以新建模块不会改 `pnpm-lock.yaml`。
5. 模块之间**不许互相 import**（边界检查会拦）。模块之间只通过两种方式交互：调用 core 服务（`ctx.svc`），以及页面跳转（路由 `/m/<模块id>/...`）。
6. 数据库：
   - 模块的表定义在 `modules/<id>/server/migrations.ts`，表名必须以模块 id 为前缀（`voucher-entry` 的前缀是 `voucher_entry_`），登记时会检查。
   - 已发布的迁移不能改（会校验内容）。要加字段，就新增一条迁移。
   - 需要给核心表加字段，也写在自己模块的新迁移里（`ALTER TABLE ... ADD COLUMN`）。
   - **凭证表、分录表只能通过 `ctx.svc.vouchers.*` 写**。其它核心表可以直接用 `ctx.svc.db` 读写。
7. 所有修改数据的接口（mutation）必须声明权限：`.meta({ permission: '<模块id>.xxx' })`。权限点要在 manifest 里声明，启动时会检查。
8. 金额一律用整数"分"（`Cents`），禁止用浮点数运算金额。汇率、单价用 `decimal.js` 字符串。数量在接口上用十进制字符串，在库里存 `_e6` 整数。
9. 用户能看到的文字全部用中文。出错时 `throw new BusinessError({ code, message, hint, actions })`：message 说清**为什么**，hint 说清**下一步怎么做**，能跳转的地方给 actions 按钮。
10. 原版资料 `docs/original-analysis/` 用来对照功能和规则：做一个功能前，先查它在原版里的菜单项（`menus.md`）、窗口（`windows/*.md`）、规则（`rules.md`）和表（`data/tables.md`）。原版的触发条件要保留，提示语要重写得更清楚。不复制原版的图标、图片和代码，界面按现代软件设计。
11. 测试要求：
    - `rules.md` 里本模块的每条阻止或确认规则，至少有一个单测，测试名里写原版窗口名
    - 主流程有 Playwright E2E
    - 记账相关的不变量用 fast-check 测
12. 完成标准只有一个：`cd app && pnpm check` 全绿。
13. 不写证据文档、交接文档、验收报告、SHA 清单、状态汇报，也不写"已验收""符合制度"这类结论。每个模块只有一个简短的 `README.md`，内容是功能清单（对照原版窗口）和未完成项。
14. 做不完的时候：先让主流程完整可用，剩下的列进 PR 描述的「未实现」。不要只交设计文档，也不要停在半路等确认。
15. PR 标题格式是 `[任务ID] 模块名`。PR 描述分四段：已实现（对照原版窗口和菜单项）/ 未实现 / 需要的共享改动 / 手动试用步骤。

## 新建一个模块（照 `modules/example` 抄）

```
modules/<id>/
  manifest.ts          模块清单（必需）：id = 目录名、名称、产品形态、权限点、菜单、来源单据
  shared.ts            前后端共用的 zod 输入格式和类型（只能 import zod、@caiwu/core）
  server/
    index.ts           defineServerModule(manifest, { router, migrations, templates? })
    router.ts          接口：const m = moduleKit(manifest); export const xxxRouter = m.router({...})
    service.ts         业务逻辑（便于单测），入参是 ctx.svc
    migrations.ts      defineMigrations([...]) + 表的 Kysely 类型（用 type，不要用 interface）
  web/
    index.tsx          defineWebModule(manifest, { routes: [{ path, title, component: lazy(...) }] })
    api.ts             export const api = moduleApi<XxxRouter>('<id>')
    XxxPage.tsx        页面
  test/*.test.ts       单测（createTestApp / createTestBook）
  e2e/*.spec.ts        Playwright（loginWithNewBook）
  README.md            功能清单 + 未完成项
```

只要建好目录，服务端（`pnpm gen` 会自动跑）和前端（`import.meta.glob`）都会自动发现它：菜单出现在导航里，表在打开账套时自动建好。**不需要改任何共享文件。**

要点：

- **菜单分组**只能用 `MENU_GROUPS` 里的固定分组：voucher 凭证、ledger 账簿、report 报表、period 期末处理、cashier 出纳、invoice 发票、payroll 工资、asset 固定资产、inventory 进销存、costing 成本、analysis 财务分析、master 基础档案、system 系统。
- **产品形态**：`products: 'all'` 或 `['qingsong','minfei','chengben']` 的子集。
  - 轻松 = 账务 + 出纳 + 发票
  - 民非企 = 账务 + 工资 + 固定资产 + 出纳
  - 成本 = 全部
- **页面路由**：模块内路径 `/xxx`，实际地址是 `/m/<id>/xxx`。地址里的查询参数用 `useUrlFilters` 读写，别的模块可以带着条件跳过来。
- **入口页面**：要替换壳自带的账套选择页、登录页、首页时，在 manifest 写 `entryPages: ['bookPicker' | 'login' | 'home']`，并在 `defineWebModule` 里提供对应组件。分工是：账套管理提供 bookPicker，系统管理提供 login，工作台提供 home。
- **会计制度模板**：模块在 `defineServerModule({ templates: [json] })` 里提供，格式见 `packages/core/src/template.ts`（`AccountingTemplateSchema`）。
- **生成凭证**：调用 `ctx.svc.vouchers.create({ ..., source: { type, id } })`，并在 manifest `sources` 里声明来源单据的跳转地址。这样生成的凭证归你的模块管，别处不能改、不能删，凭证上能点"查看来源"。

## 核心服务速查（服务端 `ctx.svc`）

router 里的 `ctx.svc` 已经绑定当前账套、当前操作员和当前模块。

| 调用 | 作用 |
|---|---|
| `svc.vouchers.create(input)` | 新增凭证。正式保存会完整校验并分配编号，状态为待审核；`draft: true` 存草稿 |
| `svc.vouchers.update(id, input, { expectedRevision })` | 修改（只能改草稿或待审核的凭证，乐观锁） |
| `svc.vouchers.delete(id)` / `setVoided(id, bool)` / `setNumbers([...])` | 删除 / 作废 / 改编号（断号整理） |
| `svc.vouchers.changeStatus({ ids, to })` | 审核、取消审核、过账、反过账的唯一入口。全部成功或全部不变。"制单人不能审核"这类业务规则由调用方先检查 |
| `svc.vouchers.get(id)` / `list(filter)` | 读取 |
| `svc.ledger.balances(query)` | 余额：期初、借、贷、期末、本年累计、外币、数量；可按辅助核算展开、按币种过滤、汇总到上级 |
| `svc.ledger.entries(filter)` | 分录明细（明细账、日记账用） |
| `svc.ledger.trialBalance(from, to)` | 试算平衡 |
| `svc.opening.list(year)` / `upsert(...)` / `replaceYear(year, rows)` | 期初余额（年结时用 replaceYear 写新年度的年初数） |
| `svc.accounts.list()` / `get` / `getByCode` / `require` / `create(input, scheme)` / `categories()` | 科目 |
| `svc.dimensions.items(type)` / `get` / `getByCode` / `create` | 辅助核算项（项目、客供、部门、个人、现金流量项目） |
| `svc.periods.list()` / `current()` / `require(p)` / `assertOpen(p, action)` / `setStatus(p, s)` / `ensureYear(y)` | 会计期间 |
| `svc.reference.voucherTypes()` / `currencies()` / `exchangeRate(c, p)` / `settlementMethods()` / `summaries()` | 基础资料 |
| `svc.settings.get(key, fallback)` / `set(key, value)` | 本模块的账套级参数（自动按模块隔离） |
| `svc.log.write({ action, summary, ... })` | 操作日志 |
| `svc.permissions.has(p)` / `require(p)` | 权限 |
| `svc.users.*` | 操作员（最小实现） |
| `svc.tx(async (svc2) => {...})` | 事务。**回调里只能用传进来的 svc2**，用外面的 svc 会报错（否则会卡死） |
| `svc.inventory.snapshot(period)` / `svc.tx(t => t.inventory.with(async i => { ... }))` | 真实库存快照及事务能力；`i.commitCosting`/`cancelCosting`、`lockVoucherSource`/`releaseVoucherSource`。释放同时删除未审核凭证，调用方不得预删。单据写入用 `i.saveDocument`/`removeDocument`；能力不得逃逸回调 |
| `svc.periods.assertWritable({ period, oldPeriod?, mode, action })` / `dependencies(input)` | 普通业务、期初、年结、逆年结分别用 `business/opening/year-close/year-reopen`；写事务内复检启用、月结、年结及期初锁。宿主通过 `providers.periodDependencies` 注册模块依赖，阻止项含处理入口 |
| `svc.voucherPolicy.get()` / `set({numbering,renumberAfterDelete,allowModifyOthers})` | 全账套共享凭证策略；修改须管理员，策略和日志同事务。手工编号必须提供正整数，草稿不占号 |
| `svc.vouchers.previewDelete(ids)` / `deleteBatch(plan, true)` | 删除与重排先预览，再明确确认；正式事务复核完整影响集合、来源、制单人及版本 |
| `svc.dimensions.update(id,input,{expectedRevision})` / `setDisabled` / `references` / `previewDelete` / `delete(plan,true)` | 稳定档案ID、层级与引用检查、确认删除及日志同事务；宿主通过 `providers.dimensionReferences` 注册工资、资产等模块引用 |
| `svc.ledger.cashflow(filter)` / `balanceSides(query)` / `quantityBalances({...query,quantityUnit})` | 现金流方向、未分配差额及逐凭证内部配平；末级辅助对象借贷余额分列；数量按单位查询。启用前外币/数量累计缺来源时返回空值和原因 |
| `VoucherLineInput.entrySide` / `cashflowDirection` | 零本币但非零外币/数量分录须明确借贷侧；现金流为 `inflow/outflow/internal/null`，历史空方向不推断；`normalizeRows` 保留原编辑行号并忽略真正空行 |
| `runtime.bookStore.prepareReplacement({bookId,bytes,length,sha256,expectedRevision,expiresAt})` | 校验并迁移受管恢复暂存，`expectedRevision` 由 `revision(bookId)` 取得；随后 `lifecycle.maintainBook` 用 `kind:'replace',replacementId` 执行。目标管理员须在 `authorize` 复核口令和确认文字；完整保护备份保留，替换失败回滚，成功重新登录 |
| `useUnsavedChanges({title,dirty,version,save,discard})`（web-kit） | 按当前账套和标签注册；内容版本变化使旧离开确认失效。关闭、关闭所有、同标签路由离开和切账统一异步保存；保留标签间切换不确认 |
| `useRequestActivity()` / `useSubmission()`（web-kit） | 请求超过300ms显示加载，并发/取消/失败归零；提交使用 `submit(async()=>...)` 合并重复点击；服务端继续执行完整校验 |
| `mapTemplateScheme(template, scheme)` | 从模板原生级次逐段映射新账套科目编码，保留父链、备抵、余额性质及来源版本，不改写已有账套 |
| `svc.db.withTables<MyTables>()` | 访问本模块的表（Kysely） |

约定：余额一律"借正贷负"，显示时用 `balanceSide(value, direction)` 换算；期间是 `yyyymm` 整数；日期是 `'YYYY-MM-DD'` 字符串。

## 前端速查

- 接口：`useQuery(api.xxx.list.queryOptions(input))`、`useMutation(api.xxx.save.mutationOptions())`。核心接口用 `coreApi.*`。写操作失败会自动弹出业务提示，不需要自己 catch。
- 基础资料 hooks：`useAccounts()`、`useDimensionItems(type)`、`usePeriods()`、`useCurrentPeriod()`、`useVoucherTypes()`、`useSession()`、`usePermission(p)`。
- 组件（`@caiwu/ui`）：
  - `MoneyInput` / `MoneyText`：金额输入和显示
  - `AccountSelect`：编码、名称、拼音首字母模糊搜索
  - `DimensionSelect`、`PeriodPicker`、`PeriodRangePicker`
  - `DataTable`：金额列、可拖列宽并记住、导出 Excel、虚拟滚动
  - `FilterBar` + `useUrlFilters`：页面顶部筛选栏
  - `PageContainer`
  - `ActionAlert`：带操作按钮的提示
  - `useDangerConfirm`：危险操作要输入文字确认
- 标签页：`usePageTitle('凭证 记-0012')` 改标签标题；`useHotkey('Ctrl+S', fn)` 只在当前标签页可见时生效。
- 打印：`printHtml({ title, html })`（`@caiwu/print`）。

## 测试怎么写

```ts
// 服务端：真实账套 + 登录 + 权限，直接调本模块接口
const app = await createTestApp({ modules: [myServer] });
const api = app.call(myServer);                       // 管理员
const clerk = app.call(myServer, await app.addUser('lr', { permissions: ['my.view'] }));
await seedVouchers(app.svc, [{ date: '2026-01-05', status: 'posted', lines: [{ account: '1001', debit: 100_00 }, { account: '6001', credit: 100_00 }] }]);

// 只测 core 服务
const t = await createTestBook();      // t.svc、t.forModule('cashier')、t.addUser(...)
```

- 测试账套用演示科目表（`packages/core/templates/demo.json`，科目级次 4-2-2），预置了辅助档案：部门 01/02、客供 C001/S001、个人 P01、项目 XM01、现金流量 CF01/CF02，以及美元汇率 7.1。
- 需要前置数据（例如已审核的凭证）时，用 `seedVouchers` 直接造，**不要依赖其它模块的页面或接口**（它们可能还没合并）。
- E2E：`const { bookId } = await loginWithNewBook(page, request)` 建一个独立账套（带演示数据）并登录。之后 `page.goto('/m/<id>/...')`。

## 常见坑

- Kysely 表类型要用 `type X = {...}`，不能用 `interface`（否则 `withTables` 报类型错）。
- 事务里只能用 `svc.tx` 回调传入的 svc。
- antd 6 改了一些属性名：
  - Space `direction` → `orientation`；Alert/Notification `message` → `title`
  - Modal/Drawer `destroyOnClose` → `destroyOnHidden`
  - `Input.Group` → `Space.Compact`；Select 的搜索配置写在 `showSearch={{ filterOption }}` 里
- antd 的 Select 下拉选项在 E2E 里不要用 `getByRole('option')` 点（它会选中给读屏用的隐藏节点），改成输入后按 `Enter` 选第一个。
- 按钮文字不会自动插空格（已全局关闭），所以 `getByRole('button', { name: '保存' })` 可以直接用。
- 示范模块 `example` 只在开发模式显示（`devOnly`），正式产品里看不到。

## 原版资料怎么查

- 功能地图：`docs/original-analysis/README.md`
- 新旧差距：`docs/original-analysis/gap-analysis.md`
- 每个子系统都有一个目录（`products/<产品>/<子系统>/`），里面有：
  - `menus.md`：菜单和快捷键
  - `windows/*.md`：窗口的控件、数据列、按钮动作、读写的表
  - `rules.md`：提示语和触发条件
  - `navigation.md`：启动流程和工作台
- 子系统对应的目录：
  - 账务：`products/qingsong/main`
  - 出纳：`products/qingsong/cn`
  - 发票：`products/qingsong/fp`
  - 工资、固定资产：`products/minfeiqi/main/windows/gz.md`、`zcgl.md`、`zjgl.md`
  - 仓库、成本：`products/chengben/main/windows/ck.md`、`cb.md`
- 表结构和 44 个会计制度模板：`docs/original-analysis/data/tables.md`
- 官方制度原文：`rules/sources/official/`
