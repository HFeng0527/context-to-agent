const vscode = require("vscode");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const agentConfig = require("./agentConfig");

const SERVER_NAME = "editor-context";
const SETTINGS_FILTER = "@ext:local.context-to-agent";
const LANGUAGE_SETTING = "language";

let instanceId;
let pushTimer;
let ipcServer;
let ipcEndpoint;
let lastActiveAt = new Date().toISOString();
let recentReads = [];
let dashboardPanel;
let statusBarItem;
let extensionContext;

async function activate(context) {
  extensionContext = context;
  instanceId = context.globalState.get("instanceId");
  if (!instanceId) {
    instanceId = `vscode-${crypto.randomUUID()}`;
    await context.globalState.update("instanceId", instanceId);
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "contextToAgent.openDashboard";
  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand("contextToAgent.openSettings", () => openNativeSettings()),
    vscode.commands.registerCommand("contextToAgent.configureAgents", () => openDashboard()),
    vscode.commands.registerCommand("contextToAgent.openDashboard", () => openDashboard())
  );
  context.subscriptions.push(vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) markActiveAndScheduleRefresh();
  }));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => markActiveAndScheduleRefresh()));
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(() => markActiveAndScheduleRefresh()));
  context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => scheduleRefresh()));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (event.affectsConfiguration("contextToAgent")) {
      updateStatusBar();
      await refreshDashboard();
    }
  }));

  updateStatusBar();
  await ensureIpcServer();
  updateStatusBar();
  scheduleRefresh();
}

function deactivate() {
  if (pushTimer) clearTimeout(pushTimer);
  if (ipcServer) ipcServer.close();
  removeRegistry();
  if (dashboardPanel) dashboardPanel.dispose();
}

function markActiveAndScheduleRefresh() {
  lastActiveAt = new Date().toISOString();
  scheduleRefresh();
}

function scheduleRefresh() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    try {
      collectEditorState();
    } catch (error) {
      console.error("ContextToAgent refresh failed", error);
    }
  }, 300);
}

async function ensureIpcServer() {
  if (ipcServer && ipcEndpoint) return ipcEndpoint;
  ipcEndpoint = ipcPath();
  if (process.platform !== "win32" && fs.existsSync(ipcEndpoint)) fs.unlinkSync(ipcEndpoint);
  ipcServer = net.createServer((socket) => handleIpcSocket(socket));
  return new Promise((resolve, reject) => {
    ipcServer.once("error", reject);
    ipcServer.listen(ipcEndpoint, () => {
      ipcServer.off("error", reject);
      writeRegistry();
      resolve(ipcEndpoint);
    });
  });
}

function handleIpcSocket(socket) {
  let buffer = "";
  const request = { connectionId: crypto.randomUUID(), headers: { "user-agent": "context-to-agent-stdio-adapter" } };
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const payload = JSON.parse(line);
        const result = Array.isArray(payload)
          ? payload.map((message) => handleJsonRpc(message, request)).filter(Boolean)
          : handleJsonRpc(payload, request);
        if (result) socket.write(`${JSON.stringify(result)}\n`);
      } catch (error) {
        socket.write(`${JSON.stringify(rpcError(undefined, -32700, error.message))}\n`);
      }
    }
  });
}

function handleJsonRpc(message, request) {
  if (!message || !message.method) return rpcError(message && message.id, -32600, "Invalid request");
  if (message.id == null) return null;
  try {
    switch (message.method) {
      case "initialize":
        return rpcResult(message.id, {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: "0.1.0" }
        });
      case "ping":
        return rpcResult(message.id, {});
      case "tools/list":
        return rpcResult(message.id, { tools: toolDefinitions() });
      case "tools/call":
        return rpcResult(message.id, callTool(message.params || {}, request, message));
      default:
        return rpcError(message.id, -32601, `Unknown method: ${message.method}`);
    }
  } catch (error) {
    return rpcError(message.id, -32000, error.message);
  }
}

function callTool(params, request, message) {
  const name = params.name;
  const args = params.arguments || {};
  let data;
  if (name === "list_instances") data = listInstances();
  else if (name === "get_context") data = getContext(request);
  else if (name === "set_preferred_instance") data = setPreferredInstance(args.instanceId);
  else if (name === "clear_preferred_instance") data = { ok: true };
  else throw new Error(`Unknown tool: ${name}`);
  recordCall(request, message, name, data);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toolDefinitions() {
  return [
    {
      name: "list_instances",
      description: "List the single editor instance served by this editor plugin.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: "get_context",
      description: "Read the current editor context. Only selected text is returned; empty selections include cursor and paths only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: "set_preferred_instance",
      description: "Compatibility no-op for multi-instance clients. The plugin-local bridge only exposes this editor instance.",
      inputSchema: {
        type: "object",
        properties: { instanceId: { type: "string" } },
        required: ["instanceId"],
        additionalProperties: false
      }
    },
    {
      name: "clear_preferred_instance",
      description: "Compatibility no-op for multi-instance clients.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }
  ];
}

function listInstances() {
  const state = collectEditorState();
  return {
    instances: [instanceSummary(state)],
    selectedInstanceId: instanceId
  };
}

function getContext(request) {
  const state = collectEditorState();
  return {
    schemaVersion: "1.0",
    status: "ready",
    instance: instanceSummary(state),
    workspaceRoots: state.workspaceRoots,
    activeWorkspaceRoot: state.activeWorkspaceRoot,
    activeFile: state.activeFile,
    cursor: state.cursor,
    selection: state.selection,
    errors: state.errors
  };
}

function setPreferredInstance(preferredInstanceId) {
  if (preferredInstanceId !== instanceId) {
    return { ok: false, error: "This bridge only exposes its own editor instance.", instanceId };
  }
  return { ok: true, instanceId };
}

function instanceSummary(state) {
  return {
    instanceId,
    source: state.source,
    displayName: state.displayName,
    workspaceRoots: state.workspaceRoots,
    activeWorkspaceRoot: state.activeWorkspaceRoot,
    lastActiveAt,
    stale: false
  };
}

function collectEditorState() {
  const active = vscode.window.activeTextEditor;
  const workspaceRoots = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
  const activeFile = active && active.document.uri.scheme === "file" ? active.document.uri.fsPath : undefined;
  const activeWorkspaceRoot = activeFile ? findWorkspaceRoot(activeFile, workspaceRoots) : workspaceRoots[0];
  const openFiles = vscode.workspace.textDocuments.filter((doc) => doc.uri.scheme === "file").map((doc) => doc.uri.fsPath);
  return {
    source: "vscode",
    displayName: "VS Code",
    workspaceRoots,
    activeWorkspaceRoot,
    activeFile,
    cursor: active ? toPosition(active.selection.active) : undefined,
    selection: active ? toSelection(active) : undefined,
    errors: collectWorkspaceErrors(workspaceRoots, activeFile, openFiles),
    openFiles,
    lastActiveAt
  };
}

function toSelection(editor) {
  const selection = editor.selection;
  const result = { isEmpty: selection.isEmpty, start: toPosition(selection.start), end: toPosition(selection.end) };
  if (!selection.isEmpty) result.text = editor.document.getText(selection);
  return result;
}

function toPosition(position) {
  return { line: position.line, character: position.character };
}

function toRange(range) {
  return { start: toPosition(range.start), end: toPosition(range.end) };
}

function collectWorkspaceErrors(workspaceRoots, activeFile, openFiles) {
  const roots = workspaceRoots.map((root) => normalizePath(root));
  const open = new Set(openFiles.map(normalizePath));
  const errors = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== "file") continue;
    const file = uri.fsPath;
    const normalized = normalizePath(file);
    if (roots.length > 0 && !roots.some((root) => normalized.startsWith(root))) continue;
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity !== vscode.DiagnosticSeverity.Error) continue;
      errors.push({
        file,
        range: toRange(diagnostic.range),
        message: diagnostic.message,
        code: diagnostic.code == null ? undefined : String(diagnostic.code),
        source: diagnostic.source
      });
    }
  }
  errors.sort((a, b) => {
    const aActive = activeFile && normalizePath(a.file) === normalizePath(activeFile);
    const bActive = activeFile && normalizePath(b.file) === normalizePath(activeFile);
    if (aActive !== bActive) return aActive ? -1 : 1;
    const aOpen = open.has(normalizePath(a.file));
    const bOpen = open.has(normalizePath(b.file));
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return a.file.localeCompare(b.file) || a.range.start.line - b.range.start.line;
  });
  return errors.slice(0, 50);
}

function findWorkspaceRoot(file, roots) {
  const normalized = normalizePath(file);
  return roots.filter((root) => normalized.startsWith(normalizePath(root))).sort((a, b) => b.length - a.length)[0];
}

function normalizePath(value) {
  return path.resolve(value || "").toLowerCase();
}

function bridgePayload() {
  return {
    ok: true,
    serverName: SERVER_NAME,
    mode: "plugin-local-ipc",
    ipcEndpoint,
    instanceId,
    recentReads
  };
}

function bridgeDataDir() {
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "context-to-agent");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "context-to-agent");
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "context-to-agent");
}

function registryPath() {
  return path.join(bridgeDataDir(), "vscode-instance.json");
}

function ipcPath() {
  const id = crypto.createHash("sha256").update(os.homedir()).digest("hex").slice(0, 12);
  if (process.platform === "win32") return `\\\\.\\pipe\\context-to-agent-${id}`;
  return path.join(os.tmpdir(), `context-to-agent-${id}.sock`);
}

function writeRegistry() {
  fs.mkdirSync(bridgeDataDir(), { recursive: true });
  fs.writeFileSync(registryPath(), `${JSON.stringify({
    schemaVersion: "1.0",
    serverName: SERVER_NAME,
    mode: "plugin-local-ipc",
    ipcEndpoint,
    instanceId,
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
}

function removeRegistry() {
  try {
    if (fs.existsSync(registryPath())) fs.unlinkSync(registryPath());
    if (process.platform !== "win32" && ipcEndpoint && fs.existsSync(ipcEndpoint)) fs.unlinkSync(ipcEndpoint);
  } catch { }
}

function recordCall(request, message, toolName, data) {
  const state = data && data.schemaVersion ? data : collectEditorState();
  const selection = state.selection;
  recentReads.push({
    clientName: message && message._clientName || request.headers["user-agent"] || "mcp-client",
    toolName,
    connectionId: request.connectionId,
    instanceId,
    activeFile: state.activeFile,
    activeWorkspaceRoot: state.activeWorkspaceRoot,
    selectionEmpty: selection ? selection.isEmpty : undefined,
    selectionLength: selection && selection.text ? selection.text.length : 0,
    errorCount: Array.isArray(state.errors) ? state.errors.length : 0,
    readAt: new Date().toISOString()
  });
  recentReads = recentReads.slice(-50);
}

async function settingsModel() {
  await ensureIpcServer();
  updateStatusBar();
  const languageMode = configuredLanguageMode();
  const language = resolveLanguage(languageMode);
  const commandSpec = stdioCommandSpec();
  const otherAgentGuide = otherAgentSetupSnippets(commandSpec);
  const agents = await Promise.all((await agentDefinitions()).map(async (agent) => ({
    ...agent,
    exists: agentConfig.exists(agent),
    configured: agentConfig.isConfigured(agent),
    needsWorkspace: !agent.configPath
  })));
  return { bridgeRunning: Boolean(ipcServer && ipcEndpoint), bridgeInfo: commandSpec.command, recentReads, agents, language, languageMode, otherAgentGuide };
}

async function refreshDashboard() {
  if (!dashboardPanel) return;
  dashboardPanel.webview.html = dashboardHtml(await settingsModel());
}

async function openDashboard() {
  if (dashboardPanel) {
    dashboardPanel.reveal(vscode.ViewColumn.One);
    await refreshDashboard();
    return;
  }
  dashboardPanel = vscode.window.createWebviewPanel(
    "contextToAgentDashboard",
    "ContextToAgent",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  dashboardPanel.onDidDispose(() => {
    dashboardPanel = undefined;
  });
  dashboardPanel.webview.onDidReceiveMessage((message) => {
    handleDashboardMessage(message).catch((error) => {
      vscode.window.showErrorMessage(`ContextToAgent: ${error.message}`);
    });
  });
  await refreshDashboard();
}

async function handleDashboardMessage(message) {
  if (!message || !message.type) return;
  if (message.type === "configure") await configureAgents(message.agentIds || []);
  if (message.type === "configureAll") await configureAgents((await agentDefinitions()).filter((agent) => agent.configPath).map((agent) => agent.id));
  if (message.type === "revoke") await revokeAgent(message.agentId);
  if (message.type === "restart") await restartBridge();
  if (message.type === "copyCommand") await copyCommand();
  if (message.type === "copyText") await copyText(message.text);
  if (message.type === "openSettings") await openNativeSettings();
  if (message.type === "setLanguage") await setDashboardLanguage(message.language);
  await refreshDashboard();
}

async function openNativeSettings() {
  await vscode.commands.executeCommand("workbench.action.openSettings", SETTINGS_FILTER);
}

async function copyCommand() {
  await vscode.env.clipboard.writeText(JSON.stringify(stdioCommandSpec(), null, 2));
  const t = uiStrings(resolveLanguage());
  vscode.window.showInformationMessage(t.commandCopied);
}

async function copyText(text) {
  await vscode.env.clipboard.writeText(String(text || ""));
  const t = uiStrings(resolveLanguage());
  vscode.window.showInformationMessage(t.snippetCopied);
}

function updateStatusBar() {
  if (!statusBarItem) return;
  const t = uiStrings(resolveLanguage());
  const running = Boolean(ipcServer && ipcEndpoint);
  statusBarItem.text = running ? `$(plug) ${t.statusBarRunning}` : `$(circle-slash) ${t.statusBarStopped}`;
  statusBarItem.tooltip = running ? `${t.bridge}: ${ipcEndpoint}` : "ContextToAgent";
  statusBarItem.show();
}

function configuredLanguageMode() {
  const value = vscode.workspace.getConfiguration("contextToAgent").get(LANGUAGE_SETTING);
  return ["auto", "en", "zh-CN"].includes(value) ? value : "auto";
}

function resolveLanguage(mode = configuredLanguageMode()) {
  if (mode === "zh-CN" || (mode === "auto" && vscode.env.language.toLowerCase().startsWith("zh"))) return "zh-CN";
  return "en";
}

async function setDashboardLanguage(language) {
  if (!["auto", "en", "zh-CN"].includes(language)) return;
  await vscode.workspace.getConfiguration("contextToAgent").update(LANGUAGE_SETTING, language, vscode.ConfigurationTarget.Global);
}

function stdioCommandSpec() {
  return launcherCommandSpec();
}

function launcherCommandSpec() {
  const launcherPath = process.platform === "win32"
    ? path.join(bridgeDataDir(), "context-to-agent-stdio-vscode.cmd")
    : path.join(bridgeDataDir(), "context-to-agent-stdio-vscode");
  const adapterPath = extensionContext
    ? path.join(extensionContext.extensionPath, "out", "stdioAdapter.js")
    : path.join(__dirname, "stdioAdapter.js");
  fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
  if (process.platform === "win32") {
    fs.writeFileSync(launcherPath, [
      "@echo off",
      "set ELECTRON_RUN_AS_NODE=1",
      `"${process.execPath}" "${adapterPath}" %*`
    ].join("\r\n") + "\r\n", "utf8");
  } else {
    fs.writeFileSync(launcherPath, [
      "#!/bin/sh",
      "export ELECTRON_RUN_AS_NODE=1",
      `exec ${shellQuote(process.execPath)} ${shellQuote(adapterPath)} "$@"`
    ].join("\n") + "\n", "utf8");
    try { fs.chmodSync(launcherPath, 0o755); } catch { }
  }
  return { command: launcherPath, args: [], env: {} };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function otherAgentSetupSnippets(commandSpec) {
  const args = [...(commandSpec.args || []), "--client-name", "Your Agent Name"];
  const command = commandSpec.command;
  return {
    command,
    args,
    genericJson: JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: "stdio", command, args } } }, null, 2)
  };
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function dashboardHtml(model) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const t = uiStrings(model.language);
  const agentRows = model.agents.map((agent) => agentRowHtml(agent, t)).join("");
  const reads = model.recentReads.length
    ? model.recentReads.slice().reverse().map((read) => readRowHtml(read, model.language)).join("")
    : `<li><span>${escapeHtml(t.noReads)}</span></li>`;
  const languageButtons = [
    ["auto", t.auto],
    ["en", "English"],
    ["zh-CN", "中文"]
  ].map(([value, label]) => `<button type="button" class="seg ${model.languageMode === value ? "active" : ""}" data-language="${value}">${escapeHtml(label)}</button>`).join("");
  const otherAgentGuide = otherAgentSetupHtml(model.otherAgentGuide, t);

  return `<!doctype html>
<html lang="${model.language === "zh-CN" ? "zh-CN" : "en"}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      box-sizing: border-box;
      min-width: 0;
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.45;
    }
    *, *::before, *::after {
      box-sizing: inherit;
    }
    .page {
      display: grid;
      gap: 18px;
      width: min(100%, 980px);
      margin: 0 auto;
      padding: 24px 28px 32px;
    }
    h1, h2, p {
      margin: 0;
    }
    h1 {
      font-size: 22px;
      font-weight: 650;
    }
    h2 {
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    button {
      min-height: 28px;
      min-width: 0;
      padding: 3px 9px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button:disabled {
      cursor: default;
      opacity: 0.48;
    }
    code {
      display: block;
      width: 100%;
      padding: 5px 6px;
      overflow-wrap: anywhere;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      color: var(--vscode-textPreformat-foreground, var(--vscode-foreground));
      background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
    pre {
      margin: 0;
      padding: 8px;
      overflow: auto;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      color: var(--vscode-textPreformat-foreground, var(--vscode-foreground));
      background: var(--vscode-textCodeBlock-background, var(--vscode-input-background));
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .titlebar {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      flex-wrap: wrap;
      gap: 8px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: var(--vscode-testing-iconPassed, #4d9375);
    }
    .dot.off {
      background: var(--vscode-testing-iconFailed, #f14c4c);
    }
    .section {
      display: grid;
      gap: 10px;
      padding-top: 18px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .other-agents {
      display: grid;
      gap: 10px;
      margin-top: 2px;
    }
    .other-agents[hidden] {
      display: none;
    }
    .other-agents-list {
      display: grid;
      gap: 6px;
      margin: 0;
      padding-left: 20px;
    }
    .other-agents-list li {
      display: list-item;
      padding: 0;
      border: 0;
    }
    .pitfalls {
      display: grid;
      gap: 8px;
    }
    .pitfalls-title {
      font-weight: 600;
    }
    .segment {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 2px;
      width: min(100%, 300px);
      padding: 2px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      background: var(--vscode-input-background);
    }
    .seg {
      min-height: 24px;
      padding: 2px 4px;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: 0;
    }
    .seg.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .agents {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
    }
    .agent {
      display: grid;
      align-content: start;
      gap: 8px;
      min-height: 148px;
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-sideBar-background);
    }
    .agent:last-child {
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .agent-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .agent-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .badges {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 4px;
    }
    .badge {
      flex: 0 0 auto;
      padding: 1px 6px;
      border-radius: 10px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      font-size: 11px;
    }
    .badge.dim {
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-input-background);
    }
    .path {
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
      font-size: 11px;
    }
    ul {
      display: grid;
      gap: 7px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: grid;
      gap: 3px;
      min-width: 0;
      padding: 8px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    small {
      color: var(--vscode-descriptionForeground);
      overflow-wrap: anywhere;
    }
    .read-title {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      font-weight: 600;
    }
    .read-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    @media (max-width: 560px) {
      .page {
        padding: 16px;
      }
      .top {
        display: grid;
      }
      .segment {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="top">
      <div class="titlebar">
        <h1>ContextToAgent</h1>
        <span class="status"><span class="dot ${model.bridgeRunning ? "" : "off"}"></span>${escapeHtml(model.bridgeRunning ? t.running : t.stopped)}</span>
      </div>
      <div class="segment" aria-label="${escapeHtml(t.language)}">${languageButtons}</div>
    </div>

    <section class="section">
      <h2>${escapeHtml(t.bridge)}</h2>
      <code>${escapeHtml(model.bridgeInfo)}</code>
      <div class="toolbar">
        <button type="button" id="copyCommand">${escapeHtml(t.copy)}</button>
        <button type="button" class="secondary" id="restart">${escapeHtml(t.restart)}</button>
        <button type="button" class="secondary" id="refresh">${escapeHtml(t.refresh)}</button>
        <button type="button" class="secondary" id="openSettings">${escapeHtml(t.settings)}</button>
        <button type="button" class="secondary" id="toggleOtherAgents">${escapeHtml(t.configureOtherAgents)}</button>
      </div>
      <div class="other-agents" id="otherAgentSetup" hidden>
        <small>${escapeHtml(t.configureOtherAgentsHint)}</small>
        ${otherAgentGuide}
      </div>
    </section>

    <section class="section">
      <h2>${escapeHtml(t.agents)}</h2>
      <div class="toolbar">
        <button type="button" id="configureAll">${escapeHtml(t.configureAll)}</button>
      </div>
      <div class="agents">${agentRows}</div>
    </section>

    <section class="section">
      <h2>${escapeHtml(t.recentReads)}</h2>
      <ul>${reads}</ul>
    </section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const snippets = ${scriptJson(model.otherAgentGuide)};
    document.getElementById("copyCommand").addEventListener("click", () => vscode.postMessage({ type: "copyCommand" }));
    document.getElementById("restart").addEventListener("click", () => vscode.postMessage({ type: "restart" }));
    document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
    document.getElementById("openSettings").addEventListener("click", () => vscode.postMessage({ type: "openSettings" }));
    document.getElementById("toggleOtherAgents").addEventListener("click", () => {
      const panel = document.getElementById("otherAgentSetup");
      panel.hidden = !panel.hidden;
    });
    document.getElementById("configureAll").addEventListener("click", () => vscode.postMessage({ type: "configureAll" }));
    document.querySelectorAll("[data-copy-snippet]").forEach((button) => button.addEventListener("click", () => vscode.postMessage({ type: "copyText", text: snippets[button.dataset.copySnippet] })));
    document.querySelectorAll("[data-configure]").forEach((button) => button.addEventListener("click", () => vscode.postMessage({ type: "configure", agentIds: [button.dataset.configure] })));
    document.querySelectorAll("[data-revoke]").forEach((button) => button.addEventListener("click", () => vscode.postMessage({ type: "revoke", agentId: button.dataset.revoke })));
    document.querySelectorAll("[data-language]").forEach((button) => button.addEventListener("click", () => vscode.postMessage({ type: "setLanguage", language: button.dataset.language })));
  </script>
</body>
</html>`;
}

function otherAgentSetupHtml(snippets, t) {
  return `<ol class="other-agents-list">
    <li>${escapeHtml(t.otherAgentsStepName)} <code>editor-context</code></li>
    <li>${escapeHtml(t.otherAgentsStepTransport)} <code>stdio</code></li>
    <li>${escapeHtml(t.otherAgentsStepCommand)} <code>${escapeHtml(snippets.command)}</code></li>
    <li>${escapeHtml(t.otherAgentsStepArgs)} <code>--client-name "Your Agent Name"</code></li>
    <li>${escapeHtml(t.otherAgentsStepRestart)}</li>
  </ol>
  <div class="pitfalls">
    <span class="pitfalls-title">${escapeHtml(t.pitfalls)}</span>
    <small>${escapeHtml(t.pitfallNoHttp)}</small>
    <small>${escapeHtml(t.pitfallKeepEditorOpen)}</small>
    <small>${escapeHtml(t.pitfallLauncher)}</small>
    <small>${escapeHtml(t.pitfallElectronEnv)}</small>
    <small>${escapeHtml(t.pitfallEnvShape)}</small>
    <small>${escapeHtml(t.pitfallTypeField)}</small>
    <small>${escapeHtml(t.pitfallSpaces)}</small>
  </div>
  <div class="toolbar">
    <button type="button" class="secondary" data-copy-snippet="genericJson">${escapeHtml(t.copyGenericJson)}</button>
  </div>`;
}

function agentRowHtml(agent, t) {
  const status = agentStatus(agent, t);
  const scope = agent.scope === "global" ? t.globalScope : agent.scope;
  const configureDisabled = agent.needsWorkspace ? "disabled" : "";
  const revokeDisabled = agent.configured ? "" : "disabled";
  const pathLabel = agent.configPath || t.openWorkspace;
  return `<div class="agent">
    <div class="agent-head">
      <span class="agent-name">${escapeHtml(agent.name)}</span>
      <span class="badges">
        <span class="badge dim">${escapeHtml(scope)}</span>
        <span class="badge ${agent.configured ? "" : "dim"}">${escapeHtml(status)}</span>
      </span>
    </div>
    <div class="path">${escapeHtml(pathLabel)}</div>
    <div class="toolbar">
      <button type="button" data-configure="${escapeHtml(agent.id)}" ${configureDisabled}>${escapeHtml(t.configure)}</button>
      <button type="button" class="secondary" data-revoke="${escapeHtml(agent.id)}" ${revokeDisabled}>${escapeHtml(t.revoke)}</button>
    </div>
  </div>`;
}

function agentStatus(agent, t) {
  if (agent.needsWorkspace) return t.openWorkspace;
  if (agent.configured) return t.configured;
  if (agent.exists) return t.detected;
  return t.notFound;
}

function formatRead(read, language) {
  const date = new Date(read.readAt);
  const formatted = Number.isNaN(date.getTime())
    ? read.readAt
    : new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "medium" }).format(date);
  return `${uiStrings(language).readAt} ${formatted}`;
}

function readRowHtml(read, language) {
  const t = uiStrings(language);
  const file = read.activeFile ? path.basename(read.activeFile) : t.noActiveFile;
  const workspace = read.activeWorkspaceRoot ? path.basename(read.activeWorkspaceRoot) : t.noWorkspace;
  const selection = read.selectionEmpty === false
    ? `${t.selection}: ${read.selectionLength || 0}`
    : `${t.selection}: ${t.emptySelection}`;
  return `<li>
    <div class="read-title">
      <span>${escapeHtml(read.clientName || "MCP client")}</span>
      <span class="badge dim">${escapeHtml(read.toolName || "tools/call")}</span>
    </div>
    <small>${escapeHtml(formatRead(read, language))}</small>
    <div class="read-meta">
      <span>${escapeHtml(t.file)}: ${escapeHtml(file)}</span>
      <span>${escapeHtml(t.workspace)}: ${escapeHtml(workspace)}</span>
      <span>${escapeHtml(selection)}</span>
      <span>${escapeHtml(t.errors)}: ${escapeHtml(read.errorCount == null ? 0 : read.errorCount)}</span>
    </div>
  </li>`;
}

function uiStrings(language) {
  return UI_STRINGS[language] || UI_STRINGS.en;
}

const UI_STRINGS = {
  en: {
    agents: "Agent MCP",
    auto: "Auto",
    configure: "Configure",
    configureAll: "Configure all",
    configured: "Configured",
    configurePrompt: "ContextToAgent will update these stdio MCP configs:",
    copy: "Copy",
    bridge: "Stdio bridge",
    commandCopied: "Stdio command copied.",
    detected: "Detected",
    globalScope: "Global",
    language: "Language",
    emptySelection: "empty",
    errors: "Errors",
    file: "File",
    noReads: "No reads yet",
    noActiveFile: "No active file",
    noWorkspace: "No workspace",
    notFound: "Not found",
    openWorkspace: "Open a workspace",
    configureOtherAgents: "Configure Other Agents",
    configureOtherAgentsHint: "For agents not listed below, add this bridge as a stdio MCP server in that agent's own MCP settings.",
    otherAgentsStepName: "Use server name",
    otherAgentsStepTransport: "Use transport",
    otherAgentsStepCommand: "Use this command",
    otherAgentsStepArgs: "Add args",
    otherAgentsStepRestart: "Save the agent config, then restart that agent so it reloads MCP servers.",
    pitfalls: "Common pitfalls",
    pitfallNoHttp: "Do not use an HTTP URL; this bridge is stdio-only.",
    pitfallKeepEditorOpen: "Keep VS Code open while the agent uses the MCP server.",
    pitfallLauncher: "Use the generated launcher command, not stdioAdapter.js directly.",
    pitfallElectronEnv: "Do not add ELECTRON_RUN_AS_NODE when using this launcher; it is already set inside the launcher. Only set it yourself if you bypass the launcher and run VS Code/Electron directly.",
    pitfallEnvShape: "If an agent requires env values, JSON configs usually use an env object, while Codex TOML uses [mcp_servers.editor-context.env]. Keep env separate from args.",
    pitfallTypeField: "Some agents require type = stdio, while Claude Desktop stdio entries omit type. If a client rejects the config, check its expected MCP schema.",
    pitfallSpaces: "If an agent stores command and args as one shell string, quote paths with spaces.",
    copyGenericJson: "Copy generic MCP JSON",
    readAt: "Read at",
    recentReads: "Recent reads",
    refresh: "Refresh",
    remove: "Remove",
    restart: "Restart",
    revoke: "Revoke",
    revokePrompt: "Remove editor-context from this config?",
    running: "Running",
    settings: "Settings",
    selection: "Selection",
    snippetCopied: "MCP snippet copied.",
    stopped: "Stopped",
    statusBarRunning: "Editor Context: Running",
    statusBarStopped: "Editor Context: Stopped",
    confirm: "Confirm",
    updated: "ContextToAgent MCP configuration updated."
  },
  "zh-CN": {
    agents: "Agent MCP",
    auto: "自动",
    configure: "配置",
    configureAll: "全部配置",
    configured: "已配置",
    configurePrompt: "ContextToAgent 将更新这些 stdio MCP 配置：",
    copy: "复制",
    bridge: "Stdio 桥接",
    commandCopied: "Stdio 命令已复制。",
    detected: "已检测",
    globalScope: "全局",
    language: "语言",
    emptySelection: "空",
    errors: "错误",
    file: "文件",
    noReads: "暂无读取记录",
    noActiveFile: "无活动文件",
    noWorkspace: "无工作区",
    notFound: "未找到",
    openWorkspace: "需要打开工作区",
    configureOtherAgents: "配置其他 Agent",
    configureOtherAgentsHint: "对于下面没有列出的 Agent，在该 Agent 自己的 MCP 设置中把这个桥接添加为 stdio MCP server。",
    otherAgentsStepName: "服务器名称使用",
    otherAgentsStepTransport: "传输类型使用",
    otherAgentsStepCommand: "命令使用",
    otherAgentsStepArgs: "参数添加",
    otherAgentsStepRestart: "保存 Agent 配置后，重启该 Agent 让它重新加载 MCP server。",
    pitfalls: "常见坑",
    pitfallNoHttp: "不要填 HTTP URL；这个桥接只使用 stdio。",
    pitfallKeepEditorOpen: "Agent 使用 MCP 时需要保持 VS Code 打开。",
    pitfallLauncher: "使用生成的 launcher 命令，不要直接运行 stdioAdapter.js。",
    pitfallElectronEnv: "使用这个 launcher 时不要额外添加 ELECTRON_RUN_AS_NODE；launcher 内部已经设置好了。只有绕过 launcher、直接运行 VS Code/Electron 时才需要自己设置。",
    pitfallEnvShape: "如果某个 Agent 要求写 env，JSON 配置通常用 env 对象，Codex TOML 使用 [mcp_servers.editor-context.env]。env 要和 args 分开写。",
    pitfallTypeField: "有些 Agent 需要 type = stdio，但 Claude Desktop 的 stdio 配置通常不写 type。如果客户端拒绝配置，要对照它自己的 MCP schema。",
    pitfallSpaces: "如果某个 Agent 用单个 shell 字符串保存命令，路径里有空格时需要加引号。",
    copyGenericJson: "复制通用 MCP JSON",
    readAt: "读取时间",
    recentReads: "最近读取",
    refresh: "刷新",
    remove: "移除",
    restart: "重启",
    revoke: "撤销",
    revokePrompt: "从此配置中移除 editor-context？",
    running: "运行中",
    settings: "设置",
    selection: "选区",
    snippetCopied: "MCP 配置片段已复制。",
    stopped: "已停止",
    statusBarRunning: "编辑器上下文：运行中",
    statusBarStopped: "编辑器上下文：已停止",
    confirm: "确认",
    updated: "ContextToAgent MCP 配置已更新。"
  }
};

async function agentDefinitions() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  const settings = vscode.workspace.getConfiguration("contextToAgent");
  return agentConfig.agentDefinitions({
    home,
    appData,
    configHome,
    platform: process.platform,
    stdio: stdioCommandSpec(),
    pathOverrides: settings.get("configPaths") || {}
  });
}

async function configureAgents(agentIds) {
  await ensureIpcServer();
  const agents = (await agentDefinitions()).filter((agent) => agentIds.includes(agent.id) && agent.configPath);
  if (agents.length === 0) return;
  const t = uiStrings(resolveLanguage());
  const summary = agents.map((agent) => `${agent.name}\n${agent.configPath}`).join("\n\n");
  const choice = await vscode.window.showWarningMessage(`${t.configurePrompt}\n\n${summary}`, { modal: true }, t.confirm);
  if (choice !== t.confirm) return;
  for (const agent of agents) agentConfig.configureAgent(agent);
  vscode.window.showInformationMessage(t.updated);
}

async function revokeAgent(agentId) {
  const agent = (await agentDefinitions()).find((candidate) => candidate.id === agentId);
  if (!agent) return;
  const t = uiStrings(resolveLanguage());
  const choice = await vscode.window.showWarningMessage(`${t.revokePrompt}\n${agent.name}`, { modal: true }, t.remove);
  if (choice === t.remove) agentConfig.revokeAgent(agent);
}

async function restartBridge() {
  if (ipcServer) {
    await new Promise((resolve) => ipcServer.close(resolve));
  }
  ipcServer = undefined;
  ipcEndpoint = undefined;
  removeRegistry();
  updateStatusBar();
  await ensureIpcServer();
  updateStatusBar();
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

module.exports = { activate, deactivate, collectEditorState, handleJsonRpc };
