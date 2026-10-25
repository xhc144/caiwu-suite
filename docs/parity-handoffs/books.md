# books 原版保真切片交接

状态：进行中；2026-10-26 UTC。独立 checkout `/workspace/caiwu-books`；私有分支 `codex/parity-books-20261026`，基线/当前代码 SHA `3b0c59b02d8941c32ac176309555c03c94bb4213`（本文件早期提交前）。

## 所有权与输入

只改 `src/Caiwu.Reporting`、`tests/Caiwu.Reporting.Tests` 及本 handoff；现有 `SmallBusinessStatement*`、`StatementLedger` 不动。共享 Contracts/Core/SQLite/Desktop/解决方案/公共 props/工作流均不动。模块 UI 新建 `src/Caiwu.Reporting/Wpf` 独立项目。

已读原版 README、gap-analysis、轻松账务 zc/zw/菜单/规则、三产品 windows JSON、tables/DataWindow JSON；复核 PR #38 `3ba29a0`、#39 `11a8d77`、#40 `8de73d5`。PR38 暂不换底层的旧前提被本轮用户明确授权覆盖；不等待 PB 工程。PR39 的原库与 schema 保全义务及 PR40 的未知/未验区分继续遵守。不重新解析/运行原安装资源，不使用真实账套。

## 本轮可闭合范围与计划 API

本币总分类账 `w_zc_zc → w_zc_zc_1`、现金日记账 `w_zc_xjrjz → w_zc_xjrjz_1`、银行日记账 `w_zc_yhrjz → w_zc_yhrjz_1`；菜单在原 `日常业务 → 账册`，结果窗 `m_work_zc_01`。条件窗口保留原控件相对位置、科目从/到、原年度/月份/包含未过账位置；总账原提示明确只含过账。

拟新增 `BooksLedgerInput`/`BooksAccount`/`BooksVoucher`/`BooksLine`、`BooksQuery`、`BooksReportBuilder.Build`、`BooksSnapshotAdapter.FromSnapshot`；计算使用输入期初 + 之前月份 + 查询期间，逐笔余额、月计、本年累计及转月守恒。显式现金/银行分类，不按科目编码猜。报表复用现有 CSV/HTML 输出器，凭证ID供联查。WPF 入口接收真实 snapshot/扩展输入，禁止内置生产假数据。

## 公共核心精确扩展建议（由集成者统一处理）

1. 当前 Account 仅有基本科目和期初；扩展需保留原 `kmbm` 的银行/现金/复币/数量/项目/客供/部门/个人/往来标志及完整 parent 关系，不按 1001/1002 前缀猜银行。模块先使用显式分类 DTO。
2. 当前 VoucherLine 缺少原分录行序、结算类别 `jslb`、支票/票据 `pz_ph/pjdh`、辅助 `xmbm/dwbm/bmbm/grbm`、外币/汇率/数量与原始来源键。公共读接口须保留全部，不让简化 adapter 静默成为原账套迁移器。原始字段与变体保全由兼容层承担。
3. 期初需要明确覆盖起点，年中启用时需启用前本年累计借/贷；否则不能把启用后累计冒称本年累计。模块 DTO 将显式接收这两个值。
4. 宿主应按上述原菜单打开模块条件窗，在原 MDI sheet 中承载结果。查看凭证由宿主 callback 按 book ID/revision/voucher ID 路由；修改/删除需共享权限和原状态逆操作，禁止在报告内直接写库。
5. 多年度箭头需带年度的只读账簿 provider；不可把当前年度 snapshot 重贴为上年。原数据库 SQL Anywhere 读取/完整变体兼容由核心/兼容任务处理。

## 验证与未实现项

当前：尚未实现/测试；Linux 可安装 SDK，不代表 Windows UI/原数据验收。后续填写真实命令、返回码、SHA。

本轮后续保留：辅助明细/辅助余额及其各维度期初、辅助多栏/多栏账、外币和数量账、现金流量试算、账龄/费用/合同分析、批量导出、套打/连续打印、格式记忆/恢复、排序、凭证查看/修改/删除完整联动、跨年滚年与原库真实兼容、三产品 Windows DPI/键盘/MDI/实机逐窗口验收。未实现入口不可算通过，不用空壳按钮替代。
