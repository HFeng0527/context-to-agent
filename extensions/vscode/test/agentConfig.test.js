const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const agentConfig = require("../out/agentConfig");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "context-to-agent-test-"));
}

function fixedDate() {
  return new Date("2026-06-20T00:00:00.000Z");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function testMcpJsonConfigureAndRevoke() {
  const dir = tempDir();
  const file = path.join(dir, "mcp-config.json");
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { existing: { command: "existing-tool" } } }, null, 2));
  const agent = { kind: "mcp-json", configPath: file, command: "/bin/context-to-agent-stdio", args: ["adapter.js", "--client-name", "Test Agent"], env: { ELECTRON_RUN_AS_NODE: "1" } };

  agentConfig.configureAgent(agent, fixedDate());
  const configured = JSON.parse(read(file));
  assert.strictEqual(configured.mcpServers.existing.command, "existing-tool");
  assert.strictEqual(configured.mcpServers["editor-context"].type, "stdio");
  assert.strictEqual(configured.mcpServers["editor-context"].command, "/bin/context-to-agent-stdio");
  assert.deepStrictEqual(configured.mcpServers["editor-context"].args, ["adapter.js", "--client-name", "Test Agent"]);
  assert.strictEqual(configured.mcpServers["editor-context"].env.ELECTRON_RUN_AS_NODE, "1");
  assert(!fs.existsSync(`${file}.2026-06-20T00-00-00-000Z.bak`));

  agentConfig.revokeAgent(agent, fixedDate());
  const revoked = JSON.parse(read(file));
  assert(!revoked.mcpServers["editor-context"]);
  assert.strictEqual(revoked.mcpServers.existing.command, "existing-tool");
}

function testClaudeDesktopConfigureAndRevoke() {
  const dir = tempDir();
  const file = path.join(dir, "claude_desktop_config.json");
  fs.writeFileSync(file, JSON.stringify({
    preferences: {
      theme: "dark",
      mcpServers: {
        "editor-context": { type: "streamable-http", url: "http://127.0.0.1:37373/mcp" }
      }
    },
    mcpServers: { existing: { command: "existing-tool" } }
  }, null, 2));
  const agent = { kind: "claude-desktop-json", configPath: file, command: "/bin/context-to-agent-stdio", args: ["adapter.js", "--client-name", "Claude Desktop"], env: { ELECTRON_RUN_AS_NODE: "1" } };

  agentConfig.configureAgent(agent, fixedDate());
  const configured = JSON.parse(read(file));
  assert.strictEqual(configured.preferences.theme, "dark");
  assert.strictEqual(configured.preferences.mcpServers["editor-context"].type, "streamable-http");
  assert.strictEqual(configured.mcpServers.existing.command, "existing-tool");
  assert(!("type" in configured.mcpServers["editor-context"]));
  assert.strictEqual(configured.mcpServers["editor-context"].command, "/bin/context-to-agent-stdio");
  assert.deepStrictEqual(configured.mcpServers["editor-context"].args, ["adapter.js", "--client-name", "Claude Desktop"]);

  agentConfig.revokeAgent(agent, fixedDate());
  const revoked = JSON.parse(read(file));
  assert(!revoked.mcpServers["editor-context"]);
  assert.strictEqual(revoked.mcpServers.existing.command, "existing-tool");
}

function testOpenCodeConfigureAndRevoke() {
  const dir = tempDir();
  const file = path.join(dir, "opencode.json");
  fs.writeFileSync(file, JSON.stringify({ mcp: { existing: { type: "local", command: ["tool"] } } }, null, 2));
  const agent = { kind: "opencode-json", configPath: file, command: "/bin/context-to-agent-stdio", args: ["adapter.js", "--client-name", "OpenCode"], env: { ELECTRON_RUN_AS_NODE: "1" } };

  agentConfig.configureAgent(agent, fixedDate());
  const configured = JSON.parse(read(file));
  assert.strictEqual(configured.mcp.existing.type, "local");
  assert.strictEqual(configured.mcp["editor-context"].type, "local");
  assert.deepStrictEqual(configured.mcp["editor-context"].command, ["/bin/context-to-agent-stdio", "adapter.js", "--client-name", "OpenCode"]);
  assert.strictEqual(configured.mcp["editor-context"].enabled, true);

  agentConfig.revokeAgent(agent, fixedDate());
  const revoked = JSON.parse(read(file));
  assert(!revoked.mcp["editor-context"]);
  assert.strictEqual(revoked.mcp.existing.type, "local");
}

function testCodexTomlConfigureAndRevoke() {
  const dir = tempDir();
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, [
    "[mcp_servers.keep]",
    "command = \"keep\"",
    "",
    "# context-to-agent managed stdio",
    "[mcp_servers.editor-context]",
    "command = \"/old/adapter\"",
    "[mcp_servers.editor-context.env]",
    "ELECTRON_RUN_AS_NODE = \"1\"",
    "",
    "[theme]",
    "name = \"dark\"",
    ""
  ].join("\n"));

  const agent = { kind: "codex-toml", configPath: file, command: "/bin/context-to-agent-stdio", args: ["adapter.js", "--client-name", "Codex"], env: { ELECTRON_RUN_AS_NODE: "1" } };
  agentConfig.configureAgent(agent, fixedDate());
  const configured = read(file);
  assert(configured.includes("[mcp_servers.keep]"));
  assert(configured.includes("[theme]"));
  assert(configured.includes("[mcp_servers.editor-context]"));
  assert(configured.includes('command = "/bin/context-to-agent-stdio"'));
  assert(configured.includes('args = ["adapter.js", "--client-name", "Codex"]'));
  assert(configured.includes("[mcp_servers.editor-context.env]"));
  assert(!configured.includes("/old/adapter"));

  agentConfig.revokeAgent(agent, fixedDate());
  const revoked = read(file);
  assert(revoked.includes("[mcp_servers.keep]"));
  assert(revoked.includes("[theme]"));
  assert(!revoked.includes("[mcp_servers.editor-context]"));
  assert(!revoked.includes("[mcp_servers.editor-context.env]"));
}

function testAgentDefinitionsUseStdio() {
  const dir = tempDir();
  const agents = agentConfig.agentDefinitions({
    home: dir,
    appData: path.join(dir, "AppData"),
    configHome: path.join(dir, ".config"),
    platform: "win32",
    stdio: { command: "node.exe", args: ["adapter.js"], env: { ELECTRON_RUN_AS_NODE: "1" } }
  });
  assert.strictEqual(agents.length, 4);
  assert(agents.every((agent) => agent.command === "node.exe"));
  assert(agents.every((agent) => agent.args.includes("--client-name")));
  assert(agents.some((agent) => agent.name === "Claude Code CLI" && agent.scope === "global" && agent.configPath === path.join(dir, ".claude.json")));
  assert(agents.some((agent) => agent.name === "Claude Desktop" && agent.kind === "claude-desktop-json"));
  assert(agents.filter((agent) => agent.scope === "global").length === 4);
}

function testPathOverrides() {
  const dir = tempDir();
  const agents = agentConfig.agentDefinitions({
    home: dir,
    appData: path.join(dir, "AppData"),
    configHome: path.join(dir, ".config"),
    platform: "darwin",
    pathOverrides: {
      claudeDesktop: "~/custom-claude.json",
      opencode: path.join(dir, "custom-opencode.json")
    },
    stdio: { command: "launcher", args: [], env: {} }
  });
  assert(agents.some((agent) => agent.id === "claude-desktop" && agent.configPath === path.join(dir, "custom-claude.json")));
  assert(agents.some((agent) => agent.id === "opencode" && agent.configPath === path.join(dir, "custom-opencode.json")));
  assert(!agents.some((agent) => agent.id.startsWith("custom.")));
}

function testClaude3pAutoPathMac() {
  const dir = tempDir();
  const claude3p = path.join(dir, "Library", "Application Support", "Claude-3P");
  fs.mkdirSync(claude3p, { recursive: true });
  fs.writeFileSync(path.join(claude3p, "claude_desktop_config.json"), "{}");
  const agents = agentConfig.agentDefinitions({
    home: dir,
    appData: path.join(dir, "AppData"),
    configHome: path.join(dir, ".config"),
    platform: "darwin",
    stdio: { command: "launcher", args: [], env: {} }
  });
  assert(agents.some((agent) => agent.id === "claude-desktop" && agent.configPath.includes("Claude-3P")));
}

function testClaude3pAutoPathWindows() {
  const dir = tempDir();
  const appData = path.join(dir, "AppData");
  const claude3p = path.join(appData, "Claude-3P");
  fs.mkdirSync(claude3p, { recursive: true });
  fs.writeFileSync(path.join(claude3p, "claude_desktop_config.json"), "{}");
  const agents = agentConfig.agentDefinitions({
    home: dir,
    appData,
    configHome: path.join(dir, ".config"),
    platform: "win32",
    stdio: { command: "launcher", args: [], env: {} }
  });
  assert(agents.some((agent) => agent.id === "claude-desktop" && agent.configPath.includes("Claude-3P")));
}

function testClaudeDesktopLinuxRequiresOverride() {
  const dir = tempDir();
  const withoutOverride = agentConfig.agentDefinitions({
    home: dir,
    appData: path.join(dir, "AppData"),
    configHome: path.join(dir, ".config"),
    platform: "linux",
    stdio: { command: "launcher", args: [], env: {} }
  });
  assert(!withoutOverride.some((agent) => agent.id === "claude-desktop"));

  const withOverride = agentConfig.agentDefinitions({
    home: dir,
    appData: path.join(dir, "AppData"),
    configHome: path.join(dir, ".config"),
    platform: "linux",
    pathOverrides: { claudeDesktop: "~/claude_desktop_config.json" },
    stdio: { command: "launcher", args: [], env: {} }
  });
  assert(withOverride.some((agent) => agent.id === "claude-desktop" && agent.configPath === path.join(dir, "claude_desktop_config.json")));
}

testMcpJsonConfigureAndRevoke();
testClaudeDesktopConfigureAndRevoke();
testOpenCodeConfigureAndRevoke();
testCodexTomlConfigureAndRevoke();
testAgentDefinitionsUseStdio();
testPathOverrides();
testClaude3pAutoPathMac();
testClaude3pAutoPathWindows();
testClaudeDesktopLinuxRequiresOverride();
console.log("VS Code agent config tests passed.");
