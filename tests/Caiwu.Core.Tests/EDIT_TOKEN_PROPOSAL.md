# ACC-002 最小兼容接口建议（供Contracts owner决定）

更新：主协调已在 `0d2ae9e379b02c2d86bbd174f56dcd437f910206` 定义 `ExpectedRevision` / `ExpectedBookId` 两个末尾可空参数，后续以根 `docs/contracts-v1.1-draft-edit-token.md` 为准。以下原提案仅保留讨论依据，不要求再新增另一套token DTO。实际独立回归与归属见 `RevisionTokenProbe/README.md`；该SHA的生产Core/UI尚未接线。

2026-10-25，问题已用真实Core和两个SQLite连接重现：B持有金额10的旧凭证，A改成20，B再保存成功覆盖回10。保存时读取fresh revision仅保护单个命令内部，不能表达编辑开始时的版本。此次不自行修改Contracts、UI或SQLite。

建议保持现有构造参数、ILedgerService.SaveDraft签名及落盘Voucher DTO不变，由主协调统一加入一个非位置属性：

```csharp
public sealed record LedgerEditToken(Guid BookId, long Revision);

public sealed record VoucherDraft(Guid? Id, DateOnly Date, string Kind, int? Number,
    int AttachmentCount, IReadOnlyList<VoucherLine> Lines)
{
    public LedgerEditToken? EditToken { get; init; }
}
```

- 编辑器从**同一次GetSnapshot返回的数据**取得凭证与 `(Book.Id, Revision)`，在打开/加载时保存token，之后每次保存原样传递；不能在点击保存时现读revision来补token。
- Core对已有Id的编辑强制要求token。缺失、BookId不符、负revision或revision不等于本次读取快照的revision，均抛StoreConcurrencyException，写入和审计都不发生。
- 使用同一读取快照验证状态/金额/期间并进行一次store.Write CAS；禁止遇到冲突后刷新token自动重试。
- 有token的新建也做相同检查。旧的受信程序新建调用可暂允许Id=null/token=null，保持样本/后台生成路径兼容；真实编辑器新建也应携带打开时的token，防止切账或重复保存误用。
- 保存成功后的已接受revision是本次token.Revision+1。编辑器可据此更新token；若选择重新GetSnapshot，必须同时加载其对应的完整凭证内容，不能只取得更高token却保留旧表单，否则会再次授权覆盖他人的新值。
- 若UI需要服务直接返回token，可另外增加保存结果DTO/重载；不要把运行时编辑token塞进持久化Voucher，避免SQLite接口和历史数据格式改变。根决定是否需要这一可选增强。

此方案按整个账套revision保守判冲突，其他实例修改无关凭证也会要求刷新。这是可解释的MVP取舍。每凭证版本或内容摘要可减少无关冲突，但需另行审定，不建议本次同时扩大。

验收最小集合：两个真实连接各加载同一草稿，A凭其原token改20成功，B用旧token保存10须冲突，落盘仍20；已有Id缺token拒绝；跨账套token拒绝；成功保存后用**已接受版本**再次保存可行；冲突时不增加审计/revision、不修改输入；已审核/记账及锁期限制保持。还需根实际WPF双窗口验收输入保留，不能用后端测试冒充。

状态：**契约字段已由主协调定义，Core/UI强制路径待协调实施**；当前Core分支没有假装修复此项。
