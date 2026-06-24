package com.contexttoagent.jetbrains

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.AppExecutorUtil
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.time.OffsetDateTime
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.io.path.absolutePathString
import kotlin.io.path.exists

@Service(Service.Level.APP)
internal class ContextToAgentService {
    private val executor = AppExecutorUtil.getAppExecutorService()
    private val recentReads = CopyOnWriteArrayList<ReadRecordPayload>()
    private val instanceId = "jetbrains-" + UUID.randomUUID().toString()
    private val token = UUID.randomUUID().toString().replace("-", "")
    @Volatile private var serverSocket: ServerSocket? = null
    @Volatile private var activeProject: Project? = null
    @Volatile private var latest: EditorInstanceUpdate? = null
    @Volatile private var lastActiveAt: OffsetDateTime = OffsetDateTime.now()

    fun start(project: Project) {
        touchProject(project)
        ensureIpc()
        Disposer.register(project) {
            if (activeProject === project) activeProject = null
        }
    }

    fun touchProject(project: Project) {
        activeProject = project
        lastActiveAt = OffsetDateTime.now()
        refresh(project)
    }

    fun refresh(project: Project? = activeProject) {
        if (project == null || project.isDisposed) return
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            latest = EditorStateCollector.collect(project, lastActiveAt)
        }
    }

    fun restartBridge() {
        serverSocket?.close()
        serverSocket = null
        ensureIpc()
    }

    fun stdioCommandSpec(): Map<String, Any?> {
        ensureIpc()
        return mapOf("command" to ensureLauncher(), "args" to emptyList<String>(), "env" to emptyMap<String, String>())
    }

    fun bridgeInfo(): String = stdioCommandSpec()["command"].toString()

    fun recentReads(): List<ReadRecordPayload> = recentReads.toList()

    private fun ensureIpc() {
        if (serverSocket != null) {
            writeRegistry()
            return
        }
        val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        serverSocket = socket
        writeRegistry()
        executor.execute {
            while (!socket.isClosed) {
                try {
                    val client = socket.accept()
                    executor.execute { handleSocket(client) }
                } catch (_: Exception) {
                    if (!socket.isClosed) serverSocket = null
                    break
                }
            }
        }
    }

    private fun handleSocket(socket: Socket) {
        socket.use {
            val connectionId = UUID.randomUUID().toString()
            val reader = BufferedReader(InputStreamReader(it.getInputStream(), StandardCharsets.UTF_8))
            val writer = BufferedWriter(OutputStreamWriter(it.getOutputStream(), StandardCharsets.UTF_8))
            while (true) {
                val line = reader.readLine() ?: break
                val response = try {
                    handlePayload(Json.parse(line), connectionId)
                } catch (error: Exception) {
                    rpcError(null, -32700, error.message ?: "Parse error")
                }
                if (response != null) {
                    writer.write(Json.stringify(response))
                    writer.newLine()
                    writer.flush()
                }
            }
        }
    }

    private fun handlePayload(payload: Any?, connectionId: String): Any? {
        val batch = Json.asArray(payload)
        if (batch != null) {
            val responses = batch.mapNotNull { Json.asObject(it)?.let { message -> handleJsonRpc(message, connectionId) } }
            return responses.ifEmpty { null }
        }
        val message = Json.asObject(payload) ?: return rpcError(null, -32600, "Invalid request")
        return handleJsonRpc(message, connectionId)
    }

    private fun handleJsonRpc(message: MutableMap<String, Any?>, connectionId: String): Map<String, Any?>? {
        if (message["_token"] != token) return rpcError(message["id"], -32001, "Invalid bridge token")
        val id = message["id"] ?: return null
        return try {
            when (val method = message["method"] as? String) {
                "initialize" -> rpcResult(id, mapOf("protocolVersion" to "2025-06-18", "capabilities" to mapOf("tools" to emptyMap<String, Any>()), "serverInfo" to mapOf("name" to SERVER_NAME, "version" to PLUGIN_VERSION)))
                "ping" -> rpcResult(id, emptyMap<String, Any>())
                "tools/list" -> rpcResult(id, mapOf("tools" to toolDefinitions()))
                "tools/call" -> rpcResult(id, callTool(Json.asObject(message["params"]) ?: linkedMapOf(), message, connectionId))
                else -> rpcError(id, -32601, "Unknown method: $method")
            }
        } catch (error: Exception) {
            rpcError(id, -32000, error.message ?: "ContextToAgent failed")
        }
    }

    private fun callTool(params: MutableMap<String, Any?>, message: MutableMap<String, Any?>, connectionId: String): Map<String, Any?> {
        val name = params["name"] as? String ?: error("Missing tool name")
        val args = Json.asObject(params["arguments"]) ?: linkedMapOf()
        val data = when (name) {
            "list_instances" -> mapOf("instances" to listOf(instanceSummary(collectNow())), "selectedInstanceId" to instanceId)
            "get_context" -> getContext()
            "set_preferred_instance" -> {
                val preferred = args["instanceId"] as? String
                if (preferred == instanceId) mapOf("ok" to true, "instanceId" to instanceId)
                else mapOf("ok" to false, "error" to "This bridge only exposes its own IDE instance.", "instanceId" to instanceId)
            }
            "clear_preferred_instance" -> mapOf("ok" to true)
            else -> error("Unknown tool: $name")
        }
        recordCall(message["_clientName"] as? String, name, connectionId, collectNow())
        return mapOf("content" to listOf(mapOf("type" to "text", "text" to Json.stringifyPretty(data))))
    }

    private fun getContext(): Map<String, Any?> {
        val state = collectNow()
        return omitNulls(
            "schemaVersion" to "1.0",
            "status" to "ready",
            "instance" to instanceSummary(state),
            "workspaceRoots" to state.workspaceRoots,
            "activeWorkspaceRoot" to state.activeWorkspaceRoot,
            "activeFile" to state.activeFile,
            "cursor" to state.cursor?.toJson(),
            "selection" to state.selection?.toJson(),
            "errors" to state.errors.map { it.toJson() }
        )
    }

    private fun collectNow(): EditorInstanceUpdate {
        val project = activeProject
        if (project != null && !project.isDisposed) {
            ApplicationManager.getApplication().invokeAndWait {
                latest = EditorStateCollector.collect(project, lastActiveAt)
            }
        }
        return latest ?: EditorInstanceUpdate(
            source = "jetbrains",
            displayName = "JetBrains IDE",
            workspaceRoots = emptyList(),
            activeWorkspaceRoot = null,
            activeFile = null,
            cursor = null,
            selection = null,
            errors = emptyList(),
            openFiles = emptyList(),
            lastActiveAt = lastActiveAt
        )
    }

    private fun instanceSummary(state: EditorInstanceUpdate): Map<String, Any?> = omitNulls(
        "instanceId" to instanceId,
        "source" to state.source,
        "displayName" to state.displayName,
        "workspaceRoots" to state.workspaceRoots,
        "activeWorkspaceRoot" to state.activeWorkspaceRoot,
        "activeFile" to state.activeFile,
        "lastActiveAt" to state.lastActiveAt.toString(),
        "stale" to false
    )

    private fun recordCall(clientName: String?, toolName: String, connectionId: String, state: EditorInstanceUpdate) {
        recentReads.add(
            ReadRecordPayload(
                clientName = clientName?.takeIf { it.isNotBlank() } ?: "mcp-client",
                toolName = toolName,
                connectionId = connectionId,
                instanceId = instanceId,
                activeFile = state.activeFile,
                activeWorkspaceRoot = state.activeWorkspaceRoot,
                selectionEmpty = state.selection?.isEmpty,
                selectionLength = state.selection?.text?.length ?: 0,
                errorCount = state.errors.size,
                readAt = OffsetDateTime.now()
            )
        )
        while (recentReads.size > 50) recentReads.removeAt(0)
    }

    private fun toolDefinitions(): List<Map<String, Any?>> = listOf(
        mapOf("name" to "list_instances", "description" to "List the single JetBrains IDE instance served by this editor plugin.", "inputSchema" to emptySchema()),
        mapOf("name" to "get_context", "description" to "Read the current editor context. Only selected text is returned; empty selections include cursor and paths only.", "inputSchema" to emptySchema()),
        mapOf("name" to "set_preferred_instance", "description" to "Compatibility no-op for multi-instance clients. The plugin-local bridge only exposes this IDE instance.", "inputSchema" to mapOf("type" to "object", "properties" to mapOf("instanceId" to mapOf("type" to "string")), "required" to listOf("instanceId"), "additionalProperties" to false)),
        mapOf("name" to "clear_preferred_instance", "description" to "Compatibility no-op for plugin-local IPC.", "inputSchema" to emptySchema())
    )

    private fun emptySchema(): Map<String, Any?> = mapOf("type" to "object", "properties" to emptyMap<String, Any>(), "additionalProperties" to false)

    private fun writeRegistry() {
        val socket = serverSocket ?: return
        Files.createDirectories(BridgePaths.dataDir())
        Files.writeString(
            BridgePaths.registryPath(),
            Json.stringifyPretty(
                mapOf(
                    "schemaVersion" to "1.0",
                    "serverName" to SERVER_NAME,
                    "mode" to "plugin-local-ipc",
                    "ipcEndpoint" to "tcp://127.0.0.1:${socket.localPort}",
                    "instanceId" to instanceId,
                    "token" to token,
                    "updatedAt" to OffsetDateTime.now().toString()
                )
            ) + "\n",
            StandardCharsets.UTF_8
        )
    }

    private fun ensureLauncher(): String {
        val launcher = BridgePaths.launcherPath()
        Files.createDirectories(launcher.parent)
        val java = BridgePaths.javaExecutable()
        val classpath = BridgePaths.pluginClasspath()
        val os = System.getProperty("os.name").lowercase()
        if (os.contains("win")) {
            Files.writeString(
                launcher,
                listOf(
                    "@echo off",
                    "setlocal",
                    "\"$java\" -cp \"$classpath\" com.contexttoagent.jetbrains.StdioAdapter %*"
                ).joinToString("\r\n") + "\r\n",
                StandardCharsets.UTF_8
            )
        } else {
            Files.writeString(
                launcher,
                listOf(
                    "#!/bin/sh",
                    "exec '${java.replace("'", "'\\''")}' -cp '${classpath.replace("'", "'\\''")}' com.contexttoagent.jetbrains.StdioAdapter \"$@\""
                ).joinToString("\n") + "\n",
                StandardCharsets.UTF_8
            )
            launcher.toFile().setExecutable(true, true)
        }
        return launcher.absolutePathString()
    }

    fun statusText(): String {
        val registry = if (BridgePaths.registryPath().exists()) BridgePaths.registryPath().absolutePathString() else "not registered"
        return "Bridge: ${bridgeInfo()}\nRegistry: $registry\nRecent reads: ${recentReads.size}"
    }

    private fun rpcResult(id: Any?, result: Any?): Map<String, Any?> = mapOf("jsonrpc" to "2.0", "id" to id, "result" to result)
    private fun rpcError(id: Any?, code: Int, message: String): Map<String, Any?> = mapOf("jsonrpc" to "2.0", "id" to id, "error" to mapOf("code" to code, "message" to message))

    companion object {
        fun getInstance(): ContextToAgentService = service()
    }
}
