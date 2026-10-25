using System.IO;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Caiwu.Contracts;

// Expected persisted audit wire-format hash over an independently captured read-only snapshot.
// Does not invoke copying, refresh mutation context, or write a product ledger.
internal static class ProvenanceFingerprint
{
    public static string Compute(LedgerSnapshot s)
    {
        using var stream = new MemoryStream();
        using (var json = new Utf8JsonWriter(stream))
        {
            json.WriteStartArray();
            json.WriteNumberValue(s.Revision);
            json.WriteStringValue(s.Book.Id);
            json.WriteStringValue(s.Book.Name);
            json.WriteNumberValue((int)s.Book.Regime);
            json.WriteStringValue(s.Book.TemplateVersion);
            json.WriteNumberValue(s.Book.FiscalYear);
            json.WriteNumberValue(s.Book.StartMonth);
            json.WriteNumberValue(s.Book.ClosedThroughMonth);
            json.WriteStringValue(s.Book.CreatedAt.ToString("O", CultureInfo.InvariantCulture));
            json.WriteStartArray();
            foreach (var a in s.Accounts)
            {
                json.WriteStartArray();
                json.WriteStringValue(a.Code); json.WriteStringValue(a.Name); json.WriteStringValue(a.ParentCode);
                json.WriteNumberValue((int)a.Direction); json.WriteBooleanValue(a.IsActive);
                Money(json, a.OpeningDebit); Money(json, a.OpeningCredit);
                json.WriteEndArray();
            }
            json.WriteEndArray(); json.WriteStartArray();
            foreach (var v in s.Vouchers)
            {
                json.WriteStartArray();
                json.WriteStringValue(v.Id); json.WriteStringValue(v.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
                json.WriteStringValue(v.Kind); json.WriteNumberValue(v.Number); json.WriteNumberValue(v.AttachmentCount);
                json.WriteStringValue(v.PreparedBy); json.WriteStringValue(v.ReviewedBy); json.WriteNumberValue((int)v.Status);
                json.WriteStartArray();
                foreach (var line in v.Lines)
                {
                    json.WriteStartArray();
                    json.WriteStringValue(line.AccountCode); json.WriteStringValue(line.Summary);
                    Money(json, line.Debit); Money(json, line.Credit);
                    json.WriteEndArray();
                }
                json.WriteEndArray(); json.WriteEndArray();
            }
            json.WriteEndArray(); json.WriteStartArray();
            foreach (var a in s.AuditEvents)
            {
                json.WriteStartArray();
                json.WriteStringValue(a.Id); json.WriteStringValue(a.At.ToString("O", CultureInfo.InvariantCulture));
                json.WriteStringValue(a.OperatorName); json.WriteStringValue(a.Action);
                if (a.VoucherId.HasValue) json.WriteStringValue(a.VoucherId.Value); else json.WriteNullValue();
                json.WriteStringValue(a.Detail); json.WriteEndArray();
            }
            json.WriteEndArray(); json.WriteEndArray();
        }
        return Convert.ToHexStringLower(SHA256.HashData(stream.ToArray()));
    }

    private static void Money(Utf8JsonWriter writer, decimal amount) =>
        writer.WriteStringValue(amount.ToString("G29", CultureInfo.InvariantCulture));

}
