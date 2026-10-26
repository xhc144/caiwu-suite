using System.Data;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Caiwu.Payroll;
using Caiwu.Payroll.Tests;
using Caiwu.Payroll.Wpf;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 2 || !Regex.IsMatch(args[1], "^[0-9a-f]{40}$"))
            throw new ArgumentException("Use <NEW evidence-directory> <full-source-sha>. Synthetic new implementation only.");
        var output = Path.GetFullPath(args[0]);
        if (Directory.Exists(output)) throw new IOException("Evidence directory already exists; choose a new destination.");
        Directory.CreateDirectory(output);
        var results = new List<object>();
        var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        using var fixture = new SyntheticFixture();
        try
        {
            var service = fixture.Service;
            var departments = new DepartmentWindow(service); departments.Show(); Pump();
            var departmentGrid = Find<DataGrid>(departments, g => g.Name == "dw_1");
            EditCell(departmentGrid, 0, "部门名称", "合成部门已在窗口存盘");
            Click(departments, "cb_3");
            Check(fixture.Reopen().Snapshot.Departments[0].Name == "合成部门已在窗口存盘", "Department event did not persist.");
            Capture(departments, output, "department"); departments.Close();
            results.Add(new { check = "department_grid_save_reopen", passed = true });

            var add = new AddEmployeeWindow(service); add.Show(); Pump();
            Find<TextBox>(add, t => t.Name == "sle_bh").Text = "000003";
            Find<TextBox>(add, t => t.Name == "sle_name").Text = "合成新增人员";
            Find<ComboBox>(add, c => c.Name == "ddlb_bm").SelectedValue = "01";
            Click(add, "cb_2");
            Check(fixture.Reopen().Snapshot.Employees.Any(e => e.Code == "000003" && e.Name == "合成新增人员"), "Add-employee event did not persist.");
            Capture(add, output, "employee-add"); add.Close();
            results.Add(new { check = "add_employee_event_reopen", passed = true });

            var columns = new PayrollColumnsWindow(service); columns.Show(); Pump();
            Capture(columns, output, "columns"); columns.Close();
            var formulas = new PayrollFormulasWindow(service); formulas.Show(); Pump();
            Capture(formulas, output, "formulas"); formulas.Close();
            var personnel = new PersonnelManagementView(service, () => { });
            var personnelHost = new Window { Title = "人事管理（合成新实现）", Content = personnel, Width = 1200, Height = 700 };
            personnelHost.Show(); Pump(); Capture(personnelHost, output, "personnel"); personnelHost.Close();

            var wages = new WageManagementView(service, SyntheticFixture.Month, SyntheticFixture.Accounts, () => { });
            var wageHost = new Window { Title = "工资管理（合成新实现）", Content = wages, Width = 1500, Height = 800 };
            wageHost.Show(); Pump();
            var wageGrid = Find<DataGrid>(wages, g => g.Name == "dw_master");
            EditCell(wageGrid, 0, "基本工资", "1500.10");
            // Do not change focus before invoking Save: exercise the last active cell.
            Menu(wages, "存盘");
            Check(fixture.Reopen().Snapshot.Periods[0].Rows[0].Inputs["g_l01"] == 1500.10m, "Active cell was not saved.");
            Menu(wages, "工资计算");
            Check(fixture.Reopen().GetWageTable(SyntheticFixture.Month).Totals["g_l05"] == 3650.25m, "Wage calculation event differs from expected synthetic total.");
            Capture(wageHost, output, "wages"); wageHost.Close();
            results.Add(new { check = "active_cell_save_calculate_reopen", passed = true });

            var plan = new PayrollVoucherWindow(service, SyntheticFixture.Month, PayrollVoucherKind.Payment, SyntheticFixture.Accounts);
            plan.Show(); Pump();
            Find<ComboBox>(plan, c => c.Name == "ddlb_1").Text = "记";
            Find<TextBox>(plan, t => t.Name == "em_3").Text = "20";
            Capture(plan, output, "voucher-parameters"); Click(plan, "cb_1");
            Check(fixture.Reopen().Snapshot.VoucherPlans.Single().Lines.Sum(l => l.Debit) == 3800.30m, "Generate event did not save the balanced plan.");
            Capture(plan, output, "voucher-plan"); plan.Close();
            results.Add(new { check = "generate_plan_event_reopen", passed = true });

            File.WriteAllText(Path.Combine(output, "results.json"), JsonSerializer.Serialize(new
            {
                sourceSha = args[1], environment = Environment.OSVersion.ToString(), syntheticOnly = true,
                originalProgramExecuted = false, originalLedgerCompatibility = "not-tested", originalVisualParity = "not-tested",
                checks = results
            }, new JsonSerializerOptions { WriteIndented = true }));
            application.Shutdown(); return 0;
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(output, "failure.json"), JsonSerializer.Serialize(new
            { sourceSha = args[1], syntheticOnly = true, error = error.Message, completedChecks = results }, new JsonSerializerOptions { WriteIndented = true }));
            foreach (Window window in application.Windows.Cast<Window>().ToArray()) window.Hide();
            application.Shutdown(); return 1;
        }
    }
    private static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static void Pump()
    {
        var frame = new DispatcherFrame();
        Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.Background, () => frame.Continue = false);
        Dispatcher.PushFrame(frame);
    }
    private static IEnumerable<DependencyObject> Descendants(DependencyObject source)
    {
        yield return source;
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(source); i++)
            foreach (var child in Descendants(VisualTreeHelper.GetChild(source, i))) yield return child;
    }
    private static T Find<T>(DependencyObject source, Func<T, bool> predicate) where T : DependencyObject
        => Descendants(source).OfType<T>().First(predicate);
    private static void Click(Window window, string name)
    { Find<Button>(window, b => b.Name == name).RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Pump(); }
    private static void Menu(DependencyObject source, string header)
    {
        var top = Find<MenuItem>(source, m => Equals(m.Header, "O.操作"));
        var item = top.Items.Cast<MenuItem>().Single(i => Equals(i.Header, header));
        item.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent)); Pump();
    }
    private static void EditCell(DataGrid grid, int rowIndex, string header, string value)
    {
        var item = grid.Items[rowIndex]; var column = grid.Columns.Single(c => Equals(c.Header, header));
        grid.SelectedItem = item; grid.ScrollIntoView(item, column); grid.CurrentCell = new(item, column);
        grid.Focus(); grid.BeginEdit(); Pump();
        var content = column.GetCellContent(item) ?? throw new InvalidOperationException("Cell was not realized.");
        Find<TextBox>(content, _ => true).Text = value;
    }
    private static void Capture(Window window, string output, string name)
    {
        Pump(); window.UpdateLayout();
        var bitmap = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth * 1.5),
            (int)Math.Ceiling(window.ActualHeight * 1.5), 144, 144, PixelFormats.Pbgra32);
        bitmap.Render(window);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = new FileStream(Path.Combine(output, name + ".png"), FileMode.CreateNew);
        encoder.Save(stream);
    }
}
