# Architecture

Editor Context Bridge uses stdio MCP as the only agent-facing transport. Editor plugins expose editor state through a plugin-local IPC socket/pipe while the editor is open.

## Components

### VS Code Extension

The extension collects current editor state through VS Code APIs and hosts a plugin-local IPC server. The IPC server is not a public MCP endpoint; it is only used by the bundled stdio adapter.

The extension writes a registry file under the user's application data directory so stdio adapters can find the active IPC endpoint.

### Stdio Adapter

The bundled `stdioAdapter.js` is the MCP server process configured in agents. Agents start it with `command` and `args`; it reads JSON-RPC from stdin, forwards requests to the VS Code IPC endpoint, and writes JSON-RPC responses to stdout.

The adapter exits with the agent process. It does not install a daemon and does not start VS Code.

### Visual Studio 2026 VSIX

The Visual Studio extension follows the same stdio-first direction. It exposes editor state through a Windows named pipe and configures agents to launch the bundled `stdioAdapter.ps1`.

### Agent Configuration

All supported agents are configured with stdio:

- Codex: `command` and `args` in `[mcp_servers.editor-context]`
- OpenCode: `{ "type": "local", "command": [...] }`
- Claude Code CLI: user-global `~/.claude.json` with `{ "type": "stdio", "command": "...", "args": [...] }`
- Claude Desktop: `{ "command": "...", "args": [...] }`

## Data Flow

```text
Agent
  -> stdio adapter
  -> editor plugin IPC server
  -> editor API snapshot
  -> MCP tool result
```

No shared background service is installed. If the editor closes, the adapter returns a clear unavailable error.

## Context Selection

The plugin-local IPC endpoint only exposes the editor instance that owns it. `list_instances`, `set_preferred_instance`, and `clear_preferred_instance` remain for compatibility, but v1 does not need cross-editor arbitration.

If a user has both VS Code and Visual Studio plugins installed, each editor owns its own IPC endpoint. The active adapter selects the endpoint recorded by that editor plugin.

## Privacy Boundary

No workspace search, no file snapshots, no active file full text, no git diff, no writes, and no command execution. Empty selections return cursor/path only; selected text is returned only when the user selected text.
