using System.Text;
using System.IO;
using System.Text.Json;
using System.Text.Encodings.Web;
using PbdViewer.DataModel;
using PbdViewer.Uitils;
using PbdViewer.Uitils.PbClass;

internal static class Program
{
    static readonly JsonSerializerOptions Options = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, MaxDepth = 256 };
    static readonly HashSet<string> Omit = new(StringComparer.OrdinalIgnoreCase) { "all instance variables", "all functions and events" };

    [STAThread]
    static int Main(string[] args)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        if (args.Length < 3) { Console.Error.WriteLine("Usage: PbdViewer <product> <input-exe> <output-dir> [entry-filter]"); return 2; }
        string product = args[0], input = Path.GetFullPath(args[1]), output = Path.GetFullPath(args[2]);
        Directory.CreateDirectory(output);
        string filter = args.Length > 3 ? args[3] : null;
        try
        {
            Console.WriteLine($"Loading {product}/{Path.GetFileName(input)}");
            var project = new PbProject(input);
            var files = new List<object>();
            int success = 0, failed = 0, dwCount = 0;
            foreach (var library in project.Files)
            {
                var entries = new List<object>();
                foreach (var entry in library.Entries)
                {
                    if (filter != null && !entry.EntryName.Contains(filter, StringComparison.OrdinalIgnoreCase)) continue;
                    try
                    {
                        string rawPath = null;
                        if (entry.Suffix == "dwo")
                        {
                            rawPath = Path.Combine("datawindows", Safe(library.FileName), Safe(entry.EntryName) + ".bin");
                            WriteBytes(Path.Combine(output, rawPath), entry._entryData);
                            dwCount++;
                        }
                        var root = new EntryNode(entry);
                        var node = ExportNode(root, entry.EntryName);
                        var objects = entry.Objects.Values.Select(ExportObject).ToArray();
                        string variableBufferPath = null;
                        if (entry.VariableBuffer != null)
                        {
                            variableBufferPath = Path.Combine("buffers", Safe(library.FileName), Safe(entry.EntryName) + ".variables.bin");
                            WriteBytes(Path.Combine(output, variableBufferPath), entry.VariableBuffer);
                        }
                        string textPath = Path.Combine("text", Safe(library.FileName), Safe(entry.EntryName) + ".txt");
                        var sb = new StringBuilder();
                        WriteNodeText(root, entry.EntryName, sb);
                        foreach (var obj in entry.Objects.Values)
                        {
                            if (obj.Functions == null) continue;
                            foreach (var function in obj.Functions)
                            {
                                try
                                {
                                    function.Definition = obj.FunctionDefinitions[function.Index];
                                    sb.AppendLine($"\n### object-functions/{obj.Type.Name}/{function.Definition.Name}");
                                    sb.AppendLine(new FunctionNode(function).Text);
                                }
                                catch (Exception ex) { sb.AppendLine($"FUNCTION_EXPORT_ERROR {obj.Type.Name}/{function.Index}: {ex.Message}"); }
                            }
                        }
                        WriteText(Path.Combine(output, textPath), sb.ToString());
                        entries.Add(new { name = entry.EntryName, suffix = entry.Suffix, byte_length = entry._entryData.Length,
                            status = entry.Suffix == "dwo" ? "raw_exported_not_decoded_by_pbdviewer" : "exported", raw_path = rawPath,
                            text_path = textPath, variable_buffer_path = variableBufferPath, node, objects,
                            entry_object = entry.EntryObject?.Type?.Name });
                        success++;
                    }
                    catch (Exception ex)
                    {
                        entries.Add(new { name = entry.EntryName, suffix = entry.Suffix, byte_length = entry._entryData.Length, status = "failed", error = ex.ToString() });
                        failed++;
                        Console.Error.WriteLine($"ERROR {library.FileName}/{entry.EntryName}: {ex.Message}");
                    }
                }
                string relative = Path.Combine("libraries", Safe(library.FileName) + ".json");
                WriteJson(Path.Combine(output, relative), new { product, executable = Path.GetFileName(input), library = library.FileName, path = library.FilePath, entries });
                files.Add(new { name = library.FileName, path = library.FilePath, json_path = relative, entry_count = library.Entries.Count, exported_count = entries.Count });
                Console.WriteLine($"{library.FileName}: {entries.Count}/{library.Entries.Count} entries");
            }
            WriteJson(Path.Combine(output, "project.json"), new
            {
                schema_version = 1, exporter_revision = "2026.10.25.5", tool = "PbdViewer", tool_commit = "b46fd3e42b8f26ed18a547b9e4bec47f96530a86", product,
                executable = Path.GetFileName(input), input, input_kind = Path.GetExtension(input).Equals(".exe", StringComparison.OrdinalIgnoreCase) ? "executable" : "standalone_library", pb_version = project.Version, is_unicode = project.IsUnicode,
                encoding = project.IsUnicode ? "UTF-16LE" : "GBK/CP936", omitted_node_names = Omit.ToArray(),
                portability_fixes = new[] { "ANSI decoded as CP936", "system resources from output resoures directory", "compiler temporary-name comparisons use Ordinal", "ANSI embedded-SQL parameter byte positions mapped to decoded characters", "event-return wrappers folded to explicit return instead of deleted", "pre-reconstruction control-flow statements retained", "SQL cursor declarations retained even when compiler cursor name is temporary" },
                files, requested_libraries = project.RequestedLibraries, missing_libraries = project.MissingLibraries,
                selected_objects = project.Objects.Select(x => new { name = x.Key, library = x.Value.Entry.File.FileName, entry = x.Value.Entry.EntryName, object_name = x.Value.Type.Name }).ToArray(),
                statistics = new { success, failed, datawindows = dwCount, pcode_count = PCodeHelper.Count, pcode_good_count = PCodeHelper.Goodcount,
                    used_opcodes = PCodeHelper.UsedPCodeList.ToDictionary(x => x.Key.ToString(), x => x.Value.OrderBy(v => v).ToArray()),
                    unparsed_opcodes = PCodeHelper.UnParsedPCodeList.ToDictionary(x => x.Key.ToString(), x => x.Value.OrderBy(v => v).ToArray()) }
            });
            Console.WriteLine($"DONE success={success}, failed={failed}, raw_dwo={dwCount}, missing_libraries={project.MissingLibraries.Count}");
            return failed == 0 ? 0 : 1;
        }
        catch (Exception ex)
        {
            WriteJson(Path.Combine(output, "fatal.json"), new { product, executable = Path.GetFileName(input), status = "project_failed", error = ex.ToString() });
            Console.Error.WriteLine(ex);
            return 3;
        }
    }

    static object ExportNode(TreeNode node, string path) => new
    {
        name = node.Name, text = node.Text, node_type = node.NodeType.ToString(), path,
        children = node.Children.Where(n => !Omit.Contains(n.Name ?? "")).Select(n => ExportNode(n, path + "/" + n.Name)).ToArray()
    };

    static object Location(PbObject obj) => obj == null ? null : new { library = obj.Entry.File.FileName, entry = obj.Entry.EntryName, name = obj.Type.Name };

    static object ExportObject(PbObject obj)
    {
        var functions = new List<object>();
        if (obj.Functions != null)
        foreach (var function in obj.Functions)
        {
            try
            {
                function.Definition = obj.FunctionDefinitions[function.Index];
                int countBefore = PCodeHelper.Count.GetValueOrDefault(obj.Project.Version);
                int goodBefore = PCodeHelper.Goodcount.GetValueOrDefault(obj.Project.Version);
                int errorBefore = PCodeHelper.DiagnosticErrors.Count;
                string text = new FunctionNode(function).Text;
                string rawControlFlow = PCodeHelper.PreReconstructionFlow.GetValueOrDefault(function.ToString());
                int countDelta = PCodeHelper.Count.GetValueOrDefault(obj.Project.Version) - countBefore;
                int goodDelta = PCodeHelper.Goodcount.GetValueOrDefault(obj.Project.Version) - goodBefore;
                string[] warnings = text.Split('\n').Where(s => s.TrimStart().StartsWith("--")).ToArray();
                bool partial = function.PCodeBytes.Length > 0 && (goodDelta < countDelta || warnings.Length > 0);
                string[] diagnostics = PCodeHelper.DiagnosticErrors.Skip(errorBefore).ToArray();
                string disassembly = null;
                string recoveredText = null;
                string[] recoveryDiagnostics = null;
                if (partial && diagnostics.Any(d => d.Contains("PushInstanceVariableName", StringComparison.Ordinal)))
                {
                    int recoveryBefore = PCodeHelper.DiagnosticErrors.Count;
                    try { obj.Project.RecoverEmbeddedMemberNames = true; recoveredText = new FunctionNode(function).Text; }
                    catch (Exception ex) { recoveredText = "RECOVERY_EXPORT_ERROR: " + ex; }
                    finally { obj.Project.RecoverEmbeddedMemberNames = false; }
                    recoveryDiagnostics = PCodeHelper.DiagnosticErrors.Skip(recoveryBefore).ToArray();
                }
                if (partial)
                {
                    bool oldDebug = obj.Project.IsDebug;
                    try { obj.Project.IsDebug = true; disassembly = new FunctionNode(function).Text; }
                    catch (Exception ex) { disassembly = "DEBUG_EXPORT_ERROR: " + ex; }
                    finally { obj.Project.IsDebug = oldDebug; }
                }
                functions.Add(new { index = function.Index, name = function.Definition.Name, is_event = function.Definition.IsEvent,
                    is_external = function.Definition.IsExternal, declaration = function.Definition.ToString(), text,
                    status = partial ? "partial_pcode" : "exported", pcode_byte_length = function.PCodeBytes.Length,
                    pcode_count_delta = countDelta, pcode_good_count_delta = goodDelta,
                    diagnostics, warning_lines = warnings, diagnostic_disassembly = disassembly,
                    raw_control_flow = rawControlFlow,
                    sql_declarations = function.Variables.Where(v => v.SqlDeclaration != null).Select(v => v.SqlDeclaration).Distinct().ToArray(),
                    local_variables = function.Variables.Select(v => Variable(v, function.Buffer)).ToArray(),
                    recovered_text = recoveredText, recovery_diagnostics = recoveryDiagnostics,
                    pcode_base64 = partial ? Convert.ToBase64String(function.PCodeBytes) : null,
                    buffer_base64 = partial ? Convert.ToBase64String(function.Buffer) : null });
            }
            catch (Exception ex) { functions.Add(new { index = function.Index, name = function.Definition?.Name, status = "failed", error = ex.ToString() }); }
        }
        return new
        {
            name = obj.Type.Name, index = obj.Index, type_index = obj.Type.Index,
            inherit_type = obj.InheritType?.Name, inherit_from = Location(obj.InheritObject), parent_type = obj.ParentType?.Name, parent = Location(obj.ParentObject),
            variables = (obj.Variables ?? Array.Empty<PbVariable>()).Select(v => Variable(v, obj.Entry.VariableBuffer)).ToArray(),
            functions,
            declarations = (obj.FunctionDefinitions ?? Array.Empty<PbFunctionDefinition>()).Where(f => f != null).Select(f => new { name = f.Name, index = f.Index, global_index = f.GlobalIndex, is_event = f.IsEvent, is_external = f.IsExternal, declaration = f.ToString(), library = f.Library, alias = f.Alias }).ToArray(),
            references = (obj.ReferencedFunctions ?? Array.Empty<PbReferencedFunction>()).Select(f => new { name = f.Name, index = f.Index, global_index = f.GlobalIndex, is_global_function = f.IsGlobalFunction }).ToArray()
        };
    }

    static object Variable(PbVariable variable, byte[] buffer)
    {
        string rendered;
        try { rendered = variable.ToString(buffer); } catch (Exception ex) { rendered = "EXPORT_ERROR: " + ex.Message; }
        return new { name = variable.Name, type = variable.Type?.Name, index = variable.Index, is_instance = variable.IsInstance, is_shared = variable.IsShared, is_constant = variable.IsConstant,
            array = variable.ArrayString, access = variable.AccessString, rendered };
    }

    static void WriteNodeText(TreeNode node, string path, StringBuilder sb)
    {
        sb.AppendLine("### " + path);
        if (!string.IsNullOrEmpty(node.Text)) sb.AppendLine(node.Text);
        foreach (var child in node.Children.Where(n => !Omit.Contains(n.Name ?? ""))) WriteNodeText(child, path + "/" + child.Name, sb);
    }
    static string Safe(string name) => string.Concat(name.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
    static void WriteJson(string path, object value) => WriteText(path, JsonSerializer.Serialize(value, Options));
    static void WriteText(string path, string text) { Directory.CreateDirectory(Path.GetDirectoryName(path)); string temp = path + ".writing"; File.WriteAllText(temp, text, new UTF8Encoding(false)); File.Move(temp, path, true); }
    static void WriteBytes(string path, byte[] bytes) { Directory.CreateDirectory(Path.GetDirectoryName(path)); string temp = path + ".writing"; File.WriteAllBytes(temp, bytes); File.Move(temp, path, true); }
}
