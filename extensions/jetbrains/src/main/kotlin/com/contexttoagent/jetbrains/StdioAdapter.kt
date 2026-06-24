package com.contexttoagent.jetbrains

import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.Socket
import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import kotlin.system.exitProcess

object StdioAdapter {
    private const val requestTimeoutMs = 5000

    @JvmStatic
    fun main(args: Array<String>) {
        val clientName = cliValue(args, "--client-name")
            ?: System.getenv("EDITOR_CONTEXT_BRIDGE_CLIENT_NAME")
            ?: "MCP client"
        val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
        val stdout = BufferedWriter(OutputStreamWriter(System.out, StandardCharsets.UTF_8))
        while (true) {
            val line = stdin.readLine() ?: break
            if (line.isBlank()) continue
            val response = try {
                val payload = Json.parse(line)
                requestPlugin(Json.stringify(attachClient(payload, clientName)), hasRequestId(payload))
            } catch (error: Exception) {
                val fallbackPayload = runCatching { Json.parse(line) }.getOrNull()
                if (hasRequestId(fallbackPayload)) Json.stringify(errorResponse(fallbackPayload, error)) else {
                    System.err.println(error.message)
                    null
                }
            }
            if (response != null) {
                stdout.write(response)
                stdout.newLine()
                stdout.flush()
            }
        }
        exitProcess(0)
    }

    private fun requestPlugin(line: String, expectResponse: Boolean): String? {
        val registry = registry()
        val endpoint = registry["ipcEndpoint"] as? String ?: error("ContextToAgent registry does not contain an IPC endpoint.")
        val uri = URI(endpoint)
        Socket(uri.host, uri.port).use { socket ->
            socket.soTimeout = requestTimeoutMs
            val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8))
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8))
            writer.write(line)
            writer.newLine()
            writer.flush()
            if (!expectResponse) return null
            return reader.readLine() ?: error("ContextToAgent closed the IPC connection without a response.")
        }
    }

    private fun registry(): MutableMap<String, Any?> {
        val file = registryPath()
        if (!Files.exists(file)) error("ContextToAgent is not available. Open a JetBrains IDE with the plugin enabled.")
        val registry = Json.asObject(Json.parse(Files.readString(file, StandardCharsets.UTF_8)))
            ?: error("ContextToAgent registry is invalid.")
        if (registry["serverName"] != SERVER_NAME) error("ContextToAgent registry belongs to a different server.")
        return registry
    }

    private fun attachClient(payload: Any?, clientName: String): Any? {
        val token = registry()["token"] as? String ?: error("ContextToAgent registry does not contain a bridge token.")
        val batch = Json.asArray(payload)
        if (batch != null) return batch.map { attachClient(it, clientName) }
        val message = Json.asObject(payload) ?: return payload
        val copy = linkedMapOf<String, Any?>()
        copy.putAll(message)
        copy["_clientName"] = clientName
        copy["_token"] = token
        return copy
    }

    private fun hasRequestId(payload: Any?): Boolean {
        val batch = Json.asArray(payload)
        if (batch != null) return batch.any { hasRequestId(it) }
        val message = Json.asObject(payload)
        return message?.get("id") != null
    }

    private fun errorResponse(payload: Any?, error: Exception): Any {
        val batch = Json.asArray(payload)
        if (batch != null) return batch.mapNotNull { item ->
            Json.asObject(item)?.takeIf { it["id"] != null }?.let { rpcError(it["id"], -32000, error.message ?: "ContextToAgent failed") }
        }
        val id = Json.asObject(payload)?.get("id")
        return rpcError(id, -32000, error.message ?: "ContextToAgent failed")
    }

    private fun rpcError(id: Any?, code: Int, message: String): Map<String, Any?> =
        mapOf("jsonrpc" to "2.0", "id" to id, "error" to mapOf("code" to code, "message" to message))

    private fun cliValue(args: Array<String>, name: String): String? {
        val index = args.indexOf(name)
        return if (index >= 0 && index + 1 < args.size) args[index + 1] else null
    }

    private fun registryPath(): Path = dataDir().resolve("jetbrains-instance.json")

    private fun dataDir(): Path {
        val home = Path.of(System.getProperty("user.home"))
        val os = System.getProperty("os.name").lowercase()
        return when {
            os.contains("win") -> Path.of(System.getenv("APPDATA") ?: home.resolve("AppData").resolve("Roaming").toString(), "context-to-agent")
            os.contains("mac") -> home.resolve("Library").resolve("Application Support").resolve("context-to-agent")
            else -> Path.of(System.getenv("XDG_STATE_HOME") ?: home.resolve(".local").resolve("state").toString(), "context-to-agent")
        }
    }
}
