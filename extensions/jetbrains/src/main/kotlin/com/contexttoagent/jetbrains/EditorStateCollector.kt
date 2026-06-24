package com.contexttoagent.jetbrains

import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.vfs.VirtualFile
import java.time.OffsetDateTime

internal object EditorStateCollector {
    fun collect(project: Project, lastActiveAt: OffsetDateTime): EditorInstanceUpdate {
        val application = ApplicationManager.getApplication()
        return application.runReadAction<EditorInstanceUpdate> {
            val editor = FileEditorManager.getInstance(project).selectedTextEditor
            val activeFile = editor?.virtualFile()?.path
            val workspaceRoots = workspaceRoots(project)
            val activeWorkspaceRoot = activeFile?.let { findWorkspaceRoot(it, workspaceRoots) } ?: workspaceRoots.firstOrNull()
            val openFiles = FileEditorManager.getInstance(project).openFiles.map { it.path }
            EditorInstanceUpdate(
                source = "jetbrains",
                displayName = displayName(),
                workspaceRoots = workspaceRoots,
                activeWorkspaceRoot = activeWorkspaceRoot,
                activeFile = activeFile,
                cursor = editor?.cursorPosition(),
                selection = editor?.selectionPayload(),
                errors = collectErrors(project, editor, openFiles, activeFile),
                openFiles = openFiles,
                lastActiveAt = lastActiveAt
            )
        }
    }

    private fun displayName(): String {
        val info = ApplicationInfo.getInstance()
        return info.fullApplicationName.takeIf { it.isNotBlank() } ?: "JetBrains IDE"
    }

    private fun workspaceRoots(project: Project): List<String> {
        val roots = ProjectRootManager.getInstance(project).contentRoots.map { it.path }.distinct()
        return roots.ifEmpty { listOfNotNull(project.basePath) }
    }

    private fun findWorkspaceRoot(file: String, roots: List<String>): String? {
        val normalizedFile = normalize(file)
        return roots.filter { normalizedFile.startsWith(normalize(it)) }.maxByOrNull { it.length }
    }

    private fun normalize(value: String): String = value.replace('\\', '/').lowercase().trimEnd('/')

    private fun Editor.virtualFile(): VirtualFile? = FileDocumentManager.getInstance().getFile(document)

    private fun Editor.cursorPosition(): PositionPayload {
        val position = caretModel.primaryCaret.logicalPosition
        return PositionPayload(position.line.coerceAtLeast(0), position.column.coerceAtLeast(0))
    }

    private fun Editor.selectionPayload(): SelectionPayload {
        val caret = caretModel.primaryCaret
        val hasSelection = caret.hasSelection()
        val start = offsetToLogicalPosition(caret.selectionStart)
        val end = offsetToLogicalPosition(caret.selectionEnd)
        val active = caret.logicalPosition
        return SelectionPayload(
            isEmpty = !hasSelection,
            start = PositionPayload(start.line.coerceAtLeast(0), start.column.coerceAtLeast(0)),
            end = PositionPayload(end.line.coerceAtLeast(0), end.column.coerceAtLeast(0)),
            active = PositionPayload(active.line.coerceAtLeast(0), active.column.coerceAtLeast(0)),
            text = if (hasSelection) caret.selectedText else null
        )
    }

    private fun collectErrors(project: Project, activeEditor: Editor?, openFiles: List<String>, activeFile: String?): List<DiagnosticErrorPayload> {
        val errors = mutableListOf<DiagnosticErrorPayload>()
        val activeDocument = activeEditor?.document
        val documents = linkedSetOf<Document>()
        if (activeDocument != null) documents.add(activeDocument)
        for (file in FileEditorManager.getInstance(project).openFiles) {
            FileDocumentManager.getInstance().getDocument(file)?.let { documents.add(it) }
        }
        for (document in documents) {
            if (errors.size >= 50) break
            val file = FileDocumentManager.getInstance().getFile(document)?.path ?: continue
            DaemonCodeAnalyzerEx.processHighlights(
                document,
                project,
                HighlightSeverity.ERROR,
                0,
                document.textLength
            ) { highlight ->
                if (errors.size >= 50) return@processHighlights false
                val startOffset = highlight.actualStartOffset.coerceIn(0, document.textLength)
                val endOffset = highlight.actualEndOffset.coerceIn(startOffset, document.textLength)
                val range = offsetsToRange(document, TextRange(startOffset, endOffset))
                errors.add(
                    DiagnosticErrorPayload(
                        file = file,
                        range = range,
                        message = highlight.description ?: highlight.toolTip ?: "Error",
                        code = null,
                        source = highlight.inspectionToolId
                    )
                )
                true
            }
        }
        val open = openFiles.map { normalize(it) }.toSet()
        return errors.sortedWith(
            compareByDescending<DiagnosticErrorPayload> { activeFile != null && normalize(it.file) == normalize(activeFile) }
                .thenByDescending { open.contains(normalize(it.file)) }
                .thenBy { it.file.lowercase() }
                .thenBy { it.range.start.line }
        ).take(50)
    }

    private fun offsetsToRange(document: Document, range: TextRange): RangePayload {
        val start = document.offsetToPosition(range.startOffset)
        val end = document.offsetToPosition(range.endOffset)
        return RangePayload(
            start = start,
            end = end
        )
    }

    private fun Document.offsetToPosition(offset: Int): PositionPayload {
        val safeOffset = offset.coerceIn(0, textLength)
        val line = getLineNumber(safeOffset).coerceAtLeast(0)
        val character = (safeOffset - getLineStartOffset(line)).coerceAtLeast(0)
        return PositionPayload(line, character)
    }
}
