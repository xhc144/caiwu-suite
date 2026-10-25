using Caiwu.Contracts;

namespace Caiwu.Core.Tests;

public sealed class TemplateCatalogTests
{
    [Fact]
    public void Every_regime_has_a_distinct_versioned_experimental_template()
    {
        Assert.Equal(3, TemplateCatalog.All.Count);
        Assert.Equal(3, TemplateCatalog.All.Select(t => t.Id).Distinct().Count());
        Assert.Equal(3, TemplateCatalog.All.Select(t => t.Version).Distinct().Count());
        foreach (var regime in Enum.GetValues<AccountingRegime>())
        {
            var template = TemplateCatalog.Get(regime);
            Assert.Equal(regime, template.Regime);
            Assert.False(template.IsVerifiedForProduction);
            Assert.False(string.IsNullOrWhiteSpace(template.Version));
            Assert.Equal(template.Accounts.Count, template.Accounts.Select(a => a.Code).Distinct().Count());
            Assert.All(template.Accounts, a => { Assert.True(a.IsActive); Assert.Equal(0, a.OpeningDebit); Assert.Equal(0, a.OpeningCredit); });
        }
        Assert.Throws<LedgerValidationException>(() => TemplateCatalog.Get((AccountingRegime)123));
    }

    [Theory]
    [InlineData(AccountingRegime.SmallBusiness, "3001", "3103", "5001", "5602")]
    [InlineData(AccountingRegime.Enterprise, "4001", "4103", "6001", "6602")]
    public void Business_templates_use_their_own_chart(AccountingRegime regime, string capital, string profit, string income, string expense)
    {
        var accounts = TemplateCatalog.Get(regime).Accounts;
        Assert.Equal("银行存款", accounts.Single(a => a.Code == "1002").Name);
        Assert.Equal("原材料", accounts.Single(a => a.Code == "1403").Name);
        Assert.Equal("实收资本", accounts.Single(a => a.Code == capital).Name);
        Assert.Equal("本年利润", accounts.Single(a => a.Code == profit).Name);
        Assert.Equal("主营业务收入", accounts.Single(a => a.Code == income).Name);
        Assert.Equal("管理费用", accounts.Single(a => a.Code == expense).Name);
    }

    [Fact]
    public void Nonprofit_uses_2026_names_and_separate_restriction_examples_without_business_capital_or_profit()
    {
        var accounts = TemplateCatalog.Get(AccountingRegime.Nonprofit).Accounts;
        Assert.Equal("存货", accounts.Single(a => a.Code == "1201").Name);
        Assert.Equal("非限定性净资产", accounts.Single(a => a.Code == "3101").Name);
        Assert.Equal("限定性净资产", accounts.Single(a => a.Code == "3102").Name);
        Assert.Equal("管理费用", accounts.Single(a => a.Code == "5301").Name);
        Assert.DoesNotContain(accounts, a => a.Name is "实收资本" or "本年利润" or "主营业务收入");
        foreach (var parent in new[] { "4101", "5101", "5301" })
        {
            var children = accounts.Where(a => a.ParentCode == parent).ToArray();
            Assert.Equal(2, children.Length);
            Assert.Contains(children, a => a.Name.StartsWith("非限定性", StringComparison.Ordinal));
            Assert.Contains(children, a => a.Name.StartsWith("限定性", StringComparison.Ordinal));
        }
        using var store = new MemoryLedgerStore(new(0,
            new(Guid.NewGuid(), "民非测试", AccountingRegime.Nonprofit, TemplateCatalog.Get(AccountingRegime.Nonprofit).Version,
                2026, 1, 0, DateTimeOffset.UtcNow), accounts, [], []));
        var s = new LedgerService(store);
        var v = s.SaveDraft(new(null, new(2026, 1, 1), "记", null, 0,
            [new("1002", "限定捐赠", 100, 0), new("410102", "限定捐赠", 0, 100)]), "A");
        s.Review(v.Id, "B");
        s.Post(v.Id, "C");
        var rows = s.GetTrialBalance(new(2026, 1, 1), new(2026, 1, 31));
        Assert.Equal(100, rows.Single(r => r.AccountCode == "4101").ClosingCredit);
        Assert.Equal(100, rows.Where(r => r.IsLeaf).Sum(r => r.PeriodCredit));
    }

    [Fact]
    public void Templates_cannot_be_mutated_through_readonly_interfaces()
    {
        Assert.Throws<NotSupportedException>(() => ((IList<TemplateDefinition>)TemplateCatalog.All).Clear());
        Assert.Throws<NotSupportedException>(() => ((IList<Account>)TemplateCatalog.All[0].Accounts).Clear());
    }
}
