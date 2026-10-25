using Caiwu.Operators;

namespace Caiwu.Desktop.Features;

/// <summary>One fixed, service-issued login object. Never consults a mutable current-login getter or UI name.</summary>
public sealed class FeatureAuthentication(LocalOperatorService operators, OperatorSession session)
{
    private int invalid, checking;
    private long nextCheckTicks;
    public LocalOperatorService Operators { get; } = operators ?? throw new ArgumentNullException(nameof(operators));
    public OperatorSession Session { get; } = session ?? throw new ArgumentNullException(nameof(session));
    public string ActorKey => Session.Identity.ActorKey;
    public bool IsPotentiallyCurrent => Volatile.Read(ref invalid) == 0 && Session.ExpiresAt > DateTimeOffset.UtcNow;

    // Call on workers. The central ledger decorator still performs the final authorization around Core.
    public OperatorIdentity Demand(OperatorPermission permission)
    {
        if (!IsPotentiallyCurrent) throw new OperatorAuthorizationException("原操作员会话已失效，请重新登录并打开窗口。");
        return Operators.RequirePermission(Session, permission);
    }

    public async Task CheckAsync()
    {
        if (!IsPotentiallyCurrent || DateTime.UtcNow.Ticks < Volatile.Read(ref nextCheckTicks) ||
            Interlocked.CompareExchange(ref checking, 1, 0) != 0) return;
        try
        {
            await Task.Run(() => Demand(OperatorPermission.ReadLedger));
        }
        catch (OperatorException) { Volatile.Write(ref invalid, 1); }
        finally
        {
            Volatile.Write(ref nextCheckTicks, DateTime.UtcNow.AddSeconds(1).Ticks);
            Volatile.Write(ref checking, 0);
        }
    }
}
