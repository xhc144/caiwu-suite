using System.Text.Json;
using Caiwu.Delivery;
using Caiwu.Delivery.Modules;

// A separate composition executable avoids a Delivery <-> Modules reference cycle.
// The NSIS engine and installed launcher use this host, never the legacy codec-free CLI.
try
{
    if (args.Length == 0) throw new ArgumentException("Delivery commands require positional arguments.");
    switch (args[0])
    {
        case "manifest" when args.Length == 4:
            PayloadManifest.Create(args[1], args[2], args[3]).Write(Path.Combine(args[1], PayloadManifest.FileName)); break;
        case "verify" when args.Length == 2:
            PayloadManifest.Read(Path.Combine(args[1], PayloadManifest.FileName)).Verify(args[1]); break;
        case "install" when args.Length == 4:
            // These adapters hold paths only. Installation owns the real install/data leases.
            Installation.Install(args[1], args[2], args[3], moduleCodecs: [
                new SummaryAttachmentCodec(args[3]), new ClassificationAttachmentCodec(),
                new CostWorksheetAttachmentCodec(), new ReportTemplateAttachmentCodec()]); break;
        case "uninstall" when args.Length == 2:
            Installation.Uninstall(args[1]); break;
        case "launch" when args.Length >= 2:
            return Installation.Launch(args[1], args.Skip(2).ToArray());
        case "launch-managed" when args.Length >= 2:
            // Explicit handoff: validation handles are released before the child
            // revalidates its active executable/receipts and owns both real leases.
            return ManagedDesktopLaunch.Launch(args[1], args.Skip(2).ToArray());
        case "inspect-book" when args.Length == 3:
            Write(BookOperations.Inspect(args[1], args[2])); break;
        case "backup-book" when args.Length == 4:
            Write(BookOperations.Backup(args[1], args[2], args[3])); break;
        case "restore-book" when args.Length == 4:
            Write(BookOperations.Restore(args[1], args[2], args[3])); break;
        case "check-update" when args.Length == 3:
        case "stage-update" when args.Length == 4:
            var policy = JsonSerializer.Deserialize<UpdatePolicy>(File.ReadAllText(args[1]), PayloadManifest.Json) ?? throw new InvalidDataException("No update policy.");
            if (!policy.Enabled) { Write(new { status = "disabled", reason = "Trusted channel and signing prerequisite" }); break; }
            using (var client = new UpdateClient())
            {
                var candidate = await client.CheckAsync(policy, args[2]);
                if (candidate == null) Write(new { status = "current" });
                else if (args[0] == "check-update") Write(new { status = "available", candidate });
                else Write(new { status = "hash-verified-awaiting-authenticode", candidate, path = await client.DownloadAsync(policy, candidate, args[2], args[3]) });
            }
            break;
        default: throw new ArgumentException("Invalid command arguments.");
    }
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine(error.Message);
    return 1;
}

static void Write(object value) => Console.WriteLine(JsonSerializer.Serialize(value, PayloadManifest.Json));
