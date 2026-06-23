const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");

const vsRoot = "extensions/visualstudio";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(file, needle) {
  assert(read(file).includes(needle), `${file} is missing ${needle}`);
}

function assertNotIncludes(file, needle) {
  assert(!read(file).includes(needle), `${file} should not include ${needle}`);
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

for (const generatedPath of [`${vsRoot}/bin`, `${vsRoot}/obj`]) {
  const trackedFiles = childProcess.execFileSync("git", ["ls-files", generatedPath], { cwd: root, encoding: "utf8" }).trim();
  assert(!trackedFiles, `${generatedPath} should not be committed as source`);
}

readJson("schemas/context-response.schema.json");
readJson("examples/opencode.json");
assertIncludes("examples/codex_config.toml", "[mcp_servers.editor-context]");
assertIncludes("docs/en.md", "stdio");
assertIncludes("docs/en.md", "Privacy Boundary");
assertIncludes("docs/zh-CN.md", "stdio");
assertIncludes("docs/zh-CN.md", "隐私边界");
assertIncludes("README.md", "stdio");
assertNotIncludes("README.md", "dotnet publish");
assertNotIncludes("package.json", "build:bridge");
assertNotIncludes("package.json", "stage:companion");
assertIncludes("package.json", "package:extensions");
assertIncludes("package.json", "scripts/package-extensions.ps1");

const vscodeManifest = readJson("extensions/vscode/package.json");
assert(vscodeManifest.displayName === "ContextToAgent", "VS Code displayName should be ContextToAgent");
const commands = vscodeManifest.contributes.commands.map((command) => command.command);
assert(commands.includes("contextToAgent.openSettings"), "VS Code settings command is missing");
assert(commands.includes("contextToAgent.configureAgents"), "VS Code configure command is missing");
assert(commands.includes("contextToAgent.openDashboard"), "VS Code dashboard command is missing");
assert(!vscodeManifest.contributes.configuration.properties["contextToAgent.httpPort"], "VS Code HTTP port setting should be removed");
assert(vscodeManifest.contributes.configuration.properties["contextToAgent.language"], "VS Code dashboard language setting is missing");
assert(vscodeManifest.contributes.configuration.properties["contextToAgent.configPaths"], "VS Code config path overrides setting is missing");
assert(!vscodeManifest.contributes.configuration.properties["contextToAgent.customAgents"], "Custom agents should use Configure Other Agents instructions, not automatic writes");
assert(!vscodeManifest.contributes.views, "VS Code dashboard should not be contributed as a sidebar view");

const vscode = read("extensions/vscode/out/extension.js");
assert(vscode.includes("net.createServer"), "VS Code extension must host plugin-local IPC");
assert(vscode.includes("stdioAdapter.js"), "VS Code extension must configure the stdio adapter");
assert(vscode.includes("context-to-agent-stdio-vscode"), "VS Code extension must create the renamed stdio launcher");
assert(vscode.includes("createStatusBarItem"), "VS Code extension must expose the dashboard through the status bar");
assert(vscode.includes("createWebviewPanel"), "VS Code extension must open the dashboard as an editor panel");
assert(vscode.includes("@ext:local.context-to-agent"), "VS Code settings command must open the native extension settings");
assert(vscode.includes("pathOverrides"), "VS Code extension must pass path overrides to agent config");
assert(vscode.includes("otherAgentSetupSnippets"), "VS Code extension must show Configure Other Agents guidance");
assert(vscode.includes("Configure Other Agents"), "VS Code dashboard must use Configure Other Agents naming");
assert(vscode.includes("pitfallElectronEnv"), "VS Code Configure Other Agents guide must explain ELECTRON_RUN_AS_NODE pitfalls");
assert(vscode.includes("[mcp_servers.editor-context.env]"), "VS Code Configure Other Agents guide must explain Codex TOML env tables");
assert(vscode.includes("toolName"), "VS Code extension must keep enriched call records");
assert(!vscode.includes("http.createServer"), "VS Code extension must not expose HTTP MCP");
assert(!vscode.includes('url.pathname === "/mcp"'), "VS Code extension must not expose /mcp over HTTP");
assert(vscode.includes('case "tools/list"'), "VS Code extension must implement tools/list");
assert(vscode.includes('case "tools/call"'), "VS Code extension must implement tools/call");
assert(vscode.includes("vscode.DiagnosticSeverity.Error"), "VS Code extension must filter diagnostics to errors");
assert(vscode.includes("return errors.slice(0, 50);"), "VS Code extension must cap diagnostics at 50");
assert(vscode.includes("selection.isEmpty"), "VS Code extension must respect empty selections");
assert(!vscode.includes("getText()") || vscode.includes("getText(selection)"), "VS Code extension must not read full documents");
for (const forbidden of ["search_workspace", "get_file_snapshot", "apply_edit", "git_diff", "child_process", "daemon.json", "daemon-based"]) {
  assert(!vscode.includes(forbidden), `Forbidden VS Code capability leaked: ${forbidden}`);
}

const agentConfig = read("extensions/vscode/out/agentConfig.js");
const stdioAdapter = read("extensions/vscode/out/stdioAdapter.js");
assert(stdioAdapter.includes("process.stdin"), "Stdio adapter must read stdin");
assert(stdioAdapter.includes("process.stdout"), "Stdio adapter must write stdout");
assert(stdioAdapter.includes("--client-name"), "Stdio adapter must accept client names for call records");
assert(agentConfig.includes('type: "stdio"'), "Claude Code config must use stdio MCP");
assert(agentConfig.includes("Claude-3P"), "Agent config must detect Claude-3P Desktop config paths");
assert(agentConfig.includes("claudeDesktopPathCandidates"), "Agent config must centralize Claude Desktop path candidates");
assert(!agentConfig.includes("customAgentDefinitions"), "Agent config should not auto-write custom agents");
assert(agentConfig.includes('type: "local"'), "OpenCode config must use local stdio MCP");
assert(agentConfig.includes("command ="), "Codex config must use command MCP");
assert(!agentConfig.includes('type: "http"'), "Agent config must not use HTTP MCP");
assert(!agentConfig.includes('type: "remote"'), "Agent config must not use remote HTTP MCP");
assert(!agentConfig.includes("url:"), "Agent config must not write MCP URLs");
assert(!agentConfig.includes("Claude Desktop / Web"), "Unsupported Claude Desktop/Web connector should not appear in agent config");
assert(!agentConfig.includes("backupConfig"), "Agent config must not create config backups before updates");
assert(!agentConfig.includes("removeLegacyClaudeDesktopServer"), "Agent config must not mutate legacy Claude Desktop preferences");

assertIncludes(`${vsRoot}/EditorStateCollector.cs`, "vsBuildErrorLevelHigh");
assertIncludes(`${vsRoot}/EditorStateCollector.cs`, ".Take(50)");
assertIncludes(`${vsRoot}/EditorStateCollector.cs`, "Object(\"TextDocument\")");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "NamedPipeServerStream");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "JArray batch");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "RecordCall");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "_clientName");
assertIncludes(`${vsRoot}/stdioAdapter.ps1`, "NamedPipeClientStream");
assertIncludes(`${vsRoot}/stdioAdapter.ps1`, "ClientName");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, ".claude.json");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "Claude-3P");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "ConfigureOtherAgentsText");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "ConfigureAgent");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "RevokeAgent");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "ResetConfigPath");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "SetLanguageMode");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "ELECTRON_RUN_AS_NODE");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "[mcp_servers.editor-context.env]");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml.cs`, "Configure Other Agents");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "OtherAgentsGuideText");
assertNotIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "Grid.ColumnDefinitions");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "ConfigureSelectedButton");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "LanguageCombo");
assertNotIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "Save Paths");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml.cs`, "AgentGrid_CellEditEnding");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml.cs`, "SaveSelectedPath");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "\"ContextToAgent\", \"General\"");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "FindExtensionsCommandBar");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "commandBars[\"MenuBar\"]");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "StartExtensionsMenuRetry");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "MsoControlType.msoControlButton");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "MsoControlType.msoControlPopup");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "Type.Missing, Type.Missing, 1, true");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "ExtensionsMenuButton_Click");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "<Menus>");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "id=\"ContextToAgentMenu\"");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "type=\"Menu\"");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "id=\"IDG_VS_MM_TOOLSADDINS\"");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "ContextToAgentMenuGroup");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "<ButtonText>Settings...</ButtonText>");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "priority=\"0x0001\"");
assertIncludes(`${vsRoot}/Vs18ShellIds.h`, "IDM_VS_MENU_EXTENSIONS 0x0091");
assertIncludes(`${vsRoot}/Vs18ShellIds.h`, "IDG_VS_EXTENSIONS 0x6000");
assertIncludes(`${vsRoot}/source.extension.vsixmanifest`, "Version=\"0.1.10\"");
assertIncludes(`${vsRoot}/ContextToAgent.csproj`, "stdioAdapter.ps1");
assertNotIncludes(`${vsRoot}/BridgeClient.cs`, "HttpListener");
assertNotIncludes(`${vsRoot}/BridgeClient.cs`, "/mcp");
assertNotIncludes(`${vsRoot}/AgentConfigService.cs`, "http://127.0.0.1");
assertNotIncludes(`${vsRoot}/AgentConfigService.cs`, "Backup(");
assertNotIncludes(`${vsRoot}/AgentConfigService.cs`, "RemoveLegacyClaudeDesktopServer");
assertNotIncludes(`${vsRoot}/BridgeClient.cs`, "Daemon");
assertNotIncludes(`${vsRoot}/ContextToAgent.csproj`, "bin\\context-to-agent.exe");

console.log("Project verification passed.");
