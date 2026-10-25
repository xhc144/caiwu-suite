# 私人测试候选清单：0.1.0.4

这是一套**有限功能的私人测试版本**，不是三套原软件的完全复刻，也没有财务合规认证结论。**root已完成最终独审，接受该精确字节供合成账套私人试用，可由root交付给用户。** 这是root的工程验收决定，不代表用户接受缩减目标，也不代表原任务全部完成、正式账务或正式发布获批。本任务不另行用户上传，不发布Release、不合main。

## 来源与制品

- 普通生产 builder 的实际构建源：`9549ae0671e04d9c7fa565cfb34d614fa3effc0b`，干净源码、显式受管 capability、固定依赖锁；没有重命名或复用内部安装器。
- 主产品树：`714a5a79ecb11c0c08ced48841d4e9aa54785212`；Delivery 组合源码树：`454dba0d36468fcb2b139678f202d3e14b9b6e0e`。
- [真实 Windows 构建及三组验收 run40196386649](https://github.com/xhc144/caiwu-suite/actions/runs/40196386649)，job121178010155，success。
- [私有 artifact12599758441](https://github.com/xhc144/caiwu-suite/actions/runs/40196386649/artifacts/12599758441)：490768016 bytes，GitHub digest `b626617a5e8a4c627652540d4ea8651159baecb394a1e658e5d7ba2bdcd59d5b`。root已独立核对整包、EXE、866freeze条目、两版各448payload文件、三组原始JSON及真实截图。本checkout为避免重复大文件传输，仅取30,512,759字节的有界Range证据并核对成员CRC/报告哈希；不冒称由本checkout再次整包重哈希。

以下为该实际构建的release-manifest数值，已由root与制品实字节独立核对；沿用原名、原字节，不重建、不改写：

| 用途 | 实际文件 | bytes | SHA256 |
| --- | --- | ---: | --- |
| 初装/升级对照测试版本 | `caiwu-0.1.0.3-win-x64-setup.exe` | 132286557 | `9889eee915f2cd398f9ed92e473ebca08cd8764e017b6b5ee17e9466cc8fdeb1` |
| 私人测试候选 | `caiwu-0.1.0.4-win-x64-setup.exe` | 132284835 | `9248d0363c639caeada84810959d0a8a885d8c1c45cdc7677476b0a4476bcf0b` |

0.1.0.4 的 payload 清单 SHA256 为 `af0857501597cbb71f032b154fd5770e6cd4534cc3161f715c4d2b60cb0ac279`，包含448个文件；原始清单及全部文件 hash 已保存。`caiwu-0.1.0.4-win-x64-payload.zip` 为229115621 bytes、SHA256 `bdcd5e4c3265c50fe95bcfaaeb8fae13a37d837a3658362c405377203617df91`，只用于核对 payload，**不是免安装便携应用或便携恢复包**。0.1.0.3不是另一个待分发版本。

工具链为 SDK10.0.402/runtime10.0.13、win-x64、自包含、hash-pinned NSIS3.13。安装器未签名，更新 disabled，无可信生产自动更新 feed；hash 不建立发布者签名信任。清单中的 `approvedForUserDelivery=false` 保留；构建清单的 `windowsRuntimeValidated=false` 是生成时状态，实际运行证据见独立结果，不手改构建记录冒充验收。

## 实际验证范围

| 范围 | 此源实际结果 |
| --- | --- |
| 每个版本组件回归 | 各166项：162 passed、0 failed、4明确平台 skip；两次均实际运行，未用 --skip-tests |
| 原生生命周期 | 初装、正常登录/独立审核记账、F10取消/接受、实际恢复目标双重深回读、两OS租约、忙态拒升级、正常升级、升级后登录、未知文件及28个观测数据文件卸载保留、跨新根安全拒绝均通过 |
| 金融业务 | 4 case通过：成本250→254、保存登记重开；实验民非110/10预览及错误清空/禁导出；Designer公式保存重开；5个附件跨4 codec实际App备份/恢复逐文件hash/version及完整快照相等，身份不变 |
| BookFlows | 声明的13 case均通过：复制凭证两阶段取消、执行/重复点击、重复编号；摘要管理、真实选择/取消/当前行回填/显式保存重开、无重新设焦点的原生继续键入及Enter、只读拒绝；账套复制/重复目标/来源hash；实际完整恢复、物理摘要隔离；真实可见余额123.45；实际会话撤销拒绝；独立已安装helper读回及卸载保留 |

主原生升级fixture登记摘要；金融5附件/4codec完整恢复是同源候选的另一独立fixture，不能合称同一5附件样本全部模块原生升级链已经实跑。

金融分类语义是**合成 seed 预设**，UI只修改复核依据，不称人工逐项新建完整分类已验。成本21/63分配逐格断言、按准确AccountCode核完整EvidenceReference、报表110/10精确行列自动绑定未在本轮增强；这是验收精度限制，不是已发现产品失败。成本原生图最右分配列有横向裁切，不作为21/63完整可见证据。

原“模态期间并发修改 ledger revision”**未实跑**：真实独占租约及owned modal下无受支持入口，未绕租约写SQLite。另已实跑受支持管理员API撤销既有合成操作员，确认选择器和原草稿保存拒绝、原输入/ledger revision6保留。原场景明确保留为 `unexecutedScenarios: not-run`，root明确判定：实际会话撤销与原场景不称等价、不称原场景已跑；该边界不阻断合成账套私人测试，仍阻断“所有场景/正式账务验收”宣称。

## 中文说明与原始截图

[安装与使用](../docs/user-guide/INSTALL_AND_USE.zh-CN.md) 与该源随包说明一致；受管启动、无默认密码、角色/独立审核、备份/身份分离、升级及卸载限制均有说明。实际说明位于 payload 的 `delivery-notices/INSTALL_AND_USE.zh-CN.md`。

48张原始PNG均为1920×1080。精选7张已按原字节保存并逐张目视，不生成、不放大、不裁图；[截图hash/尺寸/说明](evidence/final-private/accepted-9549ae0/selected-evidence-verification.json)：

- [真实余额页123.45](evidence/final-private/accepted-9549ae0/screenshots/trial-balance-confirmed-native.png)
- [摘要回填后继续原生输入及Enter](evidence/final-private/accepted-9549ae0/screenshots/summary-native-continuation.png)
- [会话撤销：摘要未回填、原输入保留](evidence/final-private/accepted-9549ae0/screenshots/expired-summary-confirmation-rejected.png)
- [成本结果254](evidence/final-private/accepted-9549ae0/screenshots/cost-allocation.png)
- [实验民非余额预览110](evidence/final-private/accepted-9549ae0/screenshots/nonprofit-balance.png)
- [实验民非捐赠收入10](evidence/final-private/accepted-9549ae0/screenshots/nonprofit-activity.png)
- [有限设计器模板重开及1002计算值10](evidence/final-private/accepted-9549ae0/screenshots/designer-reopened.png)

## 未完成能力与交付决定

未签名；无可信自动更新源；跨机/跨新数据根 portable 恢复或导入重映射未支持，原备份及收据须保留原路径。民非账务只读、禁止新建；成本不自动记账；设计器有限；无原软件账套/旧身份自动迁移、年结滚年、生产原地schema迁移或断电恢复完成声明。主界面没有身份备份/恢复按钮。物理键盘/IME、多DPI/多屏、真实打印/PDF及全部模块异常组合没有整套验收结论。

root已根据精确实字节、全部原始报告/截图及上述未运行范围作出有限私人测试的工程验收决定。原始EXE和manifest不修改；其中构建时的approvedForUserDelivery=false作为历史生成状态保留，本段单独记录后续范围决定，不能推导正式发布。仍不合main、不公开、不发布Release、不改权限/签名/更新设置；原资源及完整派生资料上传继续暂停。未完成能力没有因本次决定消失，用户并未据此接受缩减原目标。
