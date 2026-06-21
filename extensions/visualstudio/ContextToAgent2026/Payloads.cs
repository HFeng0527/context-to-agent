using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ContextToAgent2026
{
    internal static class JsonSettings
    {
        public static readonly JsonSerializerSettings Value = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy() }
        };
    }

    internal sealed class EditorInstanceUpdate
    {
        public string Source { get; set; }
        public string DisplayName { get; set; }
        public List<string> WorkspaceRoots { get; set; }
        public string ActiveWorkspaceRoot { get; set; }
        public string ActiveFile { get; set; }
        public PositionPayload Cursor { get; set; }
        public SelectionPayload Selection { get; set; }
        public List<DiagnosticErrorPayload> Errors { get; set; }
        public List<string> OpenFiles { get; set; }
        public DateTimeOffset LastActiveAt { get; set; }
    }
    internal sealed class PositionPayload { public int Line { get; set; } public int Character { get; set; } }
    internal sealed class RangePayload { public PositionPayload Start { get; set; } public PositionPayload End { get; set; } }
    internal sealed class SelectionPayload { public bool IsEmpty { get; set; } public PositionPayload Start { get; set; } public PositionPayload End { get; set; } public string Text { get; set; } }
    internal sealed class DiagnosticErrorPayload { public string File { get; set; } public RangePayload Range { get; set; } public string Message { get; set; } public string Code { get; set; } public string Source { get; set; } }
    internal sealed class IpcStatusPayload
    {
        public string PipeName { get; set; }
        public string AdapterScriptPath { get; set; }
        public List<ReadRecordPayload> RecentReads { get; set; } = new List<ReadRecordPayload>();
        public string[] RecentReadLabels() => RecentReads == null || RecentReads.Count == 0 ? new[] { "No reads yet" } : RecentReads.Select(read => $"{read.ClientName} {read.ToolName ?? "tools/call"} at {read.ReadAt} | file: {ShortName(read.ActiveFile) ?? "none"} | workspace: {ShortName(read.ActiveWorkspaceRoot) ?? "none"} | selection: {(read.SelectionEmpty == false ? read.SelectionLength.ToString() : "empty")} | errors: {read.ErrorCount}").ToArray();
        private static string ShortName(string value) => string.IsNullOrWhiteSpace(value) ? null : Path.GetFileName(value.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
    }
    internal sealed class ReadRecordPayload
    {
        public string ClientName { get; set; }
        public string ToolName { get; set; }
        public string ConnectionId { get; set; }
        public DateTimeOffset ReadAt { get; set; }
        public string InstanceId { get; set; }
        public string ActiveFile { get; set; }
        public string ActiveWorkspaceRoot { get; set; }
        public bool? SelectionEmpty { get; set; }
        public int SelectionLength { get; set; }
        public int ErrorCount { get; set; }
    }
}
