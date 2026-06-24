package com.contexttoagent.jetbrains

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists

internal data class AgentStatus(
    val id: String,
    val name: String,
    val scope: String,
    val kind: String,
    val configPath: String,
    val statusKey: String
)

internal class AgentConfigService(private val bridge: ContextToAgentService = ContextToAgentService.getInstance()) {
    fun statuses(): List<AgentStatus> = agents().map { agent ->
        AgentStatus(
            id = agent.id,
            name = agent.name,
            scope = agent.scope,
            kind = agent.kind,
            configPath = agent.configPath,
            statusKey = when {
                isConfigured(agent) -> "configured"
                Files.exists(Path.of(agent.configPath)) -> "detected"
                else -> "notFound"
            }
        )
    }

    fun configureAll() {
        agents().forEach { configure(it) }
    }

    fun configureAgent(agentId: String) {
        agents().firstOrNull { it.id == agentId }?.let { configure(it) }
    }

    fun revokeAgent(agentId: String) {
        val agent = agents().firstOrNull { it.id == agentId } ?: return
        val path = Path.of(agent.configPath)
        if (!path.exists()) return
        when (agent.kind) {
            "codex-toml" -> writeText(path, removeCodexTomlBlock(readText(path)).trimEnd() + "\n")
            "opencode-json" -> removeOpenCodeServer(path)
            "mcp-json", "claude-desktop-json" -> removeMcpServer(path)
        }
    }

    fun savePathOverride(agentId: String, configPath: String) {
        val defaults = defaultAgents().associateBy { it.id }
        val settings = settingsJson()
        val overrides = Json.asObject(settings["pathOverrides"]) ?: linkedMapOf()
        val normalized = resolveConfigPath(configPath)
        val defaultPath = defaults[agentId]?.configPath
        if (normalized.isBlank() || normalized == defaultPath) overrides.remove(agentId) else overrides[agentId] = normalized
        settings["pathOverrides"] = overrides
        writeSettings(settings)
    }

    fun resetPathOverride(agentId: String) {
        val settings = settingsJson()
        val overrides = Json.asObject(settings["pathOverrides"]) ?: return
        overrides.remove(agentId)
        settings["pathOverrides"] = overrides
        writeSettings(settings)
    }

    fun languageMode(): String {
        val value = settingsJson()["language"] as? String
        return if (value == "en" || value == "zh-CN") value else "auto"
    }

    fun setLanguageMode(language: String) {
        val settings = settingsJson()
        settings["language"] = if (language == "en" || language == "zh-CN") language else "auto"
        writeSettings(settings)
    }

    fun resolvedLanguage(): String {
        val mode = languageMode()
        return if (mode == "zh-CN" || (mode == "auto" && java.util.Locale.getDefault().language.equals("zh", true))) "zh-CN" else "en"
    }

    fun configureOtherAgentsText(): String {
        val command = bridge.stdioCommandSpec()["command"].toString()
        val args = listOf("--client-name", "Your Agent Name")
        val genericJson = Json.stringifyPretty(
            mapOf(
                "mcpServers" to mapOf(
                    SERVER_NAME to mapOf(
                        "type" to "stdio",
                        "command" to command,
                        "args" to args
                    )
                )
            )
        )
        return if (resolvedLanguage() == "zh-CN") {
            listOf(
                "配置其他 Agent",
                "1. 添加一个名为 $SERVER_NAME 的 MCP server。",
                "2. 使用 stdio 传输。",
                "3. 使用下面 JSON 里的 command 和 args。",
                "4. 将 Your Agent Name 替换为读取记录中展示的 Agent 名称。",
                "5. 保存 Agent 配置后重启该 Agent。",
                "常见坑：",
                "- 不要使用 HTTP URL；这个桥接只支持 stdio。",
                "- Agent 使用该 MCP server 时需要保持 JetBrains IDE 打开。",
                "- 如果 Agent 支持 command/args 分离配置，请保持 command 和 args 分开。",
                "- JetBrains 桥接使用 JVM adapter，不要添加 ELECTRON_RUN_AS_NODE。",
                "- 如果 Agent 需要 env，JSON 配置通常使用 env 对象，Codex TOML 使用 [mcp_servers.$SERVER_NAME.env]。env 要和 args 分开。",
                "- 有些 Agent 要求 type = stdio，Claude Desktop 的 stdio 项通常不写 type。若客户端拒绝配置，请检查它的 MCP schema。",
                "- 如果 Agent 把 command 和 args 存成单个 shell 字符串，路径里有空格时要加引号。",
                genericJson
            ).joinToString("\n\n")
        } else {
            listOf(
                "Configure other agents",
                "1. Add a new MCP server named $SERVER_NAME.",
                "2. Use stdio transport.",
                "3. Use the command and args from the JSON below.",
                "4. Replace Your Agent Name with the agent name you want to see in call records.",
                "5. Save the agent config and restart that agent.",
                "Common pitfalls:",
                "- Do not use an HTTP URL; this bridge is stdio-only.",
                "- Keep the JetBrains IDE open while the agent uses this MCP server.",
                "- Keep command and args separate when the agent supports that shape.",
                "- Do not add ELECTRON_RUN_AS_NODE for this JetBrains bridge; it uses the bundled JVM adapter, not VS Code/Electron.",
                "- If an agent requires env values, JSON configs usually use an env object, while Codex TOML uses [mcp_servers.$SERVER_NAME.env]. Keep env separate from args.",
                "- Some agents require type = stdio, while Claude Desktop stdio entries omit type. If a client rejects the config, check its expected MCP schema.",
                "- Quote paths if an agent stores command and args as one shell string.",
                genericJson
            ).joinToString("\n\n")
        }
    }

    private fun configure(agent: AgentDefinition) {
        ensureParent(Path.of(agent.configPath))
        when (agent.kind) {
            "codex-toml" -> upsertCodexToml(agent)
            "opencode-json" -> upsertOpenCodeJson(agent)
            "mcp-json", "claude-desktop-json" -> upsertMcpJson(agent)
        }
    }

    private fun agents(): List<AgentDefinition> {
        val overrides = Json.asObject(settingsJson()["pathOverrides"]) ?: linkedMapOf()
        return defaultAgents().map { agent ->
            val override = overrides[agent.id] as? String
            if (!override.isNullOrBlank()) agent.copy(configPath = resolveConfigPath(override)) else agent
        }
    }

    private fun defaultAgents(): List<AgentDefinition> {
        val home = Path.of(System.getProperty("user.home"))
        val os = System.getProperty("os.name").lowercase()
        val appData = when {
            os.contains("win") -> Path.of(System.getenv("APPDATA") ?: home.resolve("AppData").resolve("Roaming").toString())
            os.contains("mac") -> home.resolve("Library").resolve("Application Support")
            else -> Path.of(System.getenv("XDG_CONFIG_HOME") ?: home.resolve(".config").toString())
        }
        val configHome = Path.of(System.getenv("XDG_CONFIG_HOME") ?: home.resolve(".config").toString())
        val localAppData = if (os.contains("win")) Path.of(System.getenv("LOCALAPPDATA") ?: home.resolve("AppData").resolve("Local").toString()) else appData
        val opencodePath = if (os.contains("win")) appData.resolve("opencode").resolve("opencode.json") else configHome.resolve("opencode").resolve("opencode.json")
        return listOf(
            agent("codex", "Codex", "codex-toml", home.resolve(".codex").resolve("config.toml").toString(), "Codex"),
            agent("opencode", "OpenCode", "opencode-json", opencodePath.toString(), "OpenCode"),
            agent("claude-code", "Claude Code CLI", "mcp-json", home.resolve(".claude.json").toString(), "Claude Code CLI"),
            agent("claude-desktop", "Claude Desktop", "claude-desktop-json", claudeDesktopPath(localAppData, os), "Claude Desktop")
        ).filter { it.configPath.isNotBlank() }
    }

    private fun agent(id: String, name: String, kind: String, configPath: String, clientName: String): AgentDefinition {
        val command = bridge.stdioCommandSpec()["command"].toString()
        return AgentDefinition(id, name, kind, "global", configPath, command, listOf("--client-name", clientName))
    }

    private fun isConfigured(agent: AgentDefinition): Boolean {
        val path = Path.of(agent.configPath)
        if (!path.exists()) return false
        return when (agent.kind) {
            "codex-toml" -> readText(path).let { text -> (text.contains(SERVER_NAME) || text.contains(LEGACY_SERVER_NAME)) && text.contains(OWNED_MARKER) }
            "opencode-json" -> Json.asObject(parseJson(path)["mcp"])?.hasManagedServer() == true
            else -> Json.asObject(parseJson(path)["mcpServers"])?.hasManagedServer() == true
        }
    }

    private fun upsertOpenCodeJson(agent: AgentDefinition) {
        val path = Path.of(agent.configPath)
        val json = parseJson(path)
        val mcp = Json.asObject(json["mcp"]) ?: linkedMapOf()
        mcp.remove(LEGACY_SERVER_NAME)
        mcp[SERVER_NAME] = mapOf("type" to "local", "command" to listOf(agent.command) + agent.args, "enabled" to true)
        json["mcp"] = mcp
        writeJson(path, json)
    }

    private fun upsertMcpJson(agent: AgentDefinition) {
        val path = Path.of(agent.configPath)
        val json = parseJson(path)
        val servers = Json.asObject(json["mcpServers"]) ?: linkedMapOf()
        val config = linkedMapOf<String, Any?>("command" to agent.command, "args" to agent.args)
        if (agent.kind != "claude-desktop-json") config["type"] = "stdio"
        servers.remove(LEGACY_SERVER_NAME)
        servers[SERVER_NAME] = config
        json["mcpServers"] = servers
        writeJson(path, json)
    }

    private fun upsertCodexToml(agent: AgentDefinition) {
        val path = Path.of(agent.configPath)
        val text = if (path.exists()) readText(path) else ""
        val updated = buildString {
            append(removeCodexTomlBlock(text).trimEnd())
            append("\n\n# $OWNED_MARKER\n")
            append("[mcp_servers.$SERVER_NAME]\n")
            append("command = \"${escapeToml(agent.command)}\"\n")
            if (agent.args.isNotEmpty()) append("args = [${agent.args.joinToString(", ") { "\"${escapeToml(it)}\"" }}]\n")
        }
        writeText(path, updated)
    }

    private fun removeMcpServer(path: Path) {
        val json = parseJson(path)
        Json.asObject(json["mcpServers"])?.removeManagedServers()
        writeJson(path, json)
    }

    private fun removeOpenCodeServer(path: Path) {
        val json = parseJson(path)
        Json.asObject(json["mcp"])?.removeManagedServers()
        writeJson(path, json)
    }

    private fun removeCodexTomlBlock(text: String): String {
        val output = mutableListOf<String>()
        var skipping = false
        for (line in text.lines()) {
            val trimmed = line.trim()
            if (trimmed == "# $OWNED_MARKER") {
                skipping = true
                continue
            }
            if (isManagedTomlSection(trimmed)) {
                skipping = true
                continue
            }
            if (skipping && trimmed.startsWith("[")) {
                skipping = false
            }
            if (!skipping) output.add(line)
        }
        return output.joinToString("\n")
    }

    private fun MutableMap<String, Any?>.hasManagedServer(): Boolean = containsKey(SERVER_NAME) || containsKey(LEGACY_SERVER_NAME)

    private fun MutableMap<String, Any?>.removeManagedServers() {
        remove(SERVER_NAME)
        remove(LEGACY_SERVER_NAME)
    }

    private fun isManagedTomlSection(trimmed: String): Boolean {
        return trimmed == "[mcp_servers.$SERVER_NAME]" ||
            trimmed.startsWith("[mcp_servers.$SERVER_NAME.") ||
            trimmed == "[mcp_servers.$LEGACY_SERVER_NAME]" ||
            trimmed.startsWith("[mcp_servers.$LEGACY_SERVER_NAME.")
    }

    private fun claudeDesktopPath(localAppData: Path, os: String): String {
        if (os.contains("linux")) return ""
        val candidates = listOf(
            localAppData.resolve("Claude-3P").resolve("claude_desktop_config.json"),
            localAppData.resolve("Claude").resolve("claude_desktop_config.json")
        )
        return (candidates.firstOrNull { it.exists() } ?: candidates.first()).toString()
    }

    private fun settingsJson(): MutableMap<String, Any?> {
        val path = BridgePaths.settingsPath()
        if (!path.exists()) return linkedMapOf("pathOverrides" to linkedMapOf<String, Any?>(), "language" to "auto")
        return runCatching { Json.asObject(Json.parse(readText(path))) ?: linkedMapOf() }.getOrElse { linkedMapOf() }.also {
            if (Json.asObject(it["pathOverrides"]) == null) it["pathOverrides"] = linkedMapOf<String, Any?>()
            if (it["language"] !in listOf("auto", "en", "zh-CN")) it["language"] = "auto"
        }
    }

    private fun writeSettings(settings: MutableMap<String, Any?>) {
        val path = BridgePaths.settingsPath()
        ensureParent(path)
        writeJson(path, settings)
    }

    private fun resolveConfigPath(value: String): String {
        val trimmed = value.trim()
        val home = Path.of(System.getProperty("user.home"))
        return when {
            trimmed == "~" -> home.toString()
            trimmed.startsWith("~/") || trimmed.startsWith("~\\") -> home.resolve(trimmed.substring(2)).toString()
            else -> trimmed
        }
    }

    private fun parseJson(path: Path): MutableMap<String, Any?> {
        if (!path.exists()) return linkedMapOf()
        val text = readText(path).ifBlank { "{}" }
        return Json.asObject(Json.parse(text)) ?: linkedMapOf()
    }

    private fun writeJson(path: Path, json: Map<String, Any?>) = writeText(path, Json.stringifyPretty(json) + "\n")

    private fun ensureParent(path: Path) {
        path.parent?.let { Files.createDirectories(it) }
        if (!path.exists()) Files.writeString(path, if (path.toString().endsWith(".json", true)) "{}\n" else "", StandardCharsets.UTF_8)
    }

    private fun readText(path: Path): String = Files.readString(path, StandardCharsets.UTF_8)
    private fun writeText(path: Path, text: String) = Files.writeString(path, text, StandardCharsets.UTF_8)
    private fun escapeToml(value: String): String = value.replace("\\", "\\\\").replace("\"", "\\\"")

    private data class AgentDefinition(
        val id: String,
        val name: String,
        val kind: String,
        val scope: String,
        val configPath: String,
        val command: String,
        val args: List<String>
    )
}
