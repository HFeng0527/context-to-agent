# Protocol

Agents talk to Context To Agent through stdio MCP. The bundled stdio adapter reads newline-delimited JSON-RPC messages from stdin and writes newline-delimited JSON-RPC responses to stdout.

The adapter forwards MCP requests to the active editor plugin over plugin-local IPC. The IPC channel uses the same newline-delimited JSON-RPC payloads and is discovered through the registry file written by the editor plugin.

Supported MCP methods:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

MCP tools:

- `list_instances`
- `get_context`
- `set_preferred_instance`
- `clear_preferred_instance`

`get_context` returns:

- `schemaVersion`
- `status`
- `instance`
- `workspaceRoots`
- `activeWorkspaceRoot`
- `activeFile`
- `cursor`
- `selection`
- `errors`

The bridge returns selected text only when the user has an active selection. It never returns the active file body, nearby code, workspace search results, git state, or command output.

JSON schemas live in `schemas/`.
