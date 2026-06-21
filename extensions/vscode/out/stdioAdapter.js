const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const SERVER_NAME = "editor-context";
const REQUEST_TIMEOUT_MS = 5000;
const CLIENT_NAME = cliValue("--client-name") || process.env.EDITOR_CONTEXT_BRIDGE_CLIENT_NAME || "MCP client";

function cliValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function bridgeDataDir() {
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "context-to-agent");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "context-to-agent");
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "context-to-agent");
}

function registryPath() {
  return path.join(bridgeDataDir(), "vscode-instance.json");
}

function fallbackIpcPath() {
  const id = crypto.createHash("sha256").update(os.homedir()).digest("hex").slice(0, 12);
  if (process.platform === "win32") return `\\\\.\\pipe\\context-to-agent-${id}`;
  return path.join(os.tmpdir(), `context-to-agent-${id}.sock`);
}

function ipcEndpoint() {
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    if (registry && registry.serverName === SERVER_NAME && registry.ipcEndpoint) return registry.ipcEndpoint;
  } catch { }
  return fallbackIpcPath();
}

function requestExtension(line, expectResponse) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(ipcEndpoint());
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Context To Agent timed out. Open VS Code and ensure the extension is running."));
    }, REQUEST_TIMEOUT_MS);

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${line}\n`);
      if (!expectResponse) {
        clearTimeout(timer);
        socket.end();
        resolve(undefined);
      }
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      const response = buffer.slice(0, newline).trim();
      socket.end();
      resolve(response);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Context To Agent is not available: ${error.message}`));
    });
    socket.on("close", () => {
      if (expectResponse && !buffer) {
        clearTimeout(timer);
        reject(new Error("Context To Agent closed the IPC connection without a response."));
      }
    });
  });
}

function hasRequestId(payload) {
  if (Array.isArray(payload)) return payload.some((message) => message && message.id != null);
  return payload && payload.id != null;
}

function errorResponse(payload, error) {
  if (Array.isArray(payload)) {
    return payload
      .filter((message) => message && message.id != null)
      .map((message) => rpcError(message.id, -32000, error.message));
  }
  return rpcError(payload && payload.id, -32000, error.message);
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id == null ? null : id, error: { code, message } };
}

function writeResponse(value) {
  if (!value) return;
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

function attachClientName(payload) {
  if (Array.isArray(payload)) return payload.map((message) => attachClientName(message));
  if (!payload || typeof payload !== "object") return payload;
  return { ...payload, _clientName: CLIENT_NAME };
}

let stdinBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk;
  let newline;
  while ((newline = stdinBuffer.indexOf("\n")) >= 0) {
    const line = stdinBuffer.slice(0, newline).trim();
    stdinBuffer = stdinBuffer.slice(newline + 1);
    if (!line) continue;
    handleLine(line).catch((error) => {
      process.stderr.write(`Context To Agent stdio adapter failed: ${error.message}\n`);
    });
  }
});

process.stdin.on("end", () => process.exit(0));

async function handleLine(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch (error) {
    writeResponse(rpcError(null, -32700, error.message));
    return;
  }

  try {
    writeResponse(await requestExtension(JSON.stringify(attachClientName(payload)), hasRequestId(payload)));
  } catch (error) {
    if (hasRequestId(payload)) writeResponse(errorResponse(payload, error));
    else process.stderr.write(`${error.message}\n`);
  }
}
