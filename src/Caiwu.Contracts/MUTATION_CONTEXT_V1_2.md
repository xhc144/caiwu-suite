# 修改来源快照契约 v1.2

2026-10-25：主协调明确将本次来源快照的Contracts+Core变更交给账务领域任务；本增量只涉及数据上下文和Core校验，不改Storage/schema。此文件取代v1.0/v1.1对应的无上下文写入语义。契约提交需与后续Core实现配套集成，单独提交不是已修复声明。

`LedgerMutationContext(Guid ExpectedBookId, long ExpectedRevision)` 两个值必须来自**用户编辑、选择或确认所见数据的同一个LedgerSnapshot**。整个账套的每次写入都使旧revision失效；无关业务的合法写入也可能触发冲突，这是保守策略。上下文不是授权凭据，不能替代操作人/状态校验。

## 调用迁移表

| 原调用 | v1.2调用 | 来源快照绑定 |
|---|---|---|
| `SaveAccount(account, actor)` | `SaveAccount(account, actor, context)` | 新增/编辑科目对话框打开时，包含其科目属性的快照 |
| `DeleteAccount(code, actor)` | `DeleteAccount(code, actor, context)` | 用户所选科目及删除确认依据的快照 |
| `SetOpeningBalances(rows, actor)` | `SetOpeningBalances(rows, actor, context)` | 期初整表开始编辑时的快照；不能点击保存后读取新版本 |
| `DeleteDraft(id, actor)` | `DeleteDraft(id, actor, context)` | 用户所选凭证及删除确认依据的快照 |
| `Review(id, reviewer)` | `Review(id, reviewer, context)` | 审核员实际核对的凭证明细快照 |
| `CancelReview(id, actor)` | `CancelReview(id, actor, context)` | 用户所见的已审核凭证快照 |
| `Post(id, actor)` | `Post(id, actor, context)` | 实际展示的凭证/确认金额来自的快照 |
| `CloseMonth(month, actor)` | `CloseMonth(month, actor, context)` | 用户所见期间/结账确认数据的快照 |
| `SaveDraft(draft, actor)` | 签名不变；新建与修改都必须填`draft.ExpectedBookId`、`draft.ExpectedRevision` | 打开凭证编辑器时的同一快照，包含新建所参考的科目/账套 |

8个新增参数均为 `LedgerMutationContext? context = null`，仅为让旧调用保留可编译及明确错误提示；Core必须拒绝null，**没有兼容写入旁路**。SaveDraft DTO的null默认值同理，v1.2新建也不能省略任一字段。不能另用仅Id/编码或无token重载完成同一次写入。

例如已保存的界面状态 `shownSnapshot` 对应所展示的行，使用 `new LedgerMutationContext(shownSnapshot.Book.Id, shownSnapshot.Revision)`。不提供从service自动读取版本的工厂。不得为通过校验在提交时读取最新snapshot补token、自动刷新token重试、仅更新token而保留旧内容、或吞掉冲突后改走旧接口。界面应保留未保存输入、提示账套版本变化、要求重新加载并核对；账套切换应清空旧选择/编辑上下文。

Core在该命令唯一一次读取的snapshot上先检查：上下文非null、BookId非空且相等、revision非负且相等；不匹配抛 `StoreConcurrencyException`，不追加审计/不写数据。校验通过后继续已有金额、科目、审核分离、状态和期间规则，最后保持一次 `store.Write(next, before.Revision)`，阻断检查后再发生的竞争；不自动重试。

查询/备份/恢复的接口和SQLite存储契约不变。批量审核/记账不能重复复用同一账套revision，也不能临时读新token跳过用户核对；首版UI按单次确认处理，批量语义另行定义。生产UI由Acceptance接线，本任务不改Desktop；已有分发阻断继续保持。
