using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ContextToAgent
{
    internal sealed class BridgeClient : IDisposable
    {
        private const string ServerName = "editor-context-visualstudio";
        private readonly string _instanceId;
        private readonly string _pipeName;
        private readonly object _syncRoot = new object();
        private readonly List<ReadRecordPayload> _recentReads = new List<ReadRecordPayload>();
        private EditorInstanceUpdate _latest;
        private bool _listening;
        private CancellationTokenSource _cts;
        private Task _listenTask;

        public BridgeClient(string instanceId)
        {
            _instanceId = instanceId;
            _pipeName = "context-to-agent-" + instanceId;
        }

        public string PipeName => _pipeName;
        public string AdapterScriptPath => Path.Combine(Path.GetDirectoryName(typeof(BridgeClient).Assembly.Location), "stdioAdapter.ps1");
        public string ProjectRoot => _latest?.ActiveWorkspaceRoot ?? _latest?.WorkspaceRoots?.FirstOrDefault();

        public Task EnsureIpcAsync()
        {
            lock (_syncRoot)
            {
                if (_listenTask != null && !_listenTask.IsCompleted)
                {
                    _listening = true;
                    return Task.CompletedTask;
                }

                _cts?.Cancel();
                _cts?.Dispose();
                _cts = new CancellationTokenSource();
                _listening = true;
                _listenTask = Task.Run(() => ListenAsync(_cts.Token));
            }

            return Task.CompletedTask;
        }

        public async Task UpsertInstanceAsync(EditorInstanceUpdate update)
        {
            _latest = update;
            await EnsureIpcAsync();
        }

        public async Task HeartbeatAsync()
        {
            await EnsureIpcAsync();
        }

        public async Task<bool> IsIpcHealthyAsync()
        {
            await Task.Yield();
            lock (_syncRoot)
            {
                return _listening && _listenTask != null && !_listenTask.IsCompleted;
            }
        }

        public async Task<IpcStatusPayload> StatusAsync()
        {
            await EnsureIpcAsync();
            List<ReadRecordPayload> recentReads;
            lock (_syncRoot)
            {
                recentReads = _recentReads.ToList();
            }

            return new IpcStatusPayload { PipeName = PipeName, AdapterScriptPath = AdapterScriptPath, RecentReads = recentReads };
        }

        private async Task ListenAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                NamedPipeServerStream pipe = null;
                try
                {
                    pipe = new NamedPipeServerStream(_pipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                    await pipe.WaitForConnectionAsync(token);
                    var connectedPipe = pipe;
                    pipe = null;
                    _ = Task.Run(() => HandlePipeAsync(connectedPipe));
                }
                catch
                {
                    pipe?.Dispose();
                    if (!token.IsCancellationRequested)
                    {
                        lock (_syncRoot)
                        {
                            _listening = false;
                        }
                    }
                    break;
                }
            }
        }

        private async Task HandlePipeAsync(NamedPipeServerStream pipe)
        {
            using (pipe)
            {
                var connectionId = Guid.NewGuid().ToString("N");
                var encoding = new UTF8Encoding(false);
                using (var reader = new StreamReader(pipe, encoding))
                using (var writer = new StreamWriter(pipe, encoding) { AutoFlush = true })
                {
                    while (pipe.IsConnected)
                    {
                        var line = await reader.ReadLineAsync();
                        if (line == null) break;
                        JToken response;
                        try
                        {
                            var payload = JToken.Parse(string.IsNullOrWhiteSpace(line) ? "{}" : line);
                            response = HandleJsonRpcPayload(payload, "stdio-client", connectionId);
                        }
                        catch (Exception error)
                        {
                            response = RpcError(null, -32700, error.Message);
                        }
                        if (response != null) await writer.WriteLineAsync(response.ToString(Formatting.None));
                    }
                }
            }
        }

        private JObject HandleJsonRpc(JObject message, string clientName, string connectionId)
        {
            var id = message["id"];
            var method = (string)message["method"];
            if (id == null) return null;
            if (method == "initialize") return RpcResult(id, new { protocolVersion = "2025-06-18", capabilities = new { tools = new { } }, serverInfo = new { name = ServerName, version = "0.1.15" } });
            if (method == "ping") return RpcResult(id, new { });
            if (method == "tools/list") return RpcResult(id, new { tools = ToolDefinitions() });
            if (method == "tools/call")
            {
                var toolName = (string)message["params"]?["name"];
                var effectiveClientName = (string)message["_clientName"] ?? clientName;
                var arguments = message["params"]?["arguments"] as JObject ?? new JObject();
                object data;
                if (toolName == "list_instances") data = new { instances = new[] { InstanceSummary() }, selectedInstanceId = _instanceId };
                else if (toolName == "get_context") data = GetContext();
                else if (toolName == "set_preferred_instance") data = new { ok = (string)arguments["instanceId"] == _instanceId, instanceId = _instanceId };
                else if (toolName == "clear_preferred_instance") data = new { ok = true };
                else return RpcError(id, -32602, "Unknown tool: " + toolName);
                RecordCall(effectiveClientName, toolName, connectionId);
                return RpcResult(id, new { content = new[] { new { type = "text", text = JsonConvert.SerializeObject(data, Formatting.Indented, JsonSettings.Value) } } });
            }
            return RpcError(id, -32601, "Unknown method: " + method);
        }

        private JToken HandleJsonRpcPayload(JToken payload, string clientName, string connectionId)
        {
            if (payload is JArray batch)
            {
                var responses = new JArray();
                foreach (var item in batch.OfType<JObject>())
                {
                    var response = HandleJsonRpc(item, clientName, connectionId);
                    if (response != null) responses.Add(response);
                }
                return responses.Count == 0 ? null : responses;
            }
            return payload is JObject message ? HandleJsonRpc(message, clientName, connectionId) : RpcError(null, -32600, "Invalid request");
        }

        private object GetContext()
        {
            var latest = _latest ?? new EditorInstanceUpdate { Source = "visual_studio", DisplayName = "Visual Studio", WorkspaceRoots = new List<string>(), Errors = new List<DiagnosticErrorPayload>(), LastActiveAt = DateTimeOffset.UtcNow };
            return new
            {
                schemaVersion = "1.0",
                status = "ready",
                instance = InstanceSummary(),
                workspaceRoots = latest.WorkspaceRoots,
                activeWorkspaceRoot = latest.ActiveWorkspaceRoot,
                activeFile = latest.ActiveFile,
                cursor = latest.Cursor,
                selection = latest.Selection,
                errors = latest.Errors
            };
        }

        private void RecordCall(string clientName, string toolName, string connectionId)
        {
            var latest = _latest ?? new EditorInstanceUpdate { Source = "visual_studio", DisplayName = "Visual Studio", WorkspaceRoots = new List<string>(), Errors = new List<DiagnosticErrorPayload>(), LastActiveAt = DateTimeOffset.UtcNow };
            lock (_syncRoot)
            {
                _recentReads.Add(new ReadRecordPayload
                {
                    ClientName = string.IsNullOrWhiteSpace(clientName) ? "mcp-client" : clientName,
                    ToolName = toolName,
                    ConnectionId = connectionId,
                    InstanceId = _instanceId,
                    ActiveFile = latest.ActiveFile,
                    ActiveWorkspaceRoot = latest.ActiveWorkspaceRoot,
                    SelectionEmpty = latest.Selection?.IsEmpty,
                    SelectionLength = latest.Selection?.Text?.Length ?? 0,
                    ErrorCount = latest.Errors?.Count ?? 0,
                    ReadAt = DateTimeOffset.UtcNow
                });
                while (_recentReads.Count > 50) _recentReads.RemoveAt(0);
            }
        }

        private object InstanceSummary()
        {
            var latest = _latest;
            return new
            {
                instanceId = _instanceId,
                source = latest?.Source ?? "visual_studio",
                displayName = latest?.DisplayName ?? "Visual Studio",
                workspaceRoots = latest?.WorkspaceRoots ?? new List<string>(),
                activeWorkspaceRoot = latest?.ActiveWorkspaceRoot,
                lastActiveAt = latest?.LastActiveAt ?? DateTimeOffset.UtcNow,
                stale = false
            };
        }

        private static object[] ToolDefinitions() => new object[]
        {
            new { name = "list_instances", description = "List the single editor instance served by this Visual Studio plugin.", inputSchema = EmptySchema() },
            new { name = "get_context", description = "Read the current editor context. Only selected text is returned.", inputSchema = EmptySchema() },
            new { name = "set_preferred_instance", description = "Compatibility no-op for plugin-local IPC.", inputSchema = new { type = "object", properties = new { instanceId = new { type = "string" } }, required = new[] { "instanceId" }, additionalProperties = false } },
            new { name = "clear_preferred_instance", description = "Compatibility no-op for plugin-local IPC.", inputSchema = EmptySchema() }
        };

        private static object EmptySchema() => new { type = "object", properties = new { }, additionalProperties = false };
        private static JObject RpcResult(JToken id, object result) => JObject.FromObject(new { jsonrpc = "2.0", id, result }, JsonSerializer.Create(JsonSettings.Value));
        private static JObject RpcError(JToken id, int code, string message) => JObject.FromObject(new { jsonrpc = "2.0", id, error = new { code, message } });

        public void Dispose()
        {
            lock (_syncRoot)
            {
                _cts?.Cancel();
                _cts?.Dispose();
                _cts = null;
                _listening = false;
                _listenTask = null;
            }
        }
    }
}
