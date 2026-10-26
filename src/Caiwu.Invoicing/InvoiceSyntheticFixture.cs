using System.Collections.Immutable;

namespace Caiwu.Invoicing;

/// <summary>Invented review data; no tax identifiers, invoices, accounts or books were taken from a user.</summary>
public static class InvoiceSyntheticFixture
{
    public static InvoiceWorkspace Create(InvoiceProduct product)
    {
        string[] codes = ["1122", "6001", "6002", "222101", "1403", "222102", "2202"];
        var store = new MemoryInvoiceStore(InvoiceWorkspace.CreateSynthetic(Guid.NewGuid(), product, new(2026, 10),
            codes.Select(x => new InvoiceAccount(x, true, true))));
        var output = LegacyInvoiceRow.Parse("""{"fpdm":"SYNTH-CODE","fphm":"00000001","g_qymc":"合成购方","g_sh":"SYNTHETIC-NOT-A-TAX-ID","rq":"2026-10-05T09:00:00","spmc":"合成商品","sl":2,"dj":50,"je0":100,"slv":0.13,"se":13,"je1":113,"fpzt":"正常","lx":"SYNTH-SPECIAL","sh_bz":"0","pz_bz":"0","xh":1,"fixture_only":true}""");
        var input = LegacyInvoiceRow.Parse("""{"fpdm":"SYNTH-CODE","fphm":"00000002","g_qymc":"合成销方","g_sh":"SYNTHETIC-NOT-A-TAX-ID","rq":"2026-10-06T10:00:00","rq_2":"2026-10-07T11:00:00","je0":200,"se":26,"je1":226,"fpzt":"正常","lx":"SYNTH-SPECIAL","sh_bz":"0","pz_bz":"0","fixture_only":true}""");
        foreach (var column in InvoiceColumns.Output) if (!output.Fields.ContainsKey(column)) output = output.Set(column, null);
        foreach (var column in InvoiceColumns.Input) if (!input.Fields.ContainsKey(column)) input = input.Set(column, null);
        new InvoiceService(store).Import(0, [new(InvoiceDirection.Output, InvoiceKind.Special, [output]), new(InvoiceDirection.Input, InvoiceKind.Special, [input])]);
        return store.Read();
    }
}
