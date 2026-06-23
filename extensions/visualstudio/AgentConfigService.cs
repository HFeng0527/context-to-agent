using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace ContextToAgent
{
    internal sealed class AgentConfigService
    {
        private const string ServerName = "editor-context";
        private const string OwnedMarker = "context-to-agent managed stdio";
        private const string SettingsFileName = "agent-paths.json";

        public IReadOnlyList<AgentStatus> Statuses(BridgeClient bridgeClient)
        {
            return Agents(bridgeClient).Select(agent => new AgentStatus
            {
                Id = agent.Id,
                Name = agent.Name,
                Scope = agent.Scope,
                ConfigPath = string.IsNullOrWhiteSpace(agent.ConfigPath) ? "Open a project first" : agent.ConfigPath,
                StatusKey = string.IsNullOrWhiteSpace(agent.ConfigPath) ? "unavailable" : IsConfigured(agent) ? "configured" : File.Exists(agent.ConfigPath) ? "detected" : "notFound"
            }).ToList();
        }

        public void SaveConfigPaths(IEnumerable<AgentStatus> statuses, BridgeClient bridgeClient)
        {
            var defaults = DefaultAgents(bridgeClient).ToDictionary(agent => agent.Id, agent => agent.ConfigPath, StringComparer.OrdinalIgnoreCase);
            var overrides = new JObject();
            foreach (var status in statuses ?? Enumerable.Empty<AgentStatus>())
            {
                if (string.IsNullOrWhiteSpace(status.Id)) continue;
                var path = NormalizeEditablePath(status.ConfigPath);
                if (string.IsNullOrWhiteSpace(path)) continue;
                if (defaults.TryGetValue(status.Id, out var defaultPath) && string.Equals(path, defaultPath, StringComparison.OrdinalIgnoreCase)) continue;
                overrides[status.Id] = path;
            }

            var root = SettingsJson();
            root["pathOverrides"] = overrides;
            WriteSettingsJson(root);
        }

        public void SaveConfigPath(AgentStatus status, BridgeClient bridgeClient)
        {
            if (status == null || string.IsNullOrWhiteSpace(status.Id)) return;
            var defaults = DefaultAgents(bridgeClient).ToDictionary(agent => agent.Id, agent => agent.ConfigPath, StringComparer.OrdinalIgnoreCase);
            var root = SettingsJson();
            var overrides = root["pathOverrides"] as JObject ?? new JObject();
            var path = NormalizeEditablePath(status.ConfigPath);
            if (string.IsNullOrWhiteSpace(path) || (defaults.TryGetValue(status.Id, out var defaultPath) && string.Equals(path, defaultPath, StringComparison.OrdinalIgnoreCase)))
            {
                overrides.Remove(status.Id);
            }
            else
            {
                overrides[status.Id] = path;
            }

            root["pathOverrides"] = overrides;
            WriteSettingsJson(root);
        }

        public void ResetConfigPath(string agentId)
        {
            if (string.IsNullOrWhiteSpace(agentId)) return;
            var root = SettingsJson();
            if (root["pathOverrides"] is JObject overrides)
            {
                overrides.Remove(agentId);
                root["pathOverrides"] = overrides;
                WriteSettingsJson(root);
            }
        }

        public string LanguageMode()
        {
            var value = (string)SettingsJson()["language"];
            return value == "en" || value == "zh-CN" ? value : "auto";
        }

        public void SetLanguageMode(string language)
        {
            var root = SettingsJson();
            root["language"] = language == "en" || language == "zh-CN" ? language : "auto";
            WriteSettingsJson(root);
        }

        public string ResolvedLanguage()
        {
            var mode = LanguageMode();
            if (mode == "zh-CN" || (mode == "auto" && CultureInfo.CurrentUICulture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase))) return "zh-CN";
            return "en";
        }

        public void ConfigureAll(BridgeClient bridgeClient)
        {
            foreach (var agent in Agents(bridgeClient).Where(candidate => !string.IsNullOrWhiteSpace(candidate.ConfigPath)))
            {
                EnsureParent(agent.ConfigPath);
                if (agent.Kind == "opencode-json") UpsertOpenCodeJson(agent);
                if (agent.Kind == "codex-toml") UpsertCodexToml(agent);
                if (agent.Kind == "mcp-json" || agent.Kind == "claude-desktop-json") UpsertMcpJson(agent);
            }
        }

        public void ConfigureAgent(BridgeClient bridgeClient, string agentId)
        {
            var agent = Agents(bridgeClient).FirstOrDefault(candidate => string.Equals(candidate.Id, agentId, StringComparison.OrdinalIgnoreCase));
            if (agent == null || string.IsNullOrWhiteSpace(agent.ConfigPath)) return;
            EnsureParent(agent.ConfigPath);
            if (agent.Kind == "opencode-json") UpsertOpenCodeJson(agent);
            if (agent.Kind == "codex-toml") UpsertCodexToml(agent);
            if (agent.Kind == "mcp-json" || agent.Kind == "claude-desktop-json") UpsertMcpJson(agent);
        }

        public void RevokeAll(BridgeClient bridgeClient)
        {
            foreach (var agent in Agents(bridgeClient).Where(candidate => !string.IsNullOrWhiteSpace(candidate.ConfigPath)))
            {
                if (!File.Exists(agent.ConfigPath)) continue;
                if (agent.Kind == "opencode-json") RemoveOpenCodeJson(agent.ConfigPath);
                if (agent.Kind == "codex-toml") RemoveToml(agent.ConfigPath);
                if (agent.Kind == "mcp-json" || agent.Kind == "claude-desktop-json") RemoveMcpJson(agent.ConfigPath);
            }
        }

        public void RevokeAgent(BridgeClient bridgeClient, string agentId)
        {
            var agent = Agents(bridgeClient).FirstOrDefault(candidate => string.Equals(candidate.Id, agentId, StringComparison.OrdinalIgnoreCase));
            if (agent == null || string.IsNullOrWhiteSpace(agent.ConfigPath) || !File.Exists(agent.ConfigPath)) return;
            if (agent.Kind == "opencode-json") RemoveOpenCodeJson(agent.ConfigPath);
            if (agent.Kind == "codex-toml") RemoveToml(agent.ConfigPath);
            if (agent.Kind == "mcp-json" || agent.Kind == "claude-desktop-json") RemoveMcpJson(agent.ConfigPath);
        }

        public string ConfigureOtherAgentsText(BridgeClient bridgeClient, string language = null)
        {
            var command = PowerShellPath();
            var args = AdapterArgs(bridgeClient, "Your Agent Name");
            var genericJson = new JObject
            {
                ["mcpServers"] = new JObject
                {
                    [ServerName] = new JObject
                    {
                        ["type"] = "stdio",
                        ["command"] = command,
                        ["args"] = new JArray(args)
                    }
                }
            }.ToString(Formatting.Indented);

            if (language == "zh-CN")
            {
                return string.Join(Environment.NewLine + Environment.NewLine, new[]
                {
                    "配置其他 Agent",
                    "1. 添加一个名为 editor-context 的 MCP server。",
                    "2. 使用 stdio 传输。",
                    "3. 使用下面 JSON 里的 command 和 args。",
                    "4. 将 Your Agent Name 替换为你希望在读取记录里看到的 Agent 名称。",
                    "5. 保存 Agent 配置后重启该 Agent。",
                    "常见坑：",
                    "- 不要使用 HTTP URL；这个桥接只支持 stdio。",
                    "- Agent 使用该 MCP server 时需要保持 Visual Studio 打开。",
                    "- 如果 Agent 支持 command/args 分离配置，请保持 command 和 args 分开。",
                    "- Visual Studio 桥接使用 PowerShell adapter，不要添加 ELECTRON_RUN_AS_NODE。",
                    "- 如果 Agent 需要 env，JSON 配置通常使用 env 对象，Codex TOML 使用 [mcp_servers.editor-context.env]。env 要和 args 分开。",
                    "- 有些 Agent 要求 type = stdio，Claude Desktop 的 stdio 项通常不写 type。若客户端拒绝配置，请检查它的 MCP schema。",
                    "- 如果 Agent 把 command 和 args 存成单个 shell 字符串，路径里有空格时要加引号。",
                    genericJson
                });
            }

            return string.Join(Environment.NewLine + Environment.NewLine, new[]
            {
                "Configure other agents",
                "1. Add a new MCP server named editor-context.",
                "2. Use stdio transport.",
                "3. Use the command and args from the JSON below.",
                "4. Replace Your Agent Name with the agent name you want to see in call records.",
                "5. Save the agent config and restart that agent.",
                "Common pitfalls:",
                "- Do not use an HTTP URL; this bridge is stdio-only.",
                "- Keep Visual Studio open while the agent uses this MCP server.",
                "- Keep command and args separate when the agent supports that shape.",
                "- Do not add ELECTRON_RUN_AS_NODE for this Visual Studio bridge; it uses the bundled PowerShell adapter, not VS Code/Electron.",
                "- If an agent requires env values, JSON configs usually use an env object, while Codex TOML uses [mcp_servers.editor-context.env]. Keep env separate from args.",
                "- Some agents require type = stdio, while Claude Desktop stdio entries omit type. If a client rejects the config, check its expected MCP schema.",
                "- Quote paths if an agent stores command and args as one shell string.",
                genericJson
            });
        }

        private static IReadOnlyList<AgentDefinition> Agents(BridgeClient bridgeClient)
        {
            var overrides = PathOverrides();
            return DefaultAgents(bridgeClient).Select(agent =>
            {
                if (overrides.TryGetValue(agent.Id, out var overridePath) && !string.IsNullOrWhiteSpace(overridePath))
                {
                    return agent.WithConfigPath(ResolveConfigPath(overridePath));
                }
                return agent;
            }).ToList();
        }

        private static IReadOnlyList<AgentDefinition> DefaultAgents(BridgeClient bridgeClient)
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var command = PowerShellPath();

            return new[]
            {
                new AgentDefinition("codex", "Codex", "codex-toml", "global", Path.Combine(home, ".codex", "config.toml"), command, AdapterArgs(bridgeClient, "Codex")),
                new AgentDefinition("opencode", "OpenCode", "opencode-json", "global", Path.Combine(appData, "opencode", "opencode.json"), command, AdapterArgs(bridgeClient, "OpenCode")),
                new AgentDefinition("claude-code", "Claude Code CLI", "mcp-json", "global", Path.Combine(home, ".claude.json"), command, AdapterArgs(bridgeClient, "Claude Code CLI")),
                new AgentDefinition("claude-desktop", "Claude Desktop", "claude-desktop-json", "global", ClaudeDesktopPath(localAppData), command, AdapterArgs(bridgeClient, "Claude Desktop"))
            };
        }

        private static Dictionary<string, string> PathOverrides()
        {
            try
            {
                var json = SettingsJson();
                return (json["pathOverrides"] as JObject)?.Properties().ToDictionary(property => property.Name, property => (string)property.Value, StringComparer.OrdinalIgnoreCase) ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }
            catch
            {
                return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }
        }

        private static string NormalizeEditablePath(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || string.Equals(value, "Open a project first", StringComparison.OrdinalIgnoreCase)) return string.Empty;
            return ResolveConfigPath(value);
        }

        private static string ResolveConfigPath(string value)
        {
            var trimmed = (value ?? string.Empty).Trim();
            if (trimmed == "~") return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (trimmed.StartsWith("~" + Path.DirectorySeparatorChar, StringComparison.Ordinal) || trimmed.StartsWith("~" + Path.AltDirectorySeparatorChar, StringComparison.Ordinal))
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), trimmed.Substring(2));
            }
            return Environment.ExpandEnvironmentVariables(trimmed);
        }

        private static string SettingsFilePath()
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, "ContextToAgent", "VisualStudio", SettingsFileName);
        }

        private static JObject SettingsJson()
        {
            var file = SettingsFilePath();
            if (!File.Exists(file)) return new JObject { ["pathOverrides"] = new JObject(), ["language"] = "auto" };
            try
            {
                var json = ParseJson(file);
                if (!(json["pathOverrides"] is JObject)) json["pathOverrides"] = new JObject();
                if ((string)json["language"] != "en" && (string)json["language"] != "zh-CN") json["language"] = "auto";
                return json;
            }
            catch
            {
                return new JObject { ["pathOverrides"] = new JObject(), ["language"] = "auto" };
            }
        }

        private static void WriteSettingsJson(JObject json)
        {
            EnsureParent(SettingsFilePath());
            WriteJson(SettingsFilePath(), json);
        }

        private static List<string> AdapterArgs(BridgeClient bridgeClient, string clientName)
        {
            return new List<string>
            {
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                bridgeClient?.AdapterScriptPath ?? "stdioAdapter.ps1",
                "-PipeName",
                bridgeClient?.PipeName ?? string.Empty,
                "-ClientName",
                clientName
            };
        }

        private static string ClaudeDesktopPath(string localAppData)
        {
            var candidates = new[]
            {
                Path.Combine(localAppData, "Claude-3P", "claude_desktop_config.json"),
                Path.Combine(localAppData, "Claude", "claude_desktop_config.json")
            };
            return candidates.FirstOrDefault(File.Exists) ?? candidates[0];
        }

        private static string PowerShellPath()
        {
            var systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
            var powershell = Path.Combine(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            return File.Exists(powershell) ? powershell : "powershell.exe";
        }

        private static bool IsConfigured(AgentDefinition agent)
        {
            if (!File.Exists(agent.ConfigPath)) return false;
            if (agent.Kind == "mcp-json" || agent.Kind == "claude-desktop-json")
            {
                var json = ParseJson(agent.ConfigPath);
                return json["mcpServers"] is JObject mcpServers && mcpServers[ServerName] != null;
            }
            if (agent.Kind == "opencode-json")
            {
                var json = ParseJson(agent.ConfigPath);
                return json["mcp"] is JObject openCodeServers && openCodeServers[ServerName] != null;
            }
            var text = File.ReadAllText(agent.ConfigPath);
            return text.Contains(ServerName) && text.Contains(OwnedMarker);
        }

        private static void EnsureParent(string file)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            if (!File.Exists(file)) File.WriteAllText(file, file.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? "{}" + Environment.NewLine : string.Empty);
        }

        private static void UpsertOpenCodeJson(AgentDefinition agent)
        {
            var json = ParseJson(agent.ConfigPath);
            var servers = json["mcp"] as JObject ?? new JObject();
            servers[ServerName] = new JObject
            {
                ["type"] = "local",
                ["command"] = new JArray(new[] { agent.Command }.Concat(agent.Args)),
                ["enabled"] = true
            };
            json["mcp"] = servers;
            WriteJson(agent.ConfigPath, json);
        }

        private static void UpsertMcpJson(AgentDefinition agent)
        {
            var json = ParseJson(agent.ConfigPath);
            var servers = json["mcpServers"] as JObject ?? new JObject();
            var config = new JObject
            {
                ["command"] = agent.Command,
                ["args"] = new JArray(agent.Args)
            };
            if (agent.Kind != "claude-desktop-json") config["type"] = "stdio";
            servers[ServerName] = config;
            json["mcpServers"] = servers;
            WriteJson(agent.ConfigPath, json);
        }

        private static void RemoveOpenCodeJson(string file)
        {
            var json = ParseJson(file);
            if (json["mcp"] is JObject servers) servers.Remove(ServerName);
            WriteJson(file, json);
        }

        private static void RemoveMcpJson(string file)
        {
            var json = ParseJson(file);
            if (json["mcpServers"] is JObject servers) servers.Remove(ServerName);
            WriteJson(file, json);
        }

        private static void UpsertCodexToml(AgentDefinition agent)
        {
            var text = File.Exists(agent.ConfigPath) ? File.ReadAllText(agent.ConfigPath) : string.Empty;
            text = RemoveTomlBlock(text).TrimEnd();
            text += $"{Environment.NewLine}{Environment.NewLine}# {OwnedMarker}{Environment.NewLine}[mcp_servers.{ServerName}]{Environment.NewLine}command = \"{EscapeToml(agent.Command)}\"{Environment.NewLine}";
            if (agent.Args.Count > 0) text += "args = [" + string.Join(", ", agent.Args.Select(arg => "\"" + EscapeToml(arg) + "\"")) + "]" + Environment.NewLine;
            File.WriteAllText(agent.ConfigPath, text);
        }

        private static void RemoveToml(string file)
        {
            File.WriteAllText(file, RemoveTomlBlock(File.ReadAllText(file)).TrimEnd() + Environment.NewLine);
        }

        private static string RemoveTomlBlock(string text)
        {
            var output = new List<string>();
            var skipping = false;
            foreach (var line in text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
            {
                if (line.Trim() == "# " + OwnedMarker)
                {
                    skipping = true;
                    continue;
                }
                if (skipping && line.TrimStart().StartsWith("["))
                {
                    if (line.Trim() == "[mcp_servers." + ServerName + "]" || line.Trim().StartsWith("[mcp_servers." + ServerName + ".")) continue;
                    skipping = false;
                }
                if (!skipping && line.Trim() != "[mcp_servers." + ServerName + "]" && !line.Trim().StartsWith("[mcp_servers." + ServerName + ".")) output.Add(line);
            }
            return string.Join(Environment.NewLine, output);
        }

        private static JObject ParseJson(string file) => JObject.Parse(File.Exists(file) ? File.ReadAllText(file) : "{}");
        private static void WriteJson(string file, JObject json) => File.WriteAllText(file, json.ToString(Formatting.Indented) + Environment.NewLine);
        private static string EscapeToml(string value) => (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");

        private sealed class AgentDefinition
        {
            public AgentDefinition(string id, string name, string kind, string scope, string configPath, string command, IReadOnlyList<string> args)
            {
                Id = id;
                Name = name;
                Kind = kind;
                Scope = scope;
                ConfigPath = configPath;
                Command = command;
                Args = args;
            }

            public string Id { get; }
            public string Name { get; }
            public string Kind { get; }
            public string Scope { get; }
            public string ConfigPath { get; }
            public string Command { get; }
            public IReadOnlyList<string> Args { get; }

            public AgentDefinition WithConfigPath(string configPath) => new AgentDefinition(Id, Name, Kind, Scope, configPath, Command, Args);
        }
    }

    internal sealed class AgentStatus
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Scope { get; set; }
        public string StatusKey { get; set; }
        public string Status { get; set; }
        public string ConfigPath { get; set; }
    }
}
