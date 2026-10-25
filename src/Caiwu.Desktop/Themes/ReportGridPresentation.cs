using System.Collections.Specialized;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Threading;
using Caiwu.Reporting;

namespace Caiwu.Desktop.Themes;

/// <summary>Display-only decoration for the three read-only generated report grids.</summary>
public static class ReportGridPresentation
{
    public static readonly DependencyProperty GroupAmountsProperty = DependencyProperty.RegisterAttached(
        "GroupAmounts", typeof(bool), typeof(ReportGridPresentation), new PropertyMetadata(false, Changed));
    private static readonly DependencyProperty StateProperty = DependencyProperty.RegisterAttached(
        "State", typeof(State), typeof(ReportGridPresentation));
    public static void SetGroupAmounts(DependencyObject element, bool value) => element.SetValue(GroupAmountsProperty, value);
    public static bool GetGroupAmounts(DependencyObject element) => (bool)element.GetValue(GroupAmountsProperty);

    private static void Changed(DependencyObject element, DependencyPropertyChangedEventArgs args)
    {
        if (element is not DataGrid grid) return;
        if (grid.GetValue(StateProperty) is State old) old.Detach();
        grid.ClearValue(StateProperty);
        if ((bool)args.NewValue) grid.SetValue(StateProperty, new State(grid));
    }
    private sealed class State
    {
        private readonly DataGrid grid;
        private bool queued;
        public State(DataGrid grid)
        {
            this.grid = grid;
            grid.Loaded += Loaded;
            grid.Columns.CollectionChanged += ColumnsChanged;
            grid.ItemContainerGenerator.StatusChanged += Generated;
            Schedule();
        }
        public void Detach()
        {
            grid.Loaded -= Loaded;
            grid.Columns.CollectionChanged -= ColumnsChanged;
            grid.ItemContainerGenerator.StatusChanged -= Generated;
        }
        private void Loaded(object sender, RoutedEventArgs args) => Schedule();
        private void ColumnsChanged(object? sender, NotifyCollectionChangedEventArgs args) => Schedule();
        private void Generated(object? sender, EventArgs args)
        { if (grid.ItemContainerGenerator.Status == GeneratorStatus.ContainersGenerated) Schedule(); }
        private void Schedule()
        {
            if (queued || grid.Dispatcher.HasShutdownStarted) return;
            queued = true;
            grid.Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(() => { queued = false; Apply(); }));
        }
        private void Apply()
        {
            if (!GetGroupAmounts(grid) || !grid.IsReadOnly || grid.Items.OfType<ReportRow>().FirstOrDefault() is not { } sample) return;
            foreach (var column in grid.Columns.OfType<DataGridTextColumn>())
            {
                if (column.Binding is not Binding binding || binding.Converter is not null || binding.Source is not null ||
                    binding.RelativeSource is not null || !string.IsNullOrEmpty(binding.ElementName) || binding.ValidationRules.Count != 0) continue;
                var path = binding.Path?.Path;
                if (path is null || !path.StartsWith("Cells[", StringComparison.Ordinal) || !path.EndsWith("].DisplayText", StringComparison.Ordinal)) continue;
                if (!int.TryParse(path.AsSpan(6, path.Length - 19), out var index) || index < 0 || index >= sample.Cells.Count ||
                    sample.Cells[index].Kind != ReportValueKind.Amount) continue;
                // The source path and source values stay unchanged. Only the read-only display uses grouping.
                column.Binding = new Binding(path) { Mode = binding.Mode, UpdateSourceTrigger = binding.UpdateSourceTrigger,
                    Converter = GroupedAmount.Instance, FallbackValue = binding.FallbackValue, TargetNullValue = binding.TargetNullValue };
                if (grid.TryFindResource("AmountCell") is Style amountStyle) column.ElementStyle = amountStyle;
                column.MinWidth = Math.Max(column.MinWidth, 140);
                var headerStyle = new Style(typeof(DataGridColumnHeader), grid.TryFindResource(typeof(DataGridColumnHeader)) as Style);
                headerStyle.Setters.Add(new Setter(Control.HorizontalContentAlignmentProperty, HorizontalAlignment.Right));
                column.HeaderStyle = headerStyle;
            }
        }
    }
    private sealed class GroupedAmount : IValueConverter
    {
        public static readonly GroupedAmount Instance = new();
        public object? Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
            value is string text && decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture, out var amount) ? amount.ToString("N2", CultureInfo.InvariantCulture) : value;
        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => Binding.DoNothing;
    }
}
