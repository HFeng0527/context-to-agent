# Packaging Guide

There is no companion binary to publish. Package only the editor plugins.

## VS Code

From `extensions/vscode`:

```sh
npm install -g @vscode/vsce
vsce package
code --install-extension editor-context-bridge-0.1.0.vsix
```

The VS Code extension is JavaScript and runs cross-platform as long as the target VS Code version supports the extension API.

## Visual Studio 2026

Build the VSIX on Windows with Visual Studio SDK workloads installed:

```powershell
msbuild extensions\visualstudio\EditorContextBridge2026\EditorContextBridge2026.csproj /p:Configuration=Release
```

Install the generated VSIX from the project output directory.

## Agent Configuration

Use the VS Code status bar dashboard or the Visual Studio settings dialog for one-click stdio configuration where supported. Use native settings for low-level options such as dashboard language. For other agents, use the Configure Other Agents guide or the examples in `examples/`.
