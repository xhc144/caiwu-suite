# 开发用功能验收矩阵

本表更新于 2026-10-25，面向私有交付评审。生产基线为 PR30 head `2707a72ffe1b73fed715517802e6ad62e48fe611`，其最近实测安装包的代码源是 `dece298946d03ad88c5031eb02dab8f87c330046`。之后的交接文档提交没有成为旧安装包的二进制来源。用户操作说明见 [安装与使用](INSTALL_AND_USE.zh-CN.md)。

`DELIVERY_PAUSED.md` 仍在。最终生产路径的审查、生产构建、安装业务 QA 集成和最终包验收尚未完成；内部安装器没有转为用户版。本轮从 [PR33 的原文档](https://github.com/xhc144/caiwu-suite/blob/4460fec7a9d3e07162a66bae2b2f69415d8ad73a/docs/user-guide/ACCEPTANCE_MATRIX.md) 更新过时状态，保留组件与安装产品的区别。

root 已接受原五项 P1 及 dece298 的 F10/实际恢复目标深回读，具体见 [分项门禁记录](../acceptance/final-private-review-gates.md)。生产构建改动、余额页可见性/新截图和其余安装业务仍按下表审查；这次接受没有授权删除 marker 或生成最终包。

## 按实际操作分层

| 功能 | 已有组件证据 | 已安装产品证据：dece298 | 尚未支持或仍待验 |
| --- | --- | --- | --- |
| 原生安装、受管启动、依赖 | 自包含 helper 与四类 codec 的 Windows 组合检查通过 | 当前用户 NSIS、中文及空格路径、非源码工作目录、安装 EXE/runtime/SQLite 来源、两 OS 租约通过 | 最终生产 builder 组合需重新构建、安装复验；不能改内部文件名替代 |
| 首次设置、显式登录 | Operators 组件的首次设置、取消、错误密码、会话失效通过 | 用合成身份 API 预建账号后，实际产品错误密码拒绝和正常 UI 登录通过 | 首次管理员设置 UI 完整链不能由预建账号测试认证 |
| 操作员、角色、改密/停用 | Operators 组件真实 WPF/Core/SQLite 权限、改密/停用失效通过 | 固定可信 Actor、正常切换账号、不同制单/审核身份通过 | 安装产品管理账号/改密/停用全链未由该 fixture 执行 |
| 新账套、科目、期初 | 核心及旧窗口基线有证据 | 实际新建对话框、中文/空格物理路径和受管登记通过 | 当前安装产品科目与期初全部编辑异常链仍须专项 QA |
| 草稿、独立审核、记账、余额 | 核心及组件真实 SQLite 业务链通过 | 保存一张平衡草稿、另账号审核/记账、123.45 余额独立深回读、完整持久快照通过 | 旧截图仍是凭证页，不证明余额页可见；由 InstalledBookFlowsQA 补实际可见性及新图；不扩展为全部编辑、删除、结账、异常及制度覆盖 |
| F4/F7/Ctrl+S/F10 | 较早原生 F4 焦点探针、组件保存链 | 原生 plain F10：取消无新收据、接受生成备份；独立菜单备份通过 | 凭证格、凭证列表、期初页全部快捷键上下文及 IME 未全面覆盖 |
| 复制凭证 | V：真实组件计划、保存、取消、陈旧令牌拒绝通过 | 仅有相关模块入口范围；未宣称执行保存新草稿 | 等待 InstalledBookFlowsQA 的源 SHA、运行及业务回读 |
| 常用摘要 | V：真实 JSON/窗口冲突、锁、查询保护通过 | 实际初始化；登记摘要随完整备份恢复，key/codec/文件 hash/原生内容及版本一致 | 安装产品全部摘要编辑/错误链待专项 QA |
| 复制账套 | V/V2：两种结构化范围、余额、源不变、同目标竞争、小屏修复通过；`49b194e…` 已在 PR30 | 打开窗口，复制取消；未执行所有复制范围 | 等待 InstalledBookFlowsQA；不复制实际附件或全局身份，不能作为完整备份 |
| 成本工作表 | Q：真实编辑、JSON 复算、尾差、取消/错误保护通过 | 打开入口；没有执行整条录入、复算、保存登记链 | 等待 InstalledFinancialQA；不自动生成总账凭证或记账 |
| 民非分类与两表 | Q：明确分类、合成 SQLite、来源失效保护通过 | 企业账套的民非专用入口保持禁用 | 安装产品民非业务全链待 InstalledFinancialQA；民非主账务只读、禁止新建 |
| 有限报表设计器 | Q：列、公式、模板冲突、导出及截断保护通过 | 窗口入口范围；未执行完整编辑/保存/导出链 | 等待 InstalledFinancialQA；不承诺自由画布、法定财报、打印/PDF 或所有 DPI |
| 完整备份与恢复 | W：四类原生附件 codec、全局身份隔离通过 | 真正恢复目标的 BookId/revision/完整语义 SHA、凭证及余额、完整登记摘要集合均相等；已安装 helper 二次独立回读通过 | 已安装 fixture 仅登记摘要；四附件组件通过不等于安装产品全部业务执行 |
| 跨新数据根恢复 | 安全路径和可信收据边界保留 | 原目录不可用时，原字节 bundle+receipt 搬至新根被安全拒绝，无活账套发布、身份不变 | **不支持便携导入/跨根重映射**；原备份目录及数据根须保留原路径 |
| 忙态、升级、卸载 | helper 原生 codec 预备份与保护通过 | 打开恢复账套时拒绝升级；空闲正常升级；升级后登录打开通过；卸载保留所观察的 28 个账套/附件/备份/收据/身份文件及一个未知程序根文件 | 28 是该合成 fixture 的实际文件数；不外推断电、任意旧版、未知 schema 或任意数据集合 |
| 更新与信任 | HTTPS/白名单/有界下载、签名门槛有组件证据 | 更新关闭、未签名内部候选被既有 Authenticode 门槛拒绝 | 未签名、无可信生产自动更新源；无自动安装闭环，不更改信任来制造通过 |

## 固定来源

- **PR30 安装证据 I：**代码 `dece298946d03ad88c5031eb02dab8f87c330046`，[原生安装 run40191539507](https://github.com/xhc144/caiwu-suite/actions/runs/40191539507)；[实际安装结果](../../packaging-next/evidence/release-candidate/native-dece298-pass.json)、[产品运行断言](../../packaging-next/evidence/release-candidate/installed-runtime-dece298.json)、[恢复目标独立读回](../../packaging-next/evidence/release-candidate/restored-readback-dece298.json)。本轮只核对其源绑定、已有 JSON 与成功状态，没有把它登记为本轮新安装实测。
- **W：**同源 [准备 run40191539456](https://github.com/xhc144/caiwu-suite/actions/runs/40191539456)，干净源 locked 发布、真实 helper 子进程与四附件/身份组件；不生成安装器。[PR30 交接](../../packaging-next/RELEASE_CANDIDATE_HANDOFF.md) 记录精确范围及旧失败。
- **O：**Operators 源 `739b8dacda9187466a6c3907fe5d9de21ec714c7`，[run40187405947](https://github.com/xhc144/caiwu-suite/actions/runs/40187405947)。
- **V/V2：**复制/摘要组件源 `e83aa9ab0ea16975b718f3ff21e34c8e4941b4d7`，[run40188069024](https://github.com/xhc144/caiwu-suite/actions/runs/40188069024)；BookTools 小屏修复 `49b194ee3fe86a514aade8c6808f160d219f9d8c`，探针源 `083727a0697182cd0831040f6298e42d92761089`，[run40189370810](https://github.com/xhc144/caiwu-suite/actions/runs/40189370810)。
- **Q：**财务组件源 `6db23d198b2215ec5a1e91fed0e3c62824ac2493`，[run40188184523](https://github.com/xhc144/caiwu-suite/actions/runs/40188184523)。三项 WPF 修复已在 PR30；组件结果不认证安装宿主。
- **历史失败：**`64cc066…` 安装部分结果为失败；`1c216da…` 的绿色旧结果未独立读取真正恢复目标；`6f56a67…` 的旧 Feature 宿主失败。它们仍在 PR30 记录中，最终恢复结论仅引用后来的 dece298 深回读，未删除或重新标成通过。

## 最终组合验收

两路安装业务 QA 目录 `tests/InstalledFinancialQA`、`tests/InstalledBookFlowsQA` 及各自 workflow 由其 owner 写入；等待根回传审核后的 SHA 才集成。本分支不改它们目录。新增普通生产路径在 [最终重建方案](../../packaging-next/FINAL_PRIVATE_DELIVERY_PLAN.md) 中，仍受独审暂停约束。

放行后须冻结**新的最终完整 SHA**、产品版本、每个安装包与 payload 清单的文件长度/SHA256、真实 Windows run/artifact、逐项业务报告和原始 PNG，再更新本表。构建成功不等于最终运行验收；hash 不等于发布者签名。`DELIVERY_PAUSED.md` 仅由指定独审接受旧 P1 及新增证据、明确放行后移除。
