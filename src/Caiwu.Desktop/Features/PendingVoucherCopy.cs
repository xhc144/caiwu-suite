using Caiwu.Contracts;
using Caiwu.Desktop.Presentation;
using Caiwu.VoucherTools;

namespace Caiwu.Desktop.Features;

/// <summary>A detached new draft, consumed only after the host's explicit Save succeeds.</summary>
public sealed class PendingVoucherCopy
{
    private int saving;
    public FeatureSessionBinding Binding { get; }
    public VoucherCopyPlan Plan { get; }
    public Voucher? SavedVoucher { get; private set; }

    public PendingVoucherCopy(FeatureSessionBinding binding, VoucherCopyPlan plan)
    {
        Binding = binding; Plan = plan;
        if (plan.Draft.Id is not null || plan.Draft.ExpectedBookId != binding.Shown.Book.Id ||
            plan.Draft.ExpectedRevision != binding.Shown.Revision || !binding.Shown.Vouchers.Any(v => v.Id == plan.SourceVoucherId))
            throw new LedgerValidationException("复制计划与已显示的源快照不一致。");
    }

    public async Task<Voucher> SaveAsync(VoucherDraft editedDraft)
    {
        if (Interlocked.CompareExchange(ref saving, 1, 0) != 0)
            throw new LedgerValidationException("正在保存，请勿重复提交。");
        try
        {
            if (SavedVoucher is not null) throw new LedgerValidationException("此复制草稿已经保存，请勿重复提交。");
            if (editedDraft.Id is not null || editedDraft.ExpectedBookId != Plan.Draft.ExpectedBookId ||
                editedDraft.ExpectedRevision != Plan.Draft.ExpectedRevision)
                throw new StoreConcurrencyException("复制草稿不能更换原快照或复用凭证身份。");
            PreviewLedgerService.DemandWritable(Binding.Shown.Book);
            var service = Binding.DemandCurrent();
            // The modal owner cannot switch books during a user save. Core/SQLite check the original
            // revision atomically, including changes made by another process. No UI-thread disk I/O.
            var saved = await Task.Run(() =>
            {
                Binding.DemandCurrent();
                return service.SaveDraft(editedDraft, Plan.PreparedBy);
            });
            SavedVoucher = saved; // Consume before the caller attempts any display refresh.
            return saved;
        }
        finally { Volatile.Write(ref saving, 0); }
    }
}
