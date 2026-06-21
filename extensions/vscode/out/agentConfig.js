const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER_NAME = "editor-context";
const OWNED_MARKER = "context-to-agent managed stdio";

function defaultEnv(env) {
  const home = os.homedir();
  return {
    home,
    platform: process.platform,
    appData: process.env.APPDATA || path.join(home, "AppData", "Roaming"),
    configHome: process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    pathOverrides: {},
    stdio: {
      command: process.execPath,
      args: [path.join(__dirname, "stdioAdapter.js")],
      env: {}
    },
    ...(env || {})
  };
}

function agentDefinitions(env) {
  const values = defaultEnv(env);
  const opencodePath = values.platform === "win32"
    ? path.join(values.appData, "opencode", "opencode.json")
    : path.join(values.configHome, "opencode", "opencode.json");
  const paths = values.pathOverrides || {};
  return [
    agent("codex", "Codex", "codex-toml", "global", resolveConfigPath(paths.codex, values.home) || path.join(values.home, ".codex", "config.toml"), values.stdio),
    agent("opencode", "OpenCode", "opencode-json", "global", resolveConfigPath(paths.opencode, values.home) || opencodePath, values.stdio),
    agent("claude-code", "Claude Code CLI", "mcp-json", "global", resolveConfigPath(paths.claudeCode, values.home) || path.join(values.home, ".claude.json"), values.stdio),
    agent("claude-desktop", "Claude Desktop", "claude-desktop-json", "global", resolveConfigPath(paths.claudeDesktop, values.home) || defaultClaudeDesktopPath(values), values.stdio)
  ].filter((candidate) => candidate.id !== "claude-desktop" || Boolean(candidate.configPath));
}

function agent(id, name, kind, scope, configPath, stdio) {
  const clientName = name || id;
  return {
    id,
    name,
    kind,
    scope,
    configPath,
    command: stdio.command,
    args: [...(stdio.args || []), "--client-name", clientName],
    env: stdio.env || {}
  };
}

function defaultClaudeDesktopPath(values) {
  if (values.platform === "linux") return "";
  const candidates = claudeDesktopPathCandidates(values);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function claudeDesktopPathCandidates(values) {
  const base = values.platform === "win32"
    ? values.appData
    : path.join(values.home, "Library", "Application Support");
  return ["Claude-3P", "Claude"].map((name) => path.join(base, name, "claude_desktop_config.json"));
}

function resolveConfigPath(value, home = os.homedir()) {
  if (!value || typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return path.join(home, trimmed.slice(2));
  return trimmed;
}

function exists(agent) {
  return Boolean(agent.configPath && fs.existsSync(agent.configPath));
}

function isConfigured(agent) {
  if (!exists(agent)) return false;
  if (agent.kind === "mcp-json" || agent.kind === "claude-desktop-json") {
    const data = parseJsonFile(agent.configPath);
    return Boolean(data.mcpServers && data.mcpServers[SERVER_NAME]);
  }
  if (agent.kind === "opencode-json") {
    const data = parseJsonFile(agent.configPath);
    return Boolean(data.mcp && data.mcp[SERVER_NAME]);
  }
  const text = fs.readFileSync(agent.configPath, "utf8");
  return text.includes(SERVER_NAME) && text.includes(OWNED_MARKER);
}

function configureAgent(agent) {
  if (!agent.configPath) throw new Error(`${agent.name} needs an open project before it can be configured.`);
  ensureParent(agent.configPath);
  if (agent.kind === "mcp-json" || agent.kind === "claude-desktop-json") upsertMcpJsonAgentConfig(agent);
  if (agent.kind === "opencode-json") upsertOpenCodeAgentConfig(agent);
  if (agent.kind === "codex-toml") upsertCodexTomlAgentConfig(agent);
}

function revokeAgent(agent) {
  if (!exists(agent)) return;
  if (agent.kind === "mcp-json" || agent.kind === "claude-desktop-json") removeJsonMcpServer(agent.configPath);
  if (agent.kind === "opencode-json") removeOpenCodeServer(agent.configPath);
  if (agent.kind === "codex-toml") removeCodexTomlConfig(agent.configPath);
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, file.endsWith(".json") ? "{}\n" : "", "utf8");
  }
}

function upsertMcpJsonAgentConfig(agent) {
  const data = parseJsonFile(agent.configPath);
  data.mcpServers = data.mcpServers || {};
  data.mcpServers[SERVER_NAME] = stdioJsonConfig(agent);
  writeJson(agent.configPath, data);
}

function upsertOpenCodeAgentConfig(agent) {
  const data = parseJsonFile(agent.configPath);
  data.mcp = data.mcp || {};
  data.mcp[SERVER_NAME] = {
    type: "local",
    command: [agent.command, ...(agent.args || [])],
    enabled: true,
    ...(Object.keys(agent.env || {}).length ? { env: agent.env } : {})
  };
  writeJson(agent.configPath, data);
}

function stdioJsonConfig(agent) {
  return {
    ...(agent.kind === "claude-desktop-json" ? {} : { type: "stdio" }),
    command: agent.command,
    args: agent.args || [],
    ...(Object.keys(agent.env || {}).length ? { env: agent.env } : {})
  };
}

function removeJsonMcpServer(file) {
  const data = parseJsonFile(file);
  if (data.mcpServers) delete data.mcpServers[SERVER_NAME];
  writeJson(file, data);
}

function removeOpenCodeServer(file) {
  const data = parseJsonFile(file);
  if (data.mcp) delete data.mcp[SERVER_NAME];
  writeJson(file, data);
}

function upsertCodexTomlAgentConfig(agent) {
  let text = fs.existsSync(agent.configPath) ? fs.readFileSync(agent.configPath, "utf8") : "";
  text = removeCodexTomlBlock(text);
  text = `${text.trimEnd()}\n\n# ${OWNED_MARKER}\n[mcp_servers.${SERVER_NAME}]\ncommand = "${escapeToml(agent.command)}"\n`;
  if ((agent.args || []).length) text += `args = [${agent.args.map((arg) => `"${escapeToml(arg)}"`).join(", ")}]\n`;
  if (Object.keys(agent.env || {}).length) {
    text += `[mcp_servers.${SERVER_NAME}.env]\n`;
    for (const [key, value] of Object.entries(agent.env)) text += `${key} = "${escapeToml(value)}"\n`;
  }
  fs.writeFileSync(agent.configPath, text, "utf8");
}

function removeCodexTomlConfig(file) {
  if (!fs.existsSync(file)) return;
  fs.writeFileSync(file, `${removeCodexTomlBlock(fs.readFileSync(file, "utf8")).trimEnd()}\n`, "utf8");
}

function removeCodexTomlBlock(text) {
  const lines = text.split(/\r?\n/);
  const output = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === `# ${OWNED_MARKER}`) {
      skipping = true;
      continue;
    }
    if (skipping && /^\s*\[/.test(line)) {
      if (line.trim() === `[mcp_servers.${SERVER_NAME}]` || line.trim().startsWith(`[mcp_servers.${SERVER_NAME}.`)) continue;
      skipping = false;
    }
    if (!skipping && line.trim() !== `[mcp_servers.${SERVER_NAME}]` && !line.trim().startsWith(`[mcp_servers.${SERVER_NAME}.`)) output.push(line);
  }
  return output.join("\n");
}

function parseJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8") || "{}");
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function escapeToml(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

module.exports = {
  SERVER_NAME,
  OWNED_MARKER,
  agentDefinitions,
  exists,
  isConfigured,
  configureAgent,
  revokeAgent,
  removeCodexTomlBlock
};
