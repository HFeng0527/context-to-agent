package com.contexttoagent.jetbrains

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.absolutePathString

internal object BridgePaths {
    fun dataDir(): Path {
        val home = Path.of(System.getProperty("user.home"))
        val os = System.getProperty("os.name").lowercase()
        return when {
            os.contains("win") -> Path.of(System.getenv("APPDATA") ?: home.resolve("AppData").resolve("Roaming").toString(), "context-to-agent")
            os.contains("mac") -> home.resolve("Library").resolve("Application Support").resolve("context-to-agent")
            else -> Path.of(System.getenv("XDG_STATE_HOME") ?: home.resolve(".local").resolve("state").toString(), "context-to-agent")
        }
    }

    fun registryPath(): Path = dataDir().resolve("jetbrains-instance.json")

    fun settingsPath(): Path {
        val home = Path.of(System.getProperty("user.home"))
        val os = System.getProperty("os.name").lowercase()
        val appData = when {
            os.contains("win") -> Path.of(System.getenv("APPDATA") ?: home.resolve("AppData").resolve("Roaming").toString())
            os.contains("mac") -> home.resolve("Library").resolve("Application Support")
            else -> Path.of(System.getenv("XDG_CONFIG_HOME") ?: home.resolve(".config").toString())
        }
        return appData.resolve("ContextToAgent").resolve("JetBrains").resolve("agent-paths.json")
    }

    fun launcherPath(): Path {
        val os = System.getProperty("os.name").lowercase()
        return dataDir().resolve(if (os.contains("win")) "context-to-agent-stdio-jetbrains.cmd" else "context-to-agent-stdio-jetbrains")
    }

    fun javaExecutable(): String {
        val javaHome = Path.of(System.getProperty("java.home"))
        val exe = if (System.getProperty("os.name").lowercase().contains("win")) "java.exe" else "java"
        return javaHome.resolve("bin").resolve(exe).absolutePathString()
    }

    fun pluginClasspath(): String {
        val descriptor = PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID))
        val pluginPath = descriptor?.pluginPath ?: error("ContextToAgent plugin path is unavailable")
        val lib = pluginPath.resolve("lib")
        if (!Files.isDirectory(lib)) return pluginPath.absolutePathString()
        return Files.list(lib).use { paths ->
            paths
                .filter { Files.isRegularFile(it) && it.fileName.toString().endsWith(".jar", ignoreCase = true) }
                .map { it.absolutePathString() }
                .sorted()
                .toList()
                .joinToString(File.pathSeparator)
        }.ifBlank { pluginPath.absolutePathString() }
    }
}
