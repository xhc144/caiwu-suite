using System.Collections.Immutable;
using Caiwu.FixedAssets;

namespace Caiwu.FixedAssets.Tests;

public sealed class AssetBookTests
{
    private static readonly DateOnly Jan = new(2026, 1, 1);
    private static readonly AssetPeriod January = new(2026, 1);
    private static readonly AssetPeriod February = new(2026, 2);
    private static readonly AssetBookIdentity Identity = new("minfeiqi", "SYNTHETIC-ASSETS-001", "synthetic", "fixture-v1");
    private static AssetCatalog Catalog => new()
    {
        Categories = [new("01", "合成设备", .05m, "1601")],
        Statuses = [new("01", "使用中", true), new("02", "不计提", false)],
        Departments = [new("01", "合成部门一"), new("02", "合成部门二")],
        Purposes = [new("01", "合成用途", "6602"), new("02", "合成用途二", "5001")],
        DisposalReasons = [new("01", "合成报废")],
        Accounts = [new("1601", true, true), new("1602", true, true), new("1606", true, true),
            new("6602", true, true), new("5001", true, true), new("1002", true, true),
            new("6", true, false), new("9999", false, true)]
    };
    private static AssetBookState Initial => new() { Identity = Identity,
        Settings = new(January, Catalog, "1602", "1606") };
    private static AssetCard A(string code = "A001", decimal cost = 1000, decimal residual = 100, int months = 3) => new()
    {
        Code = code, Name = "合成资产 " + code, CategoryCode = "01", StatusCode = "01", DepartmentCode = "01", PurposeCode = "01",
        PurchaseDate = Jan, UseDate = Jan, OriginalCost = cost, ResidualValue = residual, ResidualRate = .1m, UsefulLifeMonths = months
    };
    private static (InMemoryAssetBookStore Store, AssetBookService Service) Setup(AssetBookState? state = null)
    {
        var store = new InMemoryAssetBookStore(state ?? Initial);
        return (store, new(store, Identity));
    }
    private static AssetRuleException Fails(string code, Action action)
    {
        var ex = Assert.Throws<AssetRuleException>(action); Assert.Equal(code, ex.Code); return ex;
    }
    private static AssetDepreciationBatch Calc(AssetBookService service, AssetPeriod period,
        IReadOnlyDictionary<Guid, decimal>? workloads = null) => service.CalculateDepreciation(service.Read().Revision, period, workloads);

    [Fact]
    public void UseMonthIsZero_NextMonthStarts_ResidualIsExact_AndQueryTracksLedger()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan);
        Assert.Equal(0, Calc(s, January).Total);
        Assert.Equal(300m, Calc(s, February).Total);
        Assert.Equal(300m, Calc(s, new(2026, 3)).Total);
        Assert.Equal(300m, Calc(s, new(2026, 4)).Total);
        Assert.Equal(0, Calc(s, new(2026, 5)).Total);
        var row = Assert.Single(s.Ledger()); Assert.Equal(900m, row.AccumulatedDepreciation); Assert.Equal(100m, row.NetValue);
        Assert.Equal(3, s.Read().Cards[a.Id].DepreciatedMonths);
        Assert.Equal(3, s.DepreciationQuery(2026, 1, 5, true).Length);
    }

    [Theory]
    [InlineData(2024, 2, 29, 2024, 3)]
    [InlineData(2025, 12, 31, 2026, 1)]
    public void LeapAndYearBoundariesUseCalendarMonths(int y, int m, int d, int nextYear, int nextMonth)
    {
        var date = new DateOnly(y, m, d); var opening = new AssetPeriod(y, m);
        var (_, s) = Setup(Initial with { Settings = Initial.Settings with { OpeningPeriod = opening } });
        s.AddCard(0, A() with { PurchaseDate = date, UseDate = date }, date);
        Assert.Equal(0, Calc(s, opening).Total);
        Assert.Equal(300m, Calc(s, new(nextYear, nextMonth)).Total);
    }

    [Theory]
    [InlineData("100.00", "0.00", 3)]
    [InlineData("0.05", "0.01", 7)]
    [InlineData("1234.56", "234.56", 12)]
    public void RoundingNeverCrossesResidualAndFinalInstalmentClearsBasis(string cost, string residual, int months)
    {
        var c = decimal.Parse(cost, System.Globalization.CultureInfo.InvariantCulture);
        var r = decimal.Parse(residual, System.Globalization.CultureInfo.InvariantCulture);
        var (_, s) = Setup(); s.AddCard(0, A(cost:c, residual:r, months:months), Jan); Calc(s, January);
        var total = 0m; var p = February;
        for (var i = 0; i < months; i++, p = p.Next())
        {
            total += Calc(s, p).Total; Assert.True(Assert.Single(s.Ledger()).NetValue >= r);
        }
        Assert.Equal(c - r, total); Assert.Equal(r, Assert.Single(s.Ledger()).NetValue);
    }

    [Fact]
    public void HalfCentRoundsAwayFromZero() => Assert.Equal(.01m, AssetBookService.RoundMoney(.005m));

    [Fact]
    public void DuplicateSkippedAndBackdatedPeriodsLeaveStateUntouched()
    {
        var (store, s) = Setup(); s.AddCard(0, A(), Jan);
        var before = store.Load(); Fails("period-order", () => Calc(s, February)); Assert.Same(before, store.Load());
        Calc(s, January); before = store.Load(); Fails("depreciated-period", () => Calc(s, January)); Assert.Same(before, store.Load());
        Fails("before-opening", () => Calc(s, new(2025, 12))); Assert.Same(before, store.Load());
    }

    [Fact]
    public void WorkloadRequiresExplicitInput_RejectsExcess_AndFinishesAtResidual()
    {
        var (store, s) = Setup(); var a = A() with { Method = AssetDepreciationMethod.UnitsOfProduction, TotalWorkload = 7 };
        s.AddCard(0, a, Jan); Calc(s, January); var before = store.Load();
        Fails("workload-required", () => Calc(s, February)); Assert.Same(before, store.Load());
        Fails("excess-workload", () => Calc(s, February, new Dictionary<Guid, decimal> { [a.Id] = 8 })); Assert.Same(before, store.Load());
        Fails("excess-workload", () => Calc(s, February, new Dictionary<Guid, decimal> { [a.Id] = -1 }));
        Assert.Equal(257.14m, Calc(s, February, new Dictionary<Guid, decimal> { [a.Id] = 2 }).Total);
        Assert.Equal(642.86m, Calc(s, new(2026, 3), new Dictionary<Guid, decimal> { [a.Id] = 5 }).Total);
        Assert.Equal(100m, Assert.Single(s.Ledger()).NetValue);
    }

    [Fact]
    public void AnyBadCardMakesWholeDepreciationAtomic()
    {
        var (store, s) = Setup(); var a = A("A"); var b = A("B") with { Method = AssetDepreciationMethod.UnitsOfProduction, TotalWorkload = 7 };
        s.AddCard(0, a, Jan); s.AddCard(1, b, Jan); Calc(s, January); var before = store.Load();
        Fails("workload-required", () => Calc(s, February)); Assert.Same(before, store.Load());
        Assert.All(s.Ledger(), x => Assert.Equal(0, x.AccumulatedDepreciation));
    }

    [Fact]
    public void NonDepreciatingStatusAndFutureUseDoNotAccrue()
    {
        var (_, s) = Setup(); s.AddCard(0, A("A") with { StatusCode = "02" }, Jan);
        s.AddCard(1, A("B") with { UseDate = new(2026, 3, 1) }, Jan);
        Calc(s, January); Assert.Equal(0, Calc(s, February).Total); Assert.Equal(0, Calc(s, new(2026, 3)).Total);
        Assert.Equal(300m, Calc(s, new(2026, 4)).Total);
    }

    [Fact]
    public void CancelLatestOnly_RestoresEntireCardIncludingMonthlyWorkload_ThenRecalculate()
    {
        var (_, s) = Setup(); var a = A() with { MonthlyDepreciation = 12.34m, MonthlyWorkload = 3 };
        s.AddCard(0, a, Jan); var jan = Calc(s, January); var feb = Calc(s, February);
        Fails("cancel-order", () => s.CancelDepreciation(s.Read().Revision, jan.Id));
        s.CancelDepreciation(s.Read().Revision, feb.Id);
        Assert.Equal(feb.Before[a.Id], s.Read().Cards[a.Id]);
        s.CancelDepreciation(s.Read().Revision, jan.Id); Assert.Equal(a, s.Read().Cards[a.Id]);
        Assert.Empty(s.DepreciationQuery(2026, 1, 12, false));
        Assert.Equal(0, Calc(s, January).Total); Assert.Equal(300m, Calc(s, February).Total);
    }

    [Fact]
    public void LaterMovementCannotBeOverwrittenByCancel()
    {
        var (store, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January); var feb = Calc(s, February);
        s.Transfer(s.Read().Revision, a.Id, new(2026, 3, 1), "02", "02", "新位置", "合成调拨"); var before = store.Load();
        Fails("later-movement", () => s.CancelDepreciation(s.Read().Revision, feb.Id)); Assert.Same(before, store.Load());
    }

    [Fact]
    public void OriginalCostAdjustmentIsProspectiveAndHistoryHasBeforeAfter()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January); Calc(s, February);
        s.AdjustOriginalCost(s.Read().Revision, a.Id, new(2026, 3, 1), 1400m, 100m, "合成改造");
        Assert.Equal(500m, Calc(s, new(2026, 3)).Total); Assert.Equal(500m, Calc(s, new(2026, 4)).Total);
        var adjustment = s.Movements(a.Id).Single(x => x.Kind == AssetMovementKind.OriginalCostAdjustment);
        Assert.Equal(1000m, adjustment.Before!.OriginalCost); Assert.Equal(1400m, adjustment.After.OriginalCost);
        Assert.Equal(100m, Assert.Single(s.Ledger()).NetValue);
    }

    [Fact]
    public void DisposalMonthAccrues_FollowingMonthDoesNot_DisposalPlanBalances()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January);
        s.Dispose(s.Read().Revision, a.Id, new(2026, 2, 20), "01");
        var feb = Calc(s, February); Assert.Equal(300m, feb.Total);
        var march = Calc(s, new(2026, 3)); Assert.Equal(0, march.Total); Assert.Empty(s.Ledger(false));
        var disposal = s.Movements(a.Id).Single(x => x.Kind == AssetMovementKind.Disposal);
        var plan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Disposal, disposal.Id, new(2026, 2, 20), "记", 1);
        Assert.Equal(1000, plan.DebitTotal); Assert.Equal(plan.DebitTotal, plan.CreditTotal);
        Assert.Equal(700m, plan.Lines.Single(x => x.AccountCode == "1606").Debit);
        Assert.Equal(300m, plan.Lines.Single(x => x.AccountCode == "1602").Debit);
        s.CancelDepreciation(s.Read().Revision, march.Id);
        Fails("plan-exists", () => s.CancelDepreciation(s.Read().Revision, feb.Id));
    }

    [Fact]
    public void DepreciationPlanIsBalancedIdempotentAndMustBeVoidedBeforeCancel()
    {
        var (store, s) = Setup(); s.AddCard(0, A(), Jan); Calc(s, January); var feb = Calc(s, February);
        var plan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Depreciation, feb.Id, February.LastDay, "记", 1);
        Assert.Equal(300m, plan.DebitTotal); Assert.Equal(plan.DebitTotal, plan.CreditTotal);
        var before = store.Load(); Assert.Equal(plan, s.CreateVoucherPlan(before.Revision, AssetVoucherKind.Depreciation, feb.Id, February.LastDay, "记", 1));
        Assert.Same(before, store.Load()); Fails("plan-exists", () => s.CancelDepreciation(before.Revision, feb.Id));
        s.VoidVoucherPlan(before.Revision, plan.Id); s.CancelDepreciation(s.Read().Revision, feb.Id);
        Fails("batch-missing", () => s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Depreciation, feb.Id, February.LastDay, "记", 2));
        Assert.True(Assert.Single(s.Read().VoucherPlans).Voided);
    }

    [Fact]
    public void AdditionAndDepartmentAllocationPlansKeepSourceIdentity()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan);
        var movement = Assert.Single(s.Movements(a.Id));
        var plan = s.CreateVoucherPlan(s.Read().Revision, AssetVoucherKind.Addition, movement.Id, Jan, "记", 1, "1002");
        Assert.Equal(1000, plan.DebitTotal); Assert.Equal("1601", plan.Lines[0].AccountCode);
        Assert.All(plan.Lines, x => Assert.Equal("01", x.DepartmentCode));
        Assert.Contains(Identity.BookId, plan.SourceKey);
        Fails("plan-exists", () => s.Transfer(s.Read().Revision, a.Id, Jan, "02", "02", "L", "test"));
    }

    [Theory]
    [InlineData("6")]
    [InlineData("9999")]
    [InlineData("missing")]
    public void VoucherRequiresActiveLeafAccounts(string account)
    {
        var (store, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); var before = store.Load();
        Fails("invalid-account", () => s.CreateVoucherPlan(before.Revision, AssetVoucherKind.Addition,
            Assert.Single(s.Movements(a.Id)).Id, Jan, "记", 1, account)); Assert.Same(before, store.Load());
    }

    [Fact]
    public void CrossBookReadAndStaleMutationFailWithoutWrites()
    {
        var (store, s) = Setup(); s.AddCard(0, A(), Jan); var before = store.Load();
        Fails("stale-revision", () => s.AddCard(0, A("B"), Jan)); Assert.Same(before, store.Load());
        Fails("book-mismatch", () => new AssetBookService(store, Identity with { BookId = "wrong" }).Read());
    }

    [Fact]
    public void RepositoryCASRejectsConcurrentCommitAndLeavesLosingOperationAbsent()
    {
        var (store, _) = Setup(); var interfering = new RacingStore(store);
        var s = new AssetBookService(interfering, Identity);
        Fails("stale-revision", () => s.AddCard(0, A(), Jan)); Assert.Empty(store.Load().Cards); Assert.Equal(1, store.Load().Revision);
    }
    private sealed class RacingStore(InMemoryAssetBookStore inner) : IAssetBookStore
    {
        public AssetBookState Load() => inner.Load();
        public bool TrySave(AssetBookIdentity identity, long revision, AssetBookState next)
        {
            var state = inner.Load(); inner.TrySave(identity, revision, state with { Revision = revision + 1 });
            return inner.TrySave(identity, revision, next);
        }
    }

    [Fact]
    public void ReadOnlyAndClosedPeriodAreEnforced()
    {
        var (_, readOnly) = Setup(Initial with { ReadOnly = true }); Fails("read-only", () => readOnly.AddCard(0, A(), Jan));
        var (_, closed) = Setup(Initial with { ClosedThrough = January }); Fails("closed-period", () => closed.AddCard(0, A(), Jan));
    }

    [Theory]
    [InlineData(-1, 0, "asset-cost")]
    [InlineData(100, 101, "asset-residual")]
    [InlineData(100, -1, "asset-residual")]
    public void InvalidCostAndResidualCannotCreateCards(int cost, int residual, string code)
    {
        var (store, s) = Setup(); Fails(code, () => s.AddCard(0, A(cost:cost, residual:residual), Jan)); Assert.Empty(store.Load().Cards);
    }

    [Fact]
    public void DuplicateAndInvalidDatesAndDirectFinancialRewriteAreRejected()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan);
        Fails("duplicate-code", () => s.AddCard(1, A(), Jan));
        Fails("use-date", () => s.AddCard(1, A("B") with { UseDate = Jan.AddDays(-1) }, Jan));
        Fails("use-audited-operation", () => s.UpdateCard(1, a with { OriginalCost = 2000 }, Jan));
        Fails("before-opening", () => s.Dispose(1, a.Id, Jan.AddDays(-1), "01"));
    }

    [Fact]
    public void DeleteDepreciatedAssetIsBlocked()
    {
        var (_, s) = Setup(); var a = A(); s.AddCard(0, a, Jan); Calc(s, January); Calc(s, February);
        Fails("has-depreciation", () => s.DeleteCard(s.Read().Revision, a.Id));
    }

    [Fact]
    public void FullSyntheticSnapshotRoundTripPreservesOriginalNullBinaryAndAccessoriesAndCanCancel()
    {
        var (_, s) = Setup(); var a = A() with
        {
            ForeignAmount = null, CurrencyCode = "USD", ReferenceNumber = "ref", Specification = "fixture",
            Accessories = [new("01", "合成附属设备", 2, 3.25m, 6.50m, "说明", [])],
            Images = [new("synthetic.bin", "application/octet-stream", [0, 1, 255])],
            OriginalRows = [new("zc_gdzc", "synthetic-row-1", ImmutableDictionary<string, OriginalCell>.Empty
                .Add("unknown_null", new("char(20)", true, null, []))
                .Add("unknown_raw", new("double", false, "1.2345678901", [0, 255]))) ]
        };
        s.AddCard(0, a, Jan); Calc(s, January); var feb = Calc(s, February);
        var json = AssetSnapshotCodec.Serialize(s.Read()); var restored = AssetSnapshotCodec.Deserialize(json);
        var restoredCard = restored.Cards[a.Id]; Assert.Null(restoredCard.ForeignAmount);
        Assert.Equal(new byte[] { 0, 1, 255 }, restoredCard.Images[0].Bytes); Assert.Equal(6.50m, restoredCard.Accessories[0].Amount);
        Assert.True(restoredCard.OriginalRows[0].Cells["unknown_null"].IsNull);
        Assert.Equal("1.2345678901", restoredCard.OriginalRows[0].Cells["unknown_raw"].Text);
        var (_, copy) = Setup(restored); copy.CancelDepreciation(restored.Revision, feb.Id);
        Assert.Equal(0, copy.Read().Cards[a.Id].AccumulatedDepreciation);
    }
}
