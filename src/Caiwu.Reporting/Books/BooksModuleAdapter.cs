#if CAIWU_PARITY_MODULES_V1
using Caiwu.Contracts;

namespace Caiwu.Reporting.Books;

/// <summary>Enabled when the owning integration branch's ParityModules contract exists; no writes, re-reads or proposals.</summary>
public static class BooksModuleAdapter
{
    public static BooksModuleProjection FromSnapshot(ModuleLedgerSnapshot snapshot, BooksProjectionOptions options)
    {
        ArgumentNullException.ThrowIfNull(snapshot); ArgumentNullException.ThrowIfNull(options);
        var ledger = snapshot.Ledger;
        if (options.ExpectedBookId != ledger.Book.Id || options.ExpectedRevision != ledger.Revision)
            throw new ArgumentException("账簿补充字段与用户所见账套/版本不一致，须显式重载。");
        var input = BooksSnapshotAdapter.FromSnapshot(ledger, options.JournalKinds, options.PreOpeningActivity, options.BaseCurrencyName);
        var annotations = options.LineAnnotations.ToDictionary(a => (a.VoucherId, a.Sequence));
        var consumed = new HashSet<(Guid, int)>();
        var vouchers = input.Vouchers.Select(v => v with { Lines = Array.AsReadOnly(v.Lines.Select(l =>
        {
            if (!annotations.TryGetValue((v.Id, l.Sequence), out var a)) return l;
            if (a.AccountCode != l.AccountCode || a.Summary != l.Summary || a.Debit != l.Debit || a.Credit != l.Credit)
                throw new ArgumentException("结算/票据补充字段与原分录不一致，不能附到被修改后的行。");
            consumed.Add((v.Id, l.Sequence));
            return l with { SettlementType = a.SettlementType, CheckNumber = a.CheckNumber, BillNumber = a.BillNumber, SourceKey = a.SourceKey };
        }).ToArray()) }).ToArray();
        if (consumed.Count != annotations.Count) throw new ArgumentException("补充字段引用不存在的凭证/行序。");
        var retained = snapshot.Modules.SelectMany(m => m.Documents.Select(d =>
            new BooksRetainedModuleDocument(m.ModuleId, d.DocumentId, d.SchemaVersion, d.PayloadJson))).ToArray();
        return new(input with { Vouchers = Array.AsReadOnly(vouchers), SourceDescription =
            "同一 ModuleLedgerSnapshot 的本币账簿投影；完整模块原文另行保留。辅助/外币/数量/未知原列不在本切片计算或兼容声明内。" }, Array.AsReadOnly(retained));
    }

    public static ParityModuleRegistration Registration(string product)
    {
        if (product is not ("qingsong/main" or "minfeiqi/main" or "chengben/main"))
            throw new ArgumentException("未核实的产品不能复用账务窗口注册。");
        return new("books", 1, Array.AsReadOnly(new[] {
            new OriginalWindowReference(product, "w_zc_zc", "menu:m_frame_zw/m_o/m_o30/m_o30_00"),
            new OriginalWindowReference(product, "w_zc_xjrjz", "menu:m_frame_zw/m_o/m_o30/m_o30_10"),
            new OriginalWindowReference(product, "w_zc_yhrjz", "menu:m_frame_zw/m_o/m_o30/m_o30_20")
        }));
    }
}
#endif
