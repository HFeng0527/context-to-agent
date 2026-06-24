package com.contexttoagent.jetbrains

import java.time.OffsetDateTime

internal data class PositionPayload(val line: Int, val character: Int) {
    fun toJson(): Map<String, Any?> = mapOf("line" to line, "character" to character)
}

internal data class RangePayload(val start: PositionPayload, val end: PositionPayload) {
    fun toJson(): Map<String, Any?> = mapOf("start" to start.toJson(), "end" to end.toJson())
}

internal data class SelectionPayload(
    val isEmpty: Boolean,
    val start: PositionPayload,
    val end: PositionPayload,
    val active: PositionPayload,
    val text: String?
) {
    fun toJson(): Map<String, Any?> = omitNulls(
        "isEmpty" to isEmpty,
        "start" to start.toJson(),
        "end" to end.toJson(),
        "active" to active.toJson(),
        "text" to text
    )
}

internal data class DiagnosticErrorPayload(
    val file: String,
    val range: RangePayload,
    val message: String,
    val code: String?,
    val source: String?
) {
    fun toJson(): Map<String, Any?> = omitNulls(
        "file" to file,
        "range" to range.toJson(),
        "message" to message,
        "code" to code,
        "source" to source
    )
}

internal data class EditorInstanceUpdate(
    val source: String,
    val displayName: String,
    val workspaceRoots: List<String>,
    val activeWorkspaceRoot: String?,
    val activeFile: String?,
    val cursor: PositionPayload?,
    val selection: SelectionPayload?,
    val errors: List<DiagnosticErrorPayload>,
    val openFiles: List<String>,
    val lastActiveAt: OffsetDateTime
)

internal data class ReadRecordPayload(
    val clientName: String,
    val toolName: String?,
    val connectionId: String,
    val instanceId: String,
    val activeFile: String?,
    val activeWorkspaceRoot: String?,
    val selectionEmpty: Boolean?,
    val selectionLength: Int,
    val errorCount: Int,
    val readAt: OffsetDateTime
) {
    fun toJson(): Map<String, Any?> = omitNulls(
        "clientName" to clientName,
        "toolName" to toolName,
        "connectionId" to connectionId,
        "instanceId" to instanceId,
        "activeFile" to activeFile,
        "activeWorkspaceRoot" to activeWorkspaceRoot,
        "selectionEmpty" to selectionEmpty,
        "selectionLength" to selectionLength,
        "errorCount" to errorCount,
        "readAt" to readAt.toString()
    )
}

internal fun omitNulls(vararg values: Pair<String, Any?>): Map<String, Any?> =
    linkedMapOf<String, Any?>().also { output ->
        for ((key, value) in values) {
            if (value != null) output[key] = value
        }
    }
