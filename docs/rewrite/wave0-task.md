# 任务 W0：新版地基（caiwu-suite 重做 · Wave 0）

## 你在做什么

这个仓库要把一套老财务软件用现代技术重做。原版是 PowerBuilder 9 写的润衡财务软件，有三个产品：轻松会计、民非企会计、成本会计。原版已经被静态反编译成结构化文档，放在 `docs/original-analysis/`，里面有菜单、窗口（控件、数据列、按钮动作）、业务规则（约 6000 条提示语和触发条件）、220 张表的结构。新版要覆盖原版的全部功能，同时把难用的地方改好。

这个任务只做**地基**。地基合并后，大约 20 个 Codex 任务会**同时**在上面开发各业务模块，它们互相看不到对方的改动。所以地基只有一个目标：**每个模块只改自己的目录，就能完成数据表、接口、页面、菜单注册和测试**。新增模块不需要改任何共享文件。

先读：
- `docs/original-analysis/README.md`
- `docs/original-analysis/gap-analysis.md`
- `docs/original-analysis/data/tables.md`：重点看 kmbm、pz、pzdj、pzlx、xmk、dwk、bmk、grk，以及外币、期初相关的表
- `docs/original-analysis/products/qingsong/main/menus.md`

不要读，也不要改：`src/`、`tests/`、`packaging/`、`packaging-next/`、`docs/acceptance/`、`.ai-handoff/`。这些是旧的 C#/WPF 实验版和它的流程文件，已经冻结。

## 技术栈（已经定了，不要换，也不要讨论）

- TypeScript strict，pnpm workspace，Node 用当前 LTS
- 前端：React + Vite + Ant Design（zh_CN 语言包）+ TanStack Query + React Router
- 本地服务：Fastify + tRPC + zod。只监听 127.0.0.1，用随机端口加启动令牌
- 数据库：SQLite（better-sqlite3）+ Kysely，迁移用纯 SQL 文件，一个账套一个 .db 文件
- 桌面：Electron 壳 + electron-builder（NSIS）。Electron 只负责启动本地服务和打开窗口。better-sqlite3 要为 Electron 重新编译
- 测试：Vitest（领域逻辑和接口）、Playwright（对 web 版跑 E2E，Linux 上能跑）、fast-check（会计不变量）
- 金额：用整数"分"存储和计算，禁止用浮点数运算金额。汇率、单价、数量用 decimal.js，以字符串存储
- 导出用 exceljs，打印用 HTML/CSS 模板

## 目录（按这个建）

```
app/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint/prettier 配置
  apps/server/      Fastify + tRPC，自动挂载各模块的 router
  apps/web/         React 壳：布局、导航、标签页、路由，自动挂载各模块的页面
  apps/desktop/     Electron 壳
  packages/core/    领域类型、校验、核心服务、核心迁移
  packages/db/      数据库连接、迁移运行器、事务、测试用临时库
  packages/ui/      通用组件
  packages/print/   打印接口和最简实现
  packages/testkit/ 测试夹具和帮助函数
  modules/example/  示范模块，所有模块照着它写
  modules/<id>/     业务模块，由后续任务创建
```

## 必须交付

1. **一条命令验收**：`cd app && pnpm install && pnpm check` 全绿。`check` 包括 typecheck、lint、单测和 E2E。另外提供 `pnpm dev`（启动本地服务和网页，浏览器里能打开使用）和 `pnpm desktop`（启动 Electron，Linux 上能构建就行）。

2. **核心数据模型和核心表**。代码在 `packages/core`，迁移在 `packages/core/migrations/`。参照原版表结构设计，但命名用清楚的英文，加中文注释。要一次设计完整，后面的模块直接在上面开发：
   - 账套信息；会计期间（年、月、状态：未结或已结）；产品形态（轻松 / 民非企 / 成本）
   - 科目：编码、名称、级次、上级、类别（资产、负债、共同、权益、成本、损益、净资产等，随会计制度变化）、余额方向、是否末级、是否停用。**级次规则可配置**，例如 4-3-3、4-2-2。标志位：现金、银行、外币（币种）、数量（单位）、现金流量、往来，以及启用了哪些辅助核算
   - 辅助核算做成**通用维度**（维度类型表 + 维度项表）。内置五种：项目、客户/供应商（客供）、部门、个人、现金流量项目。科目上配置启用哪些维度，以及是否必填
   - 凭证类型（记、收、付、转等，可配置）、结算方式、外币与汇率、摘要库
   - 凭证头：凭证类型、期间、编号、日期、附单据数、制单人、审核人、过账人及各自时间、状态（草稿 / 待审核 / 已审核 / 已过账）、作废标记、红冲关联、**来源模块和来源单据 ID**
   - 分录：行号、摘要、科目、各维度项、币种、汇率、外币金额、数量、单价、借方、贷方、结算方式、票号、业务日期
   - 期初余额：按"科目 × 维度组合 × 币种"记录期初余额、本年累计借方、本年累计贷方、外币、数量
   - 用户（简单版：编号、姓名、密码哈希、是否启用）和操作日志
   - 会计制度模板的 schema（用 zod 定义）：科目表、默认凭证类型、报表模板引用。后续任务按这个格式写各会计制度的数据。**模板自动发现**：任何 `modules/*/templates/*.json` 都识别为会计制度模板

3. **核心服务**。模块之间不互相 import，只通过 core 交互：
   - 凭证接口：createVoucher、updateVoucher、deleteVoucher（只允许草稿和待审核状态）、getVoucher、listVouchers（带过滤）
   - 保存凭证时校验：借贷平衡；科目是末级且未停用；必填维度已填；期间未结账；外币科目有币种和汇率；数量科目有数量。由某个模块生成的凭证，只有该模块能修改或删除
   - 查询：queryEntries（按期间、科目范围、维度、状态过滤）；queryBalances（参数：期间范围、科目范围、维度、币种、是否含未过账），返回期初、借方、贷方、期末，以及外币和数量
   - 读取科目、维度、期间状态；写操作日志；服务端权限检查钩子（先给一个"全部允许"的实现）
   - 审核、过账、结账这些状态流转**不在这里实现**，由后续模块实现。core 只提供状态字段、统一的状态变更入口和校验钩子

4. **模块机制**：每个模块在 `modules/<id>/module.ts` 里声明：
   - id、名称、属于哪些产品形态
   - 菜单项：分组、标题、路由、快捷键、权限点
   - 服务端 router、前端页面（懒加载）
   - 可选：来源单据链接（用户在凭证上点"来源"时跳到哪里）、全局搜索提供者

   页面路由统一挂在 `/m/<模块id>/` 下。服务端和前端都要**自动发现**模块：前端用 `import.meta.glob`，服务端在运行时扫描或用生成文件。生成的注册文件必须加入 gitignore，并在 dev、test、build 之前自动生成。迁移运行器自动发现 `packages/core/migrations` 和 `modules/*/migrations`，执行顺序是：core 先执行，然后按模块 id，再按序号；执行过的要记录下来。

5. **前端壳**（`apps/web`）：
   - 左侧导航，由模块菜单自动生成，按产品形态过滤
   - 多标签页，可以同时开多个功能
   - 顶部显示当前账套、期间和用户
   - 统一的错误和提示方式
   - 快捷键注册机制：模块在 module.ts 里声明快捷键

6. **通用组件**（`packages/ui`）：
   - 金额输入和显示：千分位，负数显示红字
   - 科目选择器：按编码、名称、拼音首字母模糊搜索，可配置成只能选末级
   - 维度项选择器、期间选择器
   - 数据表格：虚拟滚动，列宽可拖动并记住，一键导出 Excel
   - 页面顶部筛选栏、确认框
   - 带操作按钮的提示，例如"有 3 张凭证未过账 [查看] [去过账]"

7. **打印**（`packages/print`）：定义打印接口（输入数据和模板，输出 HTML），给一个最简实现（浏览器打印）。完善工作由后续任务做。

8. **测试夹具**（`packages/testkit`）：
   - `createTestBook()`：建一个临时测试账套，带常用企业科目、几个辅助档案、外币科目和数量科目
   - `seedVouchers()`：可以指定制单人和状态（草稿 / 已审核 / 已过账）。后续模块是并行开发的，测试要用它造前置数据，不能依赖其它模块的页面
   - tRPC 测试客户端
   - Playwright 帮助函数：启动服务、打开页面、选择账套

9. **示范模块** `modules/example`：做一个真正能用的小功能，比如"常用备注"，覆盖迁移、router、页面、单测、E2E，全部走模块机制。把它标记为只在开发模式显示，不进正式导航。它是后面所有任务照抄的样板，写清楚。

10. **AGENTS.md**（仓库根目录）：写入下面的「全局规则」原文，再加上命令说明、目录说明、"如何新建一个模块"的步骤（以 example 为例）、core 服务 API 一览、模块路由约定。

11. **CI**：`.github/workflows/app-ci.yml`，在 ubuntu 上运行，PR 和 main 都跑 `pnpm check`，只在 `app/**` 或 `AGENTS.md` 变化时触发。其它旧 workflow 不要动。

12. **Codex 云环境配置**：在 `app/CODEX_SETUP.md` 写出 setup script，内容是：启用 corepack/pnpm、`pnpm install --frozen-lockfile`、`pnpm exec playwright install --with-deps chromium`。

13. **预装依赖**：云端任务执行时通常没有网络，所以把后续模块大概率会用到的依赖现在一次装好并锁定，例如 decimal.js、dayjs、zod、exceljs、pinyin-pro、fast-check、@tanstack/react-virtual、react-hook-form。后续并行任务原则上不再加依赖。

## 全局规则（原文写进 AGENTS.md）

1. 新代码只放在 `app/`。不读也不改 `src/`、`tests/`、`packaging/`、`packaging-next/`、`docs/acceptance/`、`.ai-handoff/`（这些是已冻结的旧 C#/WPF 实验版）。
2. 每个任务只改自己"拥有的目录"。`app/apps/*` 和 `app/packages/*` 是共享层，模块任务不许改。需要改共享层时，写进 PR 描述的「需要的共享改动」，先在自己的模块里临时实现。
3. 不加新依赖。如果确实必须加，在 PR 描述里写明，因为它会改锁文件，容易冲突。
4. 数据库：模块的表放在 `modules/<id>/migrations/`，表名用模块前缀。需要给核心表加字段时，只能在自己模块里新增迁移（ALTER TABLE ADD COLUMN），不许改已有的迁移文件。
5. 模块只通过 `packages/core` 的服务交互，不 import 其它模块的代码。要跳转到别的模块，用路由 `/m/<模块id>/...`。要生成凭证，就调用 core 的 createVoucher，并填上来源模块和来源单据 ID。
6. 模块注册只写在自己的 `module.ts` 里，不改任何共享注册文件。
7. 原版资料 `docs/original-analysis/` 用来对照功能和业务规则。做一个功能之前，先查它在原版里的菜单项、窗口（控件、数据列、按钮动作）、规则（提示语和触发条件）以及读写的表。不复制原版的图标、图片和代码。界面按现代桌面软件设计，不模仿原版的老样式。
8. 用户能看到的文字全部用中文。提示要说清**为什么**和**下一步怎么做**，能给按钮就给按钮。不要照抄原版生硬的提示语，但触发条件要保留。
9. 金额用整数"分"，禁止用浮点数运算金额。汇率、单价、数量用 decimal.js。
10. 测试要求：原版 rules.md 里本模块的每条阻止或确认规则，至少有一个单测，测试名里写原版窗口名；主流程有 Playwright E2E；记账相关的不变量（借贷平衡、试算平衡、操作后再撤销能回到原状）用 fast-check 测。
11. 完成标准只有一个：`cd app && pnpm check` 全绿。
12. 不写证据文档、交接文档、验收报告、SHA 清单、状态汇报，也不写"已验收""符合制度"这类结论。每个模块只有一个简短的 README，内容是功能清单和未完成项。
13. 做不完的时候：先让主流程完整可用，剩下的列进 PR 描述的「未实现」。不要只交设计文档，也不要停在半路等确认。
14. PR 标题格式是 `[任务ID] 模块名`。PR 描述分四段：已实现（对照原版的窗口和菜单项）、未实现、需要的共享改动、手动试用步骤。

## 完成标准

- `cd app && pnpm install && pnpm check` 全绿，CI 也是绿的
- 运行 `pnpm dev` 后，在浏览器里能完成：新建测试账套、在示范模块里增删改、看到左侧导航和标签页
- 新建一个模块只需要复制 `modules/example` 再改名。不改任何共享文件，它就能出现在导航里，表能建出来，测试能跑。写一个测试证明这一点：在测试里临时生成一个模块目录，验证它被自动发现
- PR 描述按全局规则第 14 条写，另外列出 core 服务 API 一览，以及后续模块需要知道的约定
