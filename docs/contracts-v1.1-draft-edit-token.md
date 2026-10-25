# 草稿修改并发契约 v1.1

P1修复，仅由主集成维护Contracts；不改SQLite schema、不引入民非维度功能。

`VoucherDraft`新增最后两个可空参数 `long? ExpectedRevision = null, Guid? ExpectedBookId = null`，旧的新建调用源码仍可编译。

- **修改已存在草稿（Id非空）时token必填。** token必须来自用户开始编辑时取得的同一份LedgerSnapshot，不能保存时再读取新revision替代。
- Core在读取当前snapshot后、任何业务修改/Write之前，检查两个token存在且分别等于该snapshot.Revision与snapshot.Book.Id；否则抛StoreConcurrencyException，原快照和审计不变。同revision但不同账套必须拒绝。
- 检查后原有store.Write(expectedRevision=current.Revision)仍须执行原子CAS。检查与Write之间另一实例提交时，同样不能覆盖。
- 新建草稿Id为空时两个token可空；若提供任一token也分别进行匹配检查。无token的新建仍由原有CAS保护追加和编号。
- Desktop打开现有凭证时重新取得**同一个snapshot中的凭证及revision**；编辑窗口保留该token直到保存，传入ExpectedRevision。失败保留输入，不更新token后盲重试，不悄悄改写新版本。

Core owner负责强制规则及内核回归，Desktop owner负责取同一快照、传token、保留输入和提示；Storage owner的原子CAS不变。这个窄改动不宣称已解决所有账户/期初编辑的长期多人协作版本问题。
