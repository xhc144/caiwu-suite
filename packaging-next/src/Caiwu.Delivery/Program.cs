using System.Text.Json;
using Caiwu.Delivery;

try
{
    if (args.Length == 0) throw new ArgumentException("Commands: manifest, verify, install, uninstall, launch, launch-managed, inspect-book, backup-book, restore-book, check-update, stage-update. Arguments are positional; see packaging-next/README.md.");
    switch (args[0])
    {
        case "manifest" when args.Length == 4:
            PayloadManifest.Create(args[1], args[2], args[3]).Write(Path.Combine(args[1], PayloadManifest.FileName)); break;
        case "verify" when args.Length == 2:
            PayloadManifest.Read(Path.Combine(args[1], PayloadManifest.FileName)).Verify(args[1]); break;
        case "install" when args.Length == 4:
            Installation.Install(args[1], args[2], args[3]); break;
        case "uninstall" when args.Length == 2:
            Installation.Uninstall(args[1]); break;
        case "launch-managed" when args.Length >= 2:
            return ManagedDesktopLaunch.Launch(args[1], args.Skip(2).ToArray());
        case "launch" when args.Length >= 2:
            return Installation.Launch(args[1], args.Skip(2).ToArray());
        case "inspect-book" when args.Length == 3:
            Console.WriteLine(JsonSerializer.Serialize(BookOperations.Inspect(args[1], args[2]), PayloadManifest.Json)); break;
        case "backup-book" when args.Length == 4:
            Console.WriteLine(JsonSerializer.Serialize(BookOperations.Backup(args[1], args[2], args[3]), PayloadManifest.Json)); break;
        case "restore-book" when args.Length == 4:
            Console.WriteLine(JsonSerializer.Serialize(BookOperations.Restore(args[1], args[2], args[3]), PayloadManifest.Json)); break;
        case "check-update" when args.Length == 3:
        case "stage-update" when args.Length == 4:
            var policy = JsonSerializer.Deserialize<UpdatePolicy>(File.ReadAllText(args[1]), PayloadManifest.Json) ?? throw new InvalidDataException("No update policy.");
            if (!policy.Enabled) { Console.WriteLine("{\"status\":\"disabled\",\"reason\":\"Trusted channel and signing prerequisite\"}"); break; }
            using (var client = new UpdateClient())
            {
                var candidate = await client.CheckAsync(policy, args[2]);
                if (candidate == null) Console.WriteLine("{\"status\":\"current\"}");
                else if (args[0] == "check-update") Console.WriteLine(JsonSerializer.Serialize(new { status = "available", candidate }, PayloadManifest.Json));
                else Console.WriteLine(JsonSerializer.Serialize(new { status = "hash-verified-awaiting-authenticode", candidate, path = await client.DownloadAsync(policy, candidate, args[2], args[3]) }, PayloadManifest.Json));
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
