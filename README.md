# ContextToAgent

ContextToAgent is a lightweight stdio MCP bridge that lets agents read the current editor context from VS Code and Visual Studio 2026.

## v1 Scope

- MCP server name: `editor-context`
- Transport: stdio MCP for agents; plugin-local IPC between the stdio adapter and editor plugin
- Lifecycle: the stdio adapter is started and stopped by the agent; editor IPC exists only while the editor plugin is running
- Editors: VS Code on Windows/macOS/Linux, Visual Studio 2026 on Windows
- Privacy: read-only editor context only
- Not included: workspace search, file snapshots, git diff, command execution, write operations, active file full text, or automatic nearby-code reads

## Architecture

```text
Agent
        |
        | stdio MCP
        v
stdio adapter
        |
        | plugin-local IPC
        v
VS Code extension or Visual Studio VSIX
        |
        +-- active file path
        +-- cursor and selection
        +-- selected text only when the user has a selection
        +-- workspace error diagnostics, capped at 50
```

There is no shared daemon and no user-managed background process.

Agent configuration is stdio-only. Codex, OpenCode, Claude Code CLI, and Claude Desktop are configured as user-global targets; Claude Code CLI uses `~/.claude.json`.

Built-in config paths can be overridden with `contextToAgent.configPaths`. For agents that are not built in, use the dashboard's Configure Other Agents guide and paste the stdio MCP config into that agent's own MCP settings. The guide also calls out common env and schema pitfalls such as `ELECTRON_RUN_AS_NODE`, JSON `env` objects, Codex TOML env tables, and clients that omit or require `type = "stdio"`.

On macOS and Windows the Claude Desktop default path checks `Claude-3P` before `Claude`; set `contextToAgent.configPaths.claudeDesktop` when you want an exact path. Linux only shows Claude Desktop when a path override is provided.

## Repository Layout

- `extensions/vscode`: VS Code extension, stdio adapter, plugin-local IPC endpoint, status bar dashboard, native settings, agent config helpers
- `extensions/visualstudio`: Visual Studio 2026 VSIX with the same stdio-first model
- `schemas`: JSON schemas for context response payloads
- `examples`: stdio MCP config examples for supported agents
- `docs/architecture.md`: component responsibilities and data flow
- `docs/protocol.md`: stdio and plugin-local IPC protocol contract
- `docs/packaging.md`: extension packaging guide
- `docs/testing.md`: local and CI verification guide

## Verify

```sh
npm run verify
```
