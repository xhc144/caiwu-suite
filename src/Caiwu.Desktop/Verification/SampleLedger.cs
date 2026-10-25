using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;

namespace Caiwu.Desktop.Verification;

/// <summary>Synthetic, new-book-only fixture used by integration and Windows UI verification.</summary>
public static class SampleLedger
{
    public static Guid Create(DesktopBackend backend, string path)
    {
        var template = backend.Templates.Single(t => t.Regime == AccountingRegime.SmallBusiness);
        var book = new BookInfo(Guid.NewGuid(), "示例单位 · 界面验证", template.Regime, template.Version,
            2026, 10, 9, DateTimeOffset.UtcNow);
        using var store = backend.Create(path, book, template.Accounts);
        var service = backend.CreateService(store);
        string Code(string name) => template.Accounts.Single(a => a.Name == name).Code;
        service.SetOpeningBalances([new(Code("银行存款"), 100000m, 0m), new(Code("实收资本"), 0m, 100000m)], "期初复核员");
        Guid last = Guid.Empty;
        foreach (var (debit, credit, amount, summary) in new[]
        {
            ("原材料", "银行存款", 10000m, "购入材料（无税测试）"),
            ("管理费用", "银行存款", 1200m, "支付管理费用（测试）"),
            ("银行存款", "主营业务收入", 20000m, "收到业务款（测试）")
        })
        {
            var voucher = service.SaveDraft(new VoucherDraft(null, new DateOnly(2026, 10, 12), "记", null, 1,
                [new(Code(debit), summary, amount, 0m), new(Code(credit), summary, 0m, amount)]), "制单员");
            service.Review(voucher.Id, "审核员"); service.Post(voucher.Id, "记账员"); last = voucher.Id;
        }
        return last;
    }
}
