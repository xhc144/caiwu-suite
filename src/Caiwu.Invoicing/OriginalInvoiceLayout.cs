using System.Collections.Immutable;

namespace Caiwu.Invoicing;

public readonly record struct OriginalPbuBounds(int X, int Y, int Width, int Height);

/// <summary>Only controls actually used by this slice. Source: original-analysis/json/windows.json,
/// w_fp_lr_1 and w_fp_lr_2. Visual DataWindow column order and runtime resize behavior remain unknown.</summary>
public static class OriginalInvoiceLayout
{
    public static ImmutableDictionary<string, OriginalPbuBounds> Entry(InvoiceDirection direction) => direction switch
    {
        InvoiceDirection.Output => Output,
        InvoiceDirection.Input => Input,
        _ => throw new InvoiceException("direction", "发票方向无效。")
    };
    private static readonly ImmutableDictionary<string, OriginalPbuBounds> Output = new Dictionary<string, OriginalPbuBounds>
    {
        ["cb_3"] = new(55, 224, 425, 148), ["em_rq1"] = new(581, 252, 416, 84),
        ["st_1"] = new(997, 264, 78, 60), ["em_rq2"] = new(1083, 252, 416, 84),
        ["cb_1"] = new(1545, 240, 375, 104), ["st_2"] = new(1970, 264, 384, 56),
        ["sle_kh"] = new(2354, 256, 599, 76), ["cb_2"] = new(2967, 244, 242, 100),
        ["st_4"] = new(3264, 256, 169, 56), ["rb_1"] = new(3502, 260, 224, 72),
        ["rb_2"] = new(3739, 260, 215, 72), ["cbx_1"] = new(4018, 260, 763, 72)
    }.ToImmutableDictionary();
    private static readonly ImmutableDictionary<string, OriginalPbuBounds> Input = new Dictionary<string, OriginalPbuBounds>
    {
        ["cb_3"] = new(78, 232, 425, 148), ["em_rq1"] = new(599, 272, 416, 84),
        ["st_1"] = new(1015, 284, 78, 60), ["em_rq2"] = new(1102, 272, 416, 84),
        ["cb_1"] = new(1563, 264, 375, 104), ["st_2"] = new(2002, 284, 448, 56),
        ["sle_kh"] = new(2427, 276, 544, 76), ["cb_2"] = new(2985, 264, 242, 100),
        ["st_4"] = new(3282, 276, 169, 56), ["rb_1"] = new(3520, 280, 251, 72),
        ["rb_2"] = new(3826, 280, 251, 72), ["cbx_1"] = new(4192, 280, 763, 72)
    }.ToImmutableDictionary();
}
