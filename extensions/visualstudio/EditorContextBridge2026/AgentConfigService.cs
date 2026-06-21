using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace EditorContextBridge2026
{
    internal sealed class AgentConfigService
    {
        private const string ServerName = "editor-context";
        private const string OwnedMarker = "editor-context-bridge managed stdio";

        public IReadOnlyList<AgentStatus> Statuses(BridgeClient bridgeClient)
        {
            return Agents(bridgeClient).Select(agent => new AgentStatus
            {
                Name = agent.Name,
                Scope = agent.Scope,
                ConfigPath = string.IsNullOrWhiteSpace(agent.ConfigPath) ? "Open a project first" : agent.ConfigPath,
                Status = string.IsNullOrWhiteSpace(agent.ConfigPath) ? "Unavailable" : IsConfigured(agent) ? "Configured" : File.Exists(agent.ConfigPath) ? "Detected" : "Not found"
            }).ToList();
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

        public string ConfigureOtherAgentsText(BridgeClient bridgeClient)
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
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var command = PowerShellPath();

            return new[]
            {
                new AgentDefinition("Codex", "codex-toml", "global", Path.Combine(home, ".codex", "config.toml"), command, AdapterArgs(bridgeClient, "Codex")),
                new AgentDefinition("OpenCode", "opencode-json", "global", Path.Combine(appData, "opencode", "opencode.json"), command, AdapterArgs(bridgeClient, "OpenCode")),
                new AgentDefinition("Claude Code CLI", "mcp-json", "global", Path.Combine(home, ".claude.json"), command, AdapterArgs(bridgeClient, "Claude Code CLI")),
                new AgentDefinition("Claude Desktop", "claude-desktop-json", "global", ClaudeDesktopPath(appData), command, AdapterArgs(bridgeClient, "Claude Desktop"))
            };
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

        private static string ClaudeDesktopPath(string appData)
        {
            var candidates = new[]
            {
                Path.Combine(appData, "Claude-3P", "claude_desktop_config.json"),
                Path.Combine(appData, "Claude", "claude_desktop_config.json")
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
            public AgentDefinition(string name, string kind, string scope, string configPath, string command, IReadOnlyList<string> args)
            {
                Name = name;
                Kind = kind;
                Scope = scope;
                ConfigPath = configPath;
                Command = command;
                Args = args;
            }

            public string Name { get; }
            public string Kind { get; }
            public string Scope { get; }
            public string ConfigPath { get; }
            public string Command { get; }
            public IReadOnlyList<string> Args { get; }
        }
    }

    internal sealed class AgentStatus
    {
        public string Name { get; set; }
        public string Scope { get; set; }
        public string Status { get; set; }
        public string ConfigPath { get; set; }
    }
}
