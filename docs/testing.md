# Testing Guide

```sh
npm run verify
```

Manual checks:

- Open VS Code with the extension loaded.
- Confirm the status bar shows ContextToAgent status.
- Open the ContextToAgent dashboard from the status bar or command palette.
- Switch the dashboard language between English and Chinese.
- Configure Codex, OpenCode, Claude Code CLI, or Claude Desktop MCP through the dashboard.
- Confirm the native VS Code settings command opens `@ext:local.context-to-agent`.
- Ask the Agent to call `editor-context.get_context`.
- Verify empty selections return path and cursor only.
- Verify selected text returns exactly the selected text.
- Verify diagnostics contain only error-level entries and are capped at 50.

Visual Studio VSIX checks must run on Windows with the Visual Studio SDK installed.
