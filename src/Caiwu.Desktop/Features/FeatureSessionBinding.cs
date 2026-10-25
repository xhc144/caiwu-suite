using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;
using Caiwu.Operators;

namespace Caiwu.Desktop.Features;

/// <summary>Captures displayed data once. Neither validation nor saving obtains replacement tokens.</summary>
public sealed class FeatureSessionBinding
{
    private readonly LedgerSession session;
    private readonly ILedgerService service;
    private readonly long generation;
    public LedgerSnapshot Shown { get; }
    public string DatabasePath { get; }
    public FeatureAuthentication Authentication { get; }
    public bool IsCurrent => Authentication.IsPotentiallyCurrent && session.IsOpen && session.Generation == generation &&
        ReferenceEquals(session.Service, service) && session.Snapshot?.Book.Id == Shown.Book.Id &&
        session.Snapshot.Revision == Shown.Revision;

    public FeatureSessionBinding(LedgerSession session, LedgerSnapshot shown, FeatureAuthentication authentication)
    {
        this.session = session;
        service = session.Service ?? throw new StoreConcurrencyException("账套会话已关闭。");
        Authentication = authentication ?? throw new OperatorAuthorizationException("新功能需要真实操作员登录，不能使用任意姓名。");
        if (service is not AuthorizedLedgerService)
            throw new OperatorAuthorizationException("账套服务尚未接入集中认证，业务动作已禁用。");
        generation = session.Generation;
        Shown = shown;
        DatabasePath = session.DatabasePath ?? throw new StoreConcurrencyException("账套会话已关闭。");
        DemandCurrent();
    }

    public async Task DemandPermissionAsync(OperatorPermission permission)
    {
        await Task.Run(() => Authentication.Demand(permission));
        DemandCurrent();
    }

    public ILedgerService DemandCurrent()
    {
        if (!IsCurrent) throw new StoreConcurrencyException("账套已切换、恢复或重新载入。旧窗口已失效；输入保留，请重新打开核对。");
        return service;
    }
}
