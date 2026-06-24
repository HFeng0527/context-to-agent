plugins {
    kotlin("jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.2.1"
}

group = "local.context-to-agent"
version = "0.1.15"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

kotlin {
    jvmToolchain(21)
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
        pluginVerifier()
        zipSigner()
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "local.context-to-agent.jetbrains"
        name = "ContextToAgent"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "243"
            untilBuild = provider { null }
        }
        description = """
            ContextToAgent exposes the current JetBrains IDE editor context to desktop agents through a stdio MCP bridge.
        """.trimIndent()
        changeNotes = "Initial JetBrains implementation matching the VS Code and Visual Studio stdio-first bridge."
    }
}

tasks {
    patchPluginXml {
        sinceBuild.set("243")
        untilBuild.set(provider { null })
    }
}
