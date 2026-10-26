namespace Caiwu.Costing.Parity;

public sealed record InventoryControlPlacement(string Id, decimal X, decimal Y, decimal Width, decimal Height, string? Text = null);
public sealed record InventoryDialogLayout(string ObjectName, decimal Width, decimal Height, IReadOnlyList<InventoryControlPlacement> Controls);

/// <summary>Known PBU rectangles only, from original-analysis/json/windows.json chengben/main.
/// Rendering scales the whole canvas uniformly. This is not a PBU-to-pixel/DPI claim.</summary>
public static class InventoryWindowLayout
{
    public static InventoryDialogLayout Calculate { get; } = new("w_cb_hz", 1815, 836, Array.AsReadOnly<InventoryControlPlacement>([
        new("cb_1",498,592,247,108,"确定"), new("cb_2",978,592,247,108,"取消"),
        new("cbx_1",375,232,891,76,"自动调整没有数量还有金额的产品"), new("em_1",773,96,361,100),
        new("st_1",334,92,416,96,"核算年月："), new("st_2",69,344,279,76,"说明："),
        new("st_3",384,344,1001,76,"1) 成本核算后本月单据将不允许再输入"),
        new("st_4",384,420,1161,76,"2) 系统将按照加权平均法计算所有产品的成本"),
        new("st_5",384,496,1280,76,"3) 根据盘点表的实际数量重新核算盘盈盘亏") ]));
    public static InventoryDialogLayout Cancel { get; } = new("w_cb_fgz", 1166, 684, Array.AsReadOnly<InventoryControlPlacement>([
        new("cb_1",242,424,283,96,"确定"), new("cb_2",667,424,283,96,"取消"),
        new("st_1",695,292,361,88,"月的成本核算"), new("st_2",73,292,407,88,"本功能将取消"),
        new("st_4",32,64,1079,124,"  提  示  "), new("st_jzyf",457,292,233,88) ]));
    public static InventoryDialogLayout SelectWarehouse { get; } = new("w_cb_ckxz", 1166, 684, Array.AsReadOnly<InventoryControlPlacement>([
        new("cb_1",370,396,283,96,"确定"), new("rb_1",187,192,311,76,"仓库"), new("rb_2",677,192,311,76,"车间") ]));
}
