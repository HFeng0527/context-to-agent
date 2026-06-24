const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");

const vsRoot = "extensions/visualstudio";
const jbRoot = "extensions/jetbrains";

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

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assertFileExists(relativePath) {
  assert(exists(relativePath), `${relativePath} is missing`);
}

function assertFileMissing(relativePath) {
  assert(!exists(relativePath), `${relativePath} should not exist`);
}

for (const generatedPath of [`${vsRoot}/bin`, `${vsRoot}/obj`]) {
  const trackedFiles = childProcess.execFileSync("git", ["ls-files", generatedPath], { cwd: root, encoding: "utf8" }).trim();
  assert(!trackedFiles, `${generatedPath} should not be committed as source`);
}
for (const generatedPath of [`${jbRoot}/build`, `${jbRoot}/.gradle`]) {
  const trackedFiles = childProcess.execFileSync("git", ["ls-files", generatedPath], { cwd: root, encoding: "utf8" }).trim();
  assert(!trackedFiles, `${generatedPath} should not be committed as source`);
}

readJson("schemas/context-response.schema.json");
readJson("examples/opencode.json");
const rootPackage = readJson("package.json");
assert(rootPackage.version === "0.1.15", "Root package version should be 0.1.15");
assert(rootPackage.license === "Apache-2.0", "Root package license should be Apache-2.0");
assertFileMissing("LICENSE");
assertIncludes("examples/codex_config.toml", "[mcp_servers.editor-context-vscode]");
if (exists("docs/en.md")) {
  assertIncludes("docs/en.md", "stdio");
  assertIncludes("docs/en.md", "editor-context-vscode");
  assertIncludes("docs/en.md", "editor-context-visualstudio");
  assertIncludes("docs/en.md", "editor-context-jetbrains");
  assertIncludes("docs/en.md", "JetBrains Plugin");
  assertIncludes("docs/en.md", "Privacy Boundary");
}
if (exists("docs/zh-CN.md")) {
  assertIncludes("docs/zh-CN.md", "stdio");
  assertIncludes("docs/zh-CN.md", "editor-context-vscode");
  assertIncludes("docs/zh-CN.md", "editor-context-visualstudio");
  assertIncludes("docs/zh-CN.md", "editor-context-jetbrains");
  assertIncludes("docs/zh-CN.md", "JetBrains 插件");
  assertIncludes("docs/zh-CN.md", "隐私边界");
}
assertIncludes("README.md", "stdio");
assertIncludes("README.md", "editor-context-vscode");
assertIncludes("README.md", "editor-context-visualstudio");
assertIncludes("README.md", "editor-context-jetbrains");
assertIncludes("README.md", "extensions/jetbrains");
assertNotIncludes("README.md", "dotnet publish");
assertNotIncludes("package.json", "build:bridge");
assertNotIncludes("package.json", "stage:companion");
assertIncludes("package.json", "package:extensions");
assertIncludes("package.json", "scripts/package-extensions.js");
assertFileExists("scripts/package-extensions.js");
assertFileMissing("scripts/package-extensions.ps1");
assertIncludes("scripts/package-extensions.js", "Package JetBrains plugin");
assertIncludes("scripts/package-extensions.js", "Package VS Code-compatible VSIX");
assertIncludes("scripts/package-extensions.js", "process.platform !== \"win32\"");
assertIncludes("scripts/package-extensions.js", ".tmp-jetbrains-build");
assertIncludes("scripts/package-extensions.js", "kotlin.compiler.execution.strategy=in-process");
assertIncludes("scripts/package-extensions.js", "--allow-missing-repository");

const vscodeManifest = readJson("extensions/vscode/package.json");
assert(vscodeManifest.displayName === "ContextToAgent", "VS Code displayName should be ContextToAgent");
assert(vscodeManifest.version === "0.1.15", "VS Code package version should be 0.1.15");
assert(vscodeManifest.license === "Apache-2.0", "VS Code package license should be Apache-2.0");
assert(vscodeManifest.icon === "icon.png", "VS Code package icon should be icon.png");
assertFileExists("extensions/vscode/icon.png");
assertFileMissing("extensions/vscode/LICENSE");
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
assert(vscode.includes('SERVER_NAME = "editor-context-vscode"'), "VS Code MCP server name must include editor identity");
assert(vscode.includes('version: "0.1.15"'), "VS Code MCP serverInfo version should be 0.1.15");
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
assert(vscode.includes("[mcp_servers.${SERVER_NAME}.env]"), "VS Code Configure Other Agents guide must explain Codex TOML env tables with editor-specific names");
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
assert(agentConfig.includes('SERVER_NAME = "editor-context-vscode"'), "VS Code agent config must use editor-specific server name");
assert(agentConfig.includes('LEGACY_SERVER_NAME = "editor-context"'), "VS Code agent config must migrate the legacy server name");
assert(stdioAdapter.includes('SERVER_NAME = "editor-context-vscode"'), "VS Code stdio adapter must use editor-specific server name");
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
assertIncludes(`${vsRoot}/BridgeClient.cs`, "editor-context-visualstudio");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "version = \"0.1.15\"");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "JArray batch");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "RecordCall");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "_clientName");
assertIncludes(`${vsRoot}/BridgeClient.cs`, "_listenTask");
assertIncludes(`${vsRoot}/stdioAdapter.ps1`, "NamedPipeClientStream");
assertIncludes(`${vsRoot}/stdioAdapter.ps1`, "ClientName");
assertIncludes(`${vsRoot}/InstanceIdentity.cs`, "visualstudio-bridge-instance-id.txt");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, ".claude.json");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "editor-context-visualstudio");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "LegacyServerName");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "Claude-3P");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "ConfigureOtherAgentsText");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "ConfigureAgent");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "RefreshConfiguredAgents");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "RevokeAgent");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "ResetConfigPath");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "SetLanguageMode");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "ELECTRON_RUN_AS_NODE");
assertIncludes(`${vsRoot}/AgentConfigService.cs`, "[mcp_servers.\" + ServerName + \".env]");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml.cs`, "Configure Other Agents");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "OtherAgentsGuideText");
assertNotIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "Grid.ColumnDefinitions");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "ConfigureSelectedButton");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "LanguageCombo");
assertNotIncludes(`${vsRoot}/BridgeSettingsControl.xaml`, "Save Paths");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml.cs`, "AgentGrid_CellEditEnding");
assertIncludes(`${vsRoot}/BridgeSettingsControl.xaml.cs`, "SaveSelectedPath");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "\"ContextToAgent\", \"General\"");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "066fbd03-0d37-4aa5-8530-56fcf59a0716");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "StartBridgeInBackground");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "StartVisualStudioIntegration");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "#pragma warning disable VSTHRD010");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "RefreshConfiguredAgents");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "Task.Delay(TimeSpan.FromSeconds(2)");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "Interlocked.Exchange(ref _pushStateActive");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "protected override async Task InitializeAsync");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "a640fd4d-8f06-460c-bbc0-0b4c2f8a0c3a");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "cfd2b31d-7820-4015-b91f-f1b36f6d926f");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "ContextToAgent2026");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "VSConstants.UICONTEXT.ShellInitialized_string");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "FindExtensionsCommandBar");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "commandBars[\"MenuBar\"]");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "StartExtensionsMenuRetry");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "MsoControlType.msoControlButton");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "MsoControlType.msoControlPopup");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "Type.Missing, Type.Missing, 1, true");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "FindOpenSettingsCommand");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "command.AddControl(extensionsMenu, 1)");
assertIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "ExtensionsMenuButton_Click");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.cs`, "_extensionsMenuButton.Delete()");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "<Groups>");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "ContextToAgentExtensionsGroup");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "ContextToAgentExtensionsReparentGroup");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "id=\"IDG_VS_EXTENSIONS\"");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "id=\"IDG_VS_EXTENSIONS_REPARENT\"");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "<CommandPlacements>");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "id=\"IDG_VS_MM_TOOLSADDINS\"");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "066fbd03-0d37-4aa5-8530-56fcf59a0716");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "16ae04a6-f1aa-42cc-ab3a-ce1efb25c540");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "a640fd4d-8f06-460c-bbc0-0b4c2f8a0c3a");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "d6ccb87b-8d24-4915-8748-4464481054bc");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "cfd2b31d-7820-4015-b91f-f1b36f6d926f");
assertNotIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "ContextToAgent2026");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "<ButtonText>Context To Agent</ButtonText>");
assertIncludes(`${vsRoot}/ContextToAgentPackage.vsct`, "priority=\"0x0001\"");
assertIncludes(`${vsRoot}/Vs18ShellIds.h`, "IDM_VS_MENU_EXTENSIONS 0x0091");
assertIncludes(`${vsRoot}/Vs18ShellIds.h`, "IDG_VS_EXTENSIONS 0x6000");
assertIncludes(`${vsRoot}/source.extension.vsixmanifest`, "Id=\"ContextToAgent.VisualStudio\"");
assertIncludes(`${vsRoot}/source.extension.vsixmanifest`, "Version=\"0.1.15\"");
assertNotIncludes(`${vsRoot}/source.extension.vsixmanifest`, "<License>LICENSE</License>");
assertIncludes(`${vsRoot}/source.extension.vsixmanifest`, "<Icon>icon.png</Icon>");
assertNotIncludes(`${vsRoot}/source.extension.vsixmanifest`, "Id=\"ContextToAgent\"");
assertNotIncludes(`${vsRoot}/source.extension.vsixmanifest`, "ContextToAgent2026");
assertIncludes(`${vsRoot}/extension.vsixmanifest`, "ContextToAgent.VisualStudio.dll");
assertNotIncludes(`${vsRoot}/extension.vsixmanifest`, "<License>LICENSE</License>");
assertIncludes(`${vsRoot}/extension.vsixmanifest`, "<Icon>icon.png</Icon>");
assertNotIncludes(`${vsRoot}/extension.vsixmanifest`, "ContextToAgent2026");
assertIncludes(`${vsRoot}/ContextToAgent.csproj`, "<AssemblyName>ContextToAgent.VisualStudio</AssemblyName>");
assertIncludes(`${vsRoot}/ContextToAgent.csproj`, "stdioAdapter.ps1");
assertIncludes(`${vsRoot}/ContextToAgent.csproj`, "icon.png");
assertIncludes(`${vsRoot}/ContextToAgent.csproj`, "<IncludeInVSIX>true</IncludeInVSIX>");
assertFileExists(`${vsRoot}/icon.png`);
assertNotIncludes(`${vsRoot}/ContextToAgent.csproj`, "ContextToAgent2026");
assertIncludes("scripts/package-extensions.js", "ContextToAgent.VisualStudio.dll");
assertNotIncludes(`${vsRoot}/BridgeClient.cs`, "HttpListener");
assertNotIncludes(`${vsRoot}/BridgeClient.cs`, "/mcp");
assertNotIncludes(`${vsRoot}/AgentConfigService.cs`, "http://127.0.0.1");
assertNotIncludes(`${vsRoot}/AgentConfigService.cs`, "Backup(");
assertNotIncludes(`${vsRoot}/AgentConfigService.cs`, "RemoveLegacyClaudeDesktopServer");
assertNotIncludes(`${vsRoot}/BridgeClient.cs`, "Daemon");
assertNotIncludes(`${vsRoot}/ContextToAgent.csproj`, "bin\\context-to-agent.exe");

assertIncludes(`${jbRoot}/build.gradle.kts`, "kotlin(\"jvm\")");
assertIncludes(`${jbRoot}/build.gradle.kts`, "version = \"0.1.15\"");
assertIncludes(`${jbRoot}/build.gradle.kts`, "jvmToolchain(21)");
assertIncludes(`${jbRoot}/build.gradle.kts`, "JavaLanguageVersion.of(21)");
assertIncludes(`${jbRoot}/build.gradle.kts`, "org.jetbrains.intellij.platform");
assertIncludes(`${jbRoot}/build.gradle.kts`, 'intellijIdeaCommunity("2024.3")');
assertIncludes(`${jbRoot}/build.gradle.kts`, 'sinceBuild = "243"');
assertIncludes(`${jbRoot}/build.gradle.kts`, 'sinceBuild.set("243")');
assertIncludes(`${jbRoot}/src/main/resources/META-INF/plugin.xml`, "local.context-to-agent.jetbrains");
assertFileExists(`${jbRoot}/src/main/resources/META-INF/pluginIcon.svg`);
assertFileExists(`${jbRoot}/src/main/resources/META-INF/pluginIcon_dark.svg`);
assertIncludes(`${jbRoot}/src/main/resources/META-INF/plugin.xml`, "ContextToAgentStartupActivity");
assertIncludes(`${jbRoot}/src/main/resources/META-INF/plugin.xml`, "ContextToAgentConfigurable");
assertIncludes(`${jbRoot}/src/main/resources/META-INF/plugin.xml`, "ToolsMenu");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/ContextToAgentService.kt`, "ServerSocket");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/ContextToAgentService.kt`, "plugin-local-ipc");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/ContextToAgentService.kt`, "tools/list");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/ContextToAgentService.kt`, "tools/call");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/ContextToAgentService.kt`, "return mapOf(\"content\"");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/EditorStateCollector.kt`, "HighlightSeverity.ERROR");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/EditorStateCollector.kt`, ".take(50)");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/EditorStateCollector.kt`, "selectedText");
assertNotIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/EditorStateCollector.kt`, "document.text)");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/StdioAdapter.kt`, "System.`in`");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/StdioAdapter.kt`, "System.out");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/StdioAdapter.kt`, "--client-name");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/Constants.kt`, "editor-context-jetbrains");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/Constants.kt`, "PLUGIN_VERSION = \"0.1.15\"");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/Constants.kt`, "LEGACY_SERVER_NAME");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/AgentConfigService.kt`, ".claude.json");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/AgentConfigService.kt`, "Claude-3P");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/AgentConfigService.kt`, "Configure other agents");
assertIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/AgentConfigService.kt`, "[mcp_servers.$SERVER_NAME.env]");
const jetbrainsConfigurable = `${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/ContextToAgentConfigurable.kt`;
assertIncludes(jetbrainsConfigurable, "GridBagLayout");
assertIncludes(jetbrainsConfigurable, "LanguageOption");
assertIncludes(jetbrainsConfigurable, "languageOptions");
assertIncludes(jetbrainsConfigurable, 'LanguageOption("auto", strings.auto)');
assertIncludes(jetbrainsConfigurable, 'LanguageOption("en", "English")');
assertIncludes(jetbrainsConfigurable, 'LanguageOption("zh-CN", "中文")');
assertIncludes(jetbrainsConfigurable, "configureAllButton");
assertIncludes(jetbrainsConfigurable, "configureSelectedButton");
assertIncludes(jetbrainsConfigurable, "revokeAllButton");
assertIncludes(jetbrainsConfigurable, "revokeSelectedButton");
assertIncludes(jetbrainsConfigurable, "resetPathButton");
assertIncludes(jetbrainsConfigurable, "recentReadsModel");
assertIncludes(jetbrainsConfigurable, "bridge.recentReads()");
assertIncludes(jetbrainsConfigurable, "Configure Other Agents");
assertIncludes(jetbrainsConfigurable, "Recent reads");
assertIncludes(jetbrainsConfigurable, "暂无读取记录");
assertNotIncludes(jetbrainsConfigurable, "Copy command");
assertNotIncludes(jetbrainsConfigurable, "Copy guide");
assertNotIncludes(jetbrainsConfigurable, "Restart bridge");
assertNotIncludes(jetbrainsConfigurable, '"Id"');
assertNotIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/AgentConfigService.kt`, "http://127.0.0.1");
assertNotIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/ContextToAgentService.kt`, "HttpServer");
assertNotIncludes(`${jbRoot}/src/main/kotlin/com/contexttoagent/jetbrains/ContextToAgentService.kt`, "/mcp");
assertIncludes("schemas/context-response.schema.json", "\"jetbrains\"");
assertIncludes("schemas/editor-instance-update.schema.json", "\"jetbrains\"");

console.log("Project verification passed.");


