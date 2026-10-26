namespace Caiwu.Invoicing;

/// <summary>Known schema fields, not recovered visual column order. Unknown variant fields are retained in Fields.</summary>
public static class InvoiceColumns
{
    public static IReadOnlyList<string> Output { get; } = Array.AsReadOnly(new[]
    {
        "fpdm", "fphm", "g_qymc", "g_sh", "yhzh", "dzdh", "rq", "djh", "bz1", "spmc", "gg", "jldw",
        "sl", "dj", "je0", "slv", "se", "je1", "fpzt", "lx", "sh_bz", "nf", "yf", "xf", "pz_bz",
        "p_nf", "p_yf", "p_pzlx", "p_pzbh", "p_pjdh", "xh", "s_spbmbbh", "s_ssflbm"
    });
    public static IReadOnlyList<string> Input { get; } = Array.AsReadOnly(new[]
    {
        "fpdm", "fphm", "g_sh", "g_qymc", "rq", "bz1", "je0", "se", "je1", "fpzt", "rq_2", "lx", "sh_bz",
        "nf", "yf", "pz_bz", "p_nf", "p_yf", "p_pzlx", "p_pzbh", "p_pjdh"
    });
}
