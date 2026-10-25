using System.Globalization;
using System.IO;
using System.Text;

namespace Caiwu.Desktop.Presentation;

public static class CsvExporter
{
    public static void Write(string path, IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<object?>> rows)
    {
        using var writer = new StreamWriter(path, false, new UTF8Encoding(true));
        writer.WriteLine(string.Join(",", headers.Select(EncodeText)));
        foreach (var row in rows)
            writer.WriteLine(string.Join(",", row.Select(Encode)));
    }

    private static string Encode(object? value) => value switch
    {
        null => "",
        decimal money => money.ToString("0.00", CultureInfo.InvariantCulture),
        int number => number.ToString(CultureInfo.InvariantCulture),
        long number => number.ToString(CultureInfo.InvariantCulture),
        DateOnly date => EncodeText(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        _ => EncodeText(Convert.ToString(value, CultureInfo.CurrentCulture) ?? "")
    };

    private static string EncodeText(string text)
    {
        // Treat user-entered summaries as text when a spreadsheet opens the CSV.
        var first = text.TrimStart();
        if (first.Length > 0 && "=+-@".Contains(first[0])) text = "'" + text;
        return "\"" + text.Replace("\"", "\"\"") + "\"";
    }
}
