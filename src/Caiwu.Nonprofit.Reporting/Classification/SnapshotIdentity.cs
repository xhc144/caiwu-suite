using System.Security.Cryptography;
using System.Text.Json;
using Caiwu.Contracts;

namespace Caiwu.Nonprofit.Reporting;

public static class SnapshotIdentity
{
    public static SnapshotBinding Binding(LedgerSnapshot snapshot)
    {
        ValidateSnapshot(snapshot);
        var canonical = new { snapshot.Revision, snapshot.Book,
            Accounts = snapshot.Accounts.OrderBy(a => a.Code, StringComparer.Ordinal),
            Vouchers = snapshot.Vouchers.OrderBy(v => v.Id), AuditEvents = snapshot.AuditEvents.OrderBy(a => a.Id) };
        return new(snapshot.Book.Id, snapshot.Revision, Hash(canonical));
    }
    public static string AccountHash(Account account) => Hash(account);
    public static VoucherLineReference LineReference(Voucher voucher, int lineIndex)
    {
        if (lineIndex < 0 || lineIndex >= voucher.Lines.Count) throw new ArgumentOutOfRangeException(nameof(lineIndex));
        return new(voucher.Id, lineIndex, Hash(new { voucher.Id, voucher.Date, voucher.Kind, voucher.Number, voucher.Status,
            LineIndex = lineIndex, Line = voucher.Lines[lineIndex] }));
    }
    public static IReadOnlyList<Account> Leaves(LedgerSnapshot snapshot)
    {
        var parents = snapshot.Accounts.Where(a => a.ParentCode is not null).Select(a => a.ParentCode).ToHashSet(StringComparer.Ordinal);
        return Array.AsReadOnly(snapshot.Accounts.Where(a => !parents.Contains(a.Code)).OrderBy(a => a.Code, StringComparer.Ordinal).ToArray());
    }
    internal static Guid EntryId(VoucherLineReference source, string scope = "line") => new(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { source, scope })).AsSpan(0,16));
    internal static string Hash<T>(T value) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    internal static LedgerSnapshot Freeze(LedgerSnapshot source) => source with
    {
        Accounts = Array.AsReadOnly(source.Accounts.ToArray()),
        Vouchers = Array.AsReadOnly(source.Vouchers.Select(v => v with { Lines = Array.AsReadOnly(v.Lines.ToArray()) }).ToArray()),
        AuditEvents = Array.AsReadOnly(source.AuditEvents.ToArray())
    };
    internal static void ValidateSnapshot(LedgerSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.Book is null || snapshot.Book.Id == Guid.Empty || snapshot.Book.Regime != AccountingRegime.Nonprofit ||
            snapshot.Revision < 0 || snapshot.Book.FiscalYear < 2026 || snapshot.Book.StartMonth is < 1 or > 12 ||
            snapshot.Accounts is null || snapshot.Vouchers is null || snapshot.AuditEvents is null)
            throw new ArgumentException("须提供2026年起民非账套的真实完整快照。");
        if (snapshot.Accounts.Any(a => a is null || string.IsNullOrWhiteSpace(a.Code)) || snapshot.Accounts.Select(a=>a.Code).Distinct(StringComparer.Ordinal).Count()!=snapshot.Accounts.Count ||
            snapshot.Vouchers.Any(v=>v is null || v.Id==Guid.Empty || v.Lines is null || !Enum.IsDefined(v.Status)) || snapshot.Vouchers.Select(v=>v.Id).Distinct().Count()!=snapshot.Vouchers.Count)
            throw new ArgumentException("快照含空项、重复身份或无效状态。");
        var accounts=snapshot.Accounts.ToDictionary(a=>a.Code,StringComparer.Ordinal);
        foreach(var a in snapshot.Accounts)
        {
            Money.Validate(a.OpeningDebit);Money.Validate(a.OpeningCredit);
            if(a.OpeningDebit<0 || a.OpeningCredit<0)throw new ArgumentException("期初借贷金额不能为负。");
            var seen=new HashSet<string>(StringComparer.Ordinal){a.Code};var parent=a.ParentCode;
            while(parent is not null)
            {
                if(!accounts.TryGetValue(parent,out var p)||!seen.Add(parent))throw new ArgumentException("科目父子关系缺失或循环。");
                parent=p.ParentCode;
            }
        }
        var leaves=Leaves(snapshot).Select(a=>a.Code).ToHashSet(StringComparer.Ordinal);
        if(snapshot.Accounts.Any(a=>!leaves.Contains(a.Code)&&(a.OpeningDebit!=0||a.OpeningCredit!=0)))throw new ArgumentException("父科目不能含可重复汇总的期初余额。");
        foreach(var v in snapshot.Vouchers)
        {
            if(v.Date.Year!=snapshot.Book.FiscalYear||v.Date.Month<snapshot.Book.StartMonth)throw new ArgumentException("来源凭证超出账套期间。");
            foreach(var l in v.Lines)
            {
                if(l is null||!leaves.Contains(l.AccountCode))throw new ArgumentException("来源分录须引用现有末级科目。");
                Money.Validate(l.Debit);Money.Validate(l.Credit);
                if(l.Debit<0||l.Credit<0||l.Debit!=0&&l.Credit!=0)throw new ArgumentException("来源分录借贷无效。");
            }
            if(v.Status==VoucherStatus.Posted&&Money.Sum(v.Lines.SelectMany(l=>new[]{l.Debit,-l.Credit}))!=0)throw new ArgumentException("已记账凭证借贷不平衡。");
        }
    }
}
