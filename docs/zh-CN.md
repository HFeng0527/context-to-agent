# ContextToAgent — 文档

## 架构

ContextToAgent 以 stdio MCP 作为对 Agent 暴露的唯一传输方式。编辑器插件仅在编辑器开启期间，通过插件本地的 IPC socket/管道暴露编辑器状态。

### 组件

**VS Code 扩展** — 通过 VS Code API 采集当前编辑器状态，并托管一个插件本地的 IPC 服务。该 IPC 服务并非公开的 MCP 端点，仅供内置的 stdio adapter 使用。扩展会在用户的应用数据目录下写入一份注册文件，使 stdio adapter 能够定位到当前活动的 IPC 端点。

**Stdio Adapter** — 内置的 `stdioAdapter.js` 是配置在 Agent 中的 MCP 服务进程。Agent 通过 `command` 和 `args` 启动它；它从 stdin 读取 JSON-RPC，把请求转发到 VS Code IPC 端点，再把 JSON-RPC 响应写入 stdout。该 adapter 随 Agent 进程退出而退出。它不会安装常驻守护进程，也不会启动 VS Code。

**Visual Studio VSIX** — 遵循同样的 stdio 优先方向。通过 Windows 命名管道暴露编辑器状态，并配置 Agent 启动内置的 `stdioAdapter.ps1`。

**Agent 配置** — 所有受支持的 Agent 均以 stdio 方式配置：

- Codex：`[mcp_servers.editor-context]` 中的 `command` 和 `args`
- OpenCode：`{ "type": "local", "command": [...] }`
- Claude Code CLI：用户全局 `~/.claude.json`，配置 `{ "type": "stdio", "command": "...", "args": [...] }`
- Claude Desktop：`{ "command": "...", "args": [...] }`

### 数据流

```text
Agent
  -> stdio adapter
  -> 编辑器插件 IPC 服务
  -> 编辑器 API 快照
  -> MCP 工具结果
```

不会安装任何共享的后台服务。如果编辑器已关闭，adapter 会返回明确的不可用错误。

### 上下文选择

插件本地的 IPC 端点仅暴露归属它的那个编辑器实例。`list_instances`、`set_preferred_instance` 和 `clear_preferred_instance` 为兼容性保留，v1 不需要跨编辑器仲裁。

如果用户同时安装了 VS Code 与 Visual Studio 插件，每个编辑器各自拥有自己的 IPC 端点。活动的 adapter 会选择由该编辑器插件登记的端点。

### 隐私边界

不做工作区搜索、不做文件快照、不返回活动文件全文、不做 git diff、不做写入、不执行命令。空选区仅返回光标/路径；选中文本仅在用户实际选中文本时才返回。

---

## 协议

Agent 通过 stdio MCP 与 ContextToAgent 通信。内置的 stdio adapter 从 stdin 读取以换行分隔的 JSON-RPC 消息，并以换行分隔的 JSON-RPC 响应写入 stdout。

adapter 通过插件本地 IPC 把 MCP 请求转发给活动的编辑器插件。该 IPC 通道使用相同的换行分隔 JSON-RPC 负载，并通过编辑器插件写入的注册文件被发现。

支持的 MCP 方法：`initialize`、`ping`、`tools/list`、`tools/call`。

MCP 工具：`list_instances`、`get_context`、`set_preferred_instance`、`clear_preferred_instance`。

`get_context` 返回：`schemaVersion`、`status`、`instance`、`workspaceRoots`、`activeWorkspaceRoot`、`activeFile`、`cursor`、`selection`、`errors`。

桥接仅当用户存在活动选区时才返回选中文本。它绝不返回活动文件正文、邻近代码、工作区搜索结果、git 状态或命令输出。

JSON schema 位于 `schemas/`。

---

## 打包

无需发布任何伴随服务二进制。仅需打包编辑器插件。

仓库提供了一个统一脚本，可一次性打包两个插件：

```powershell
npm run package
```

该命令会先运行验证，再构建 Visual Studio VSIX 与 VS Code VSIX 到 `artifacts/`。可用开关跳过任一侧：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-extensions.ps1 -SkipVisualStudio
powershell -ExecutionPolicy Bypass -File scripts\package-extensions.ps1 -SkipVSCode
powershell -ExecutionPolicy Bypass -File scripts\package-extensions.ps1 -SkipVerify
```

产物命名为：

```text
artifacts\ContextToAgent-visualstudio-<version>.vsix
artifacts\ContextToAgent-vscode-<version>.vsix
```

### Visual Studio VSIX

Visual Studio 扩展项目位于 `extensions/visualstudio`，工程文件为 `ContextToAgent.csproj`。

前置条件：

- Windows
- .NET SDK
- 从 NuGet 还原的 Visual Studio SDK 构建工具，或安装了扩展开发工作负载的 Visual Studio

优先使用统一脚本。若要手动构建 Visual Studio VSIX，在仓库根目录执行：

```powershell
dotnet restore .\extensions\visualstudio\ContextToAgent.csproj

$projDir = Resolve-Path .\extensions\visualstudio
$vssdk = Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.vssdk.buildtools" -Directory |
  Sort-Object { [version]$_.Name } -Descending |
  Select-Object -First 1
$vstools = Join-Path $vssdk.FullName "tools"
$int = Join-Path $projDir "obj\Release\net472\"
$out = Join-Path $projDir "bin\Release\net472\"
$dll = Join-Path $out "ContextToAgent.dll"

dotnet msbuild "$projDir\ContextToAgent.csproj" `
  '/t:Build;GeneratePkgDef;CreateVsixContainer' `
  /p:Configuration=Release `
  /p:VSToolsPath="$vstools" `
  /p:IntermediateOutputPath="$int" `
  /p:OutputPath="$out" `
  /p:OutDir="$out" `
  /p:CreatePkgDefAssemblyToProcess="$dll" `
  /p:TargetVsixContainer="$out\ContextToAgent.vsix" `
  /p:DeployExtension=false
```

产物为：

```text
extensions\visualstudio\bin\Release\net472\ContextToAgent.vsix
```

手动安装：双击 VSIX，或使用 Visual Studio 的扩展安装器。升级扩展前请关闭正在运行的 Visual Studio 实例。

安装后重启 Visual Studio，从 `Extensions > ContextToAgent > Settings...` 打开独立界面。选项页位于 `Tools > Options > ContextToAgent > General`。该命令还以 `ContextToAgent.OpenSettings` 注册，供 Visual Studio 命令搜索使用。Visual Studio 2022/2026 会把扩展的顶级菜单归入 `Extensions`；本 VSIX 使用该官方菜单路径以保证稳定可见。

若从 Visual Studio IDE 构建，打开 `ContextToAgent.csproj`，选择 `Release`，构建该项目。如果 IDE 构建未生成 VSIX，请使用上面的命令行打包流程。

### VS Code VSIX

VS Code 扩展项目位于 `extensions/vscode`。

前置条件：

- Node.js 与 npm
- 全局安装 `@vscode/vsce`，或通过 `npx` 运行

优先使用统一脚本。若要手动构建 VS Code VSIX，在仓库根目录执行：

```powershell
npm run verify
cd .\extensions\vscode
npx @vscode/vsce package
```

产物为：

```text
extensions\vscode\context-to-agent-0.1.0.vsix
```

本地安装：

```powershell
code --install-extension .\context-to-agent-0.1.0.vsix
```

VS Code 扩展为 JavaScript 实现，只要目标 VS Code 版本支持该扩展 API，即可跨平台运行。

### Agent 配置

在支持的情况下，使用 VS Code 状态栏面板或 Visual Studio 设置对话框进行一键 stdio 配置。两处界面都支持中英文切换和按 Agent 的配置路径覆盖。对其它 Agent，请使用 Configure Other Agents 指引或 `examples/` 中的示例。

---

## 测试

```sh
npm run verify
```

自动检查会运行项目校验脚本与 VS Code agent-config 单元测试。

手动检查：

- 在 VS Code 中加载该扩展。
- 确认状态栏显示 ContextToAgent 状态。
- 从状态栏或命令面板打开 ContextToAgent 面板。
- 在面板中切换中英文。
- 通过面板配置 Codex、OpenCode、Claude Code CLI 或 Claude Desktop 的 MCP。
- 确认原生 VS Code 设置命令打开 `@ext:local.context-to-agent`。
- 让 Agent 调用 `editor-context.get_context`。
- 验证空选区仅返回路径与光标。
- 验证选中文本仅返回所选文本。
- 验证诊断仅包含 error 级别且最多 50 条。

Visual Studio VSIX 的检查必须在安装了 Visual Studio SDK 的 Windows 上运行。
