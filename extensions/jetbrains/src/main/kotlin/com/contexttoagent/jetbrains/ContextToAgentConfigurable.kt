package com.contexttoagent.jetbrains

import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.ui.Messages
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Font
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import java.nio.file.Path
import javax.swing.BorderFactory
import javax.swing.DefaultComboBoxModel
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JComboBox
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JSeparator
import javax.swing.JTable
import javax.swing.JTextArea
import javax.swing.ListSelectionModel
import javax.swing.event.TableModelEvent
import javax.swing.table.DefaultTableModel

internal class ContextToAgentConfigurable : SearchableConfigurable {
    private val bridge = ContextToAgentService.getInstance()
    private val agentConfig = AgentConfigService(bridge)
    private var root: JPanel? = null
    private var languageLabel: JLabel? = null
    private var languageCombo: JComboBox<LanguageOption>? = null
    private var statusArea: JTextArea? = null
    private var tableModel: DefaultTableModel? = null
    private var table: JTable? = null
    private var otherAgentsLabel: JLabel? = null
    private var guideArea: JTextArea? = null
    private var recentReadsLabel: JLabel? = null
    private var recentReadsModel: DefaultListModel<String>? = null
    private var configureAllButton: JButton? = null
    private var configureSelectedButton: JButton? = null
    private var revokeAllButton: JButton? = null
    private var revokeSelectedButton: JButton? = null
    private var resetPathButton: JButton? = null
    private var currentRows: List<AgentRow> = emptyList()
    private var initialLanguage = agentConfig.languageMode()
    private var updatingLanguage = false
    private var reloading = false

    override fun getId(): String = "contextToAgent"

    override fun getDisplayName(): String = "ContextToAgent"

    override fun createComponent(): JComponent {
        if (root != null) return root!!
        val strings = strings()
        val panel = JPanel(GridBagLayout())
        panel.border = BorderFactory.createEmptyBorder(16, 16, 16, 16)

        addFullWidth(panel, titleRow(strings), 0, Insets(0, 0, 0, 0))
        statusArea = JTextArea().also {
            it.isEditable = false
            it.isOpaque = false
            it.lineWrap = true
            it.wrapStyleWord = true
            it.border = BorderFactory.createEmptyBorder(6, 0, 0, 0)
            addFullWidth(panel, it, 1, Insets(0, 0, 0, 0))
        }
        addFullWidth(panel, JSeparator(), 2, Insets(12, 0, 0, 0))
        addFullWidth(panel, agentTable(strings), 3, Insets(12, 0, 0, 0), weightY = 1.0)

        otherAgentsLabel = sectionLabel().also { addFullWidth(panel, it, 4, Insets(16, 0, 6, 0)) }
        guideArea = JTextArea(8, 80).also {
            it.isEditable = false
            it.lineWrap = true
            it.wrapStyleWord = true
            it.font = Font(Font.MONOSPACED, Font.PLAIN, 12)
            it.border = BorderFactory.createEmptyBorder(8, 8, 8, 8)
            val scroll = JScrollPane(it)
            scroll.preferredSize = Dimension(820, 150)
            addFullWidth(panel, scroll, 5, Insets(0, 0, 0, 0), weightY = 0.85)
        }

        recentReadsLabel = sectionLabel().also { addFullWidth(panel, it, 6, Insets(16, 0, 6, 0)) }
        val listModel = DefaultListModel<String>()
        recentReadsModel = listModel
        val recentList = JList(listModel)
        val recentScroll = JScrollPane(recentList)
        recentScroll.preferredSize = Dimension(820, 90)
        addFullWidth(panel, recentScroll, 7, Insets(0, 0, 0, 0), weightY = 0.55)

        addFullWidth(panel, JSeparator(), 8, Insets(12, 0, 0, 0))
        addFullWidth(panel, buttonRow(), 9, Insets(12, 0, 0, 0))

        root = panel
        applyStrings()
        reload()
        return panel
    }

    override fun isModified(): Boolean {
        val comboChanged = selectedLanguage() != initialLanguage
        return comboChanged || changedPathRows().isNotEmpty()
    }

    override fun apply() {
        savePathsFromTable()
        selectedLanguage()?.let { agentConfig.setLanguageMode(it) }
        initialLanguage = agentConfig.languageMode()
        applyStrings()
        reload()
    }

    override fun reset() {
        initialLanguage = agentConfig.languageMode()
        applyStrings()
        reload()
    }

    override fun disposeUIResources() {
        root = null
        languageLabel = null
        languageCombo = null
        statusArea = null
        table = null
        tableModel = null
        otherAgentsLabel = null
        guideArea = null
        recentReadsLabel = null
        recentReadsModel = null
        configureAllButton = null
        configureSelectedButton = null
        revokeAllButton = null
        revokeSelectedButton = null
        resetPathButton = null
        currentRows = emptyList()
    }

    private fun titleRow(strings: UiStrings): JComponent {
        val row = JPanel(BorderLayout(8, 0))
        val title = JLabel("ContextToAgent")
        title.font = title.font.deriveFont(Font.BOLD, 18f)
        row.add(title, BorderLayout.WEST)

        val languagePanel = JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0))
        languageLabel = JLabel(strings.language)
        languageCombo = JComboBox(languageOptions(strings)).also { combo ->
            combo.preferredSize = Dimension(120, combo.preferredSize.height)
            combo.addActionListener {
                if (updatingLanguage) return@addActionListener
                selectedLanguage()?.let { language ->
                    agentConfig.setLanguageMode(language)
                    initialLanguage = agentConfig.languageMode()
                    applyStrings()
                    reload()
                }
            }
        }
        languagePanel.add(languageLabel)
        languagePanel.add(languageCombo)
        row.add(languagePanel, BorderLayout.EAST)
        return row
    }

    private fun agentTable(strings: UiStrings): JComponent {
        val model = object : DefaultTableModel(arrayOf(strings.agent, strings.scope, strings.status, strings.configPath), 0) {
            override fun isCellEditable(row: Int, column: Int): Boolean = column == CONFIG_PATH_COLUMN
        }
        model.addTableModelListener { event ->
            if (!reloading && event.type == TableModelEvent.UPDATE && event.column == CONFIG_PATH_COLUMN && event.firstRow >= 0) {
                savePathFromRow(event.firstRow)
            }
        }
        tableModel = model

        val agentTable = JTable(model).also {
            it.selectionModel.selectionMode = ListSelectionModel.SINGLE_SELECTION
            it.autoResizeMode = JTable.AUTO_RESIZE_LAST_COLUMN
            it.fillsViewportHeight = true
            it.rowHeight = 26
            it.selectionModel.addListSelectionListener { updateSelectedButtons() }
            it.tableHeader.reorderingAllowed = false
            it.columnModel.getColumn(0).preferredWidth = 160
            it.columnModel.getColumn(1).preferredWidth = 100
            it.columnModel.getColumn(2).preferredWidth = 120
            it.columnModel.getColumn(3).preferredWidth = 420
        }
        table = agentTable

        val scroll = JScrollPane(agentTable)
        scroll.preferredSize = Dimension(820, 180)
        return scroll
    }

    private fun buttonRow(): JComponent {
        val row = JPanel(FlowLayout(FlowLayout.RIGHT, 6, 0))
        configureAllButton = JButton().also { button ->
            button.addActionListener {
                runUiAction {
                    val strings = strings()
                    if (confirm(strings.configureAllPrompt, strings)) {
                        savePathsFromTable()
                        agentConfig.configureAll()
                        reload()
                    }
                }
            }
            row.add(button)
        }
        configureSelectedButton = JButton().also { button ->
            button.addActionListener {
                runUiAction {
                    saveSelectedPath()
                    val agent = selectedAgent() ?: return@runUiAction
                    val strings = strings()
                    if (confirm(strings.configureSelectedPrompt + "\n\n" + agent.name + "\n" + agent.configPath, strings)) {
                        agentConfig.configureAgent(agent.id)
                        reload(agent.id)
                    }
                }
            }
            row.add(button)
        }
        revokeAllButton = JButton().also { button ->
            button.addActionListener {
                runUiAction {
                    val strings = strings()
                    if (confirm(strings.revokeAllPrompt, strings)) {
                        savePathsFromTable()
                        currentRows.forEach { agentConfig.revokeAgent(it.id) }
                        reload()
                    }
                }
            }
            row.add(button)
        }
        revokeSelectedButton = JButton().also { button ->
            button.addActionListener {
                runUiAction {
                    saveSelectedPath()
                    val agent = selectedAgent() ?: return@runUiAction
                    val strings = strings()
                    if (confirm(strings.revokeSelectedPrompt + "\n\n" + agent.name, strings)) {
                        agentConfig.revokeAgent(agent.id)
                        reload(agent.id)
                    }
                }
            }
            row.add(button)
        }
        resetPathButton = JButton().also { button ->
            button.addActionListener {
                runUiAction {
                    val agent = selectedAgent() ?: return@runUiAction
                    val strings = strings()
                    if (confirm(strings.resetSelectedPrompt + "\n\n" + agent.name, strings)) {
                        agentConfig.resetPathOverride(agent.id)
                        reload(agent.id)
                    }
                }
            }
            row.add(button)
        }
        return row
    }

    private fun reload(selectedId: String? = selectedAgentId()) {
        val strings = strings()
        reloading = true
        try {
            statusArea?.text = runCatching { strings.bridgeReady + bridge.bridgeInfo() }.getOrDefault(strings.bridgeUnavailable)
            val statuses = runCatching { agentConfig.statuses() }.getOrElse { emptyList() }
            currentRows = statuses.map { agent ->
                AgentRow(
                    id = agent.id,
                    name = agent.name,
                    scope = scopeLabel(agent.scope, strings),
                    status = statusLabel(agent.statusKey, strings),
                    configPath = agent.configPath
                )
            }

            tableModel?.let { model ->
                model.rowCount = 0
                currentRows.forEach { row -> model.addRow(arrayOf(row.name, row.scope, row.status, row.configPath)) }
            }
            guideArea?.text = runCatching { agentConfig.configureOtherAgentsText() }.getOrDefault(strings.bridgeUnavailable)
            guideArea?.caretPosition = 0
            reloadRecentReads(strings)
        } finally {
            reloading = false
        }
        restoreSelection(selectedId)
        updateSelectedButtons()
    }

    private fun applyStrings() {
        val strings = strings()
        languageLabel?.text = strings.language
        updateLanguageOptions(strings)
        setHeader(AGENT_COLUMN, strings.agent)
        setHeader(SCOPE_COLUMN, strings.scope)
        setHeader(STATUS_COLUMN, strings.status)
        setHeader(CONFIG_PATH_COLUMN, strings.configPath)
        otherAgentsLabel?.text = strings.configureOtherAgents
        recentReadsLabel?.text = strings.recentReads
        configureAllButton?.text = strings.configureAll
        configureSelectedButton?.text = strings.configureSelected
        revokeAllButton?.text = strings.revokeAll
        revokeSelectedButton?.text = strings.revokeSelected
        resetPathButton?.text = strings.resetPath
    }

    private fun updateLanguageOptions(strings: UiStrings) {
        val combo = languageCombo ?: return
        val mode = agentConfig.languageMode()
        val options = languageOptions(strings)
        updatingLanguage = true
        try {
            combo.model = DefaultComboBoxModel(options)
            combo.selectedItem = options.firstOrNull { it.value == mode } ?: options.first()
        } finally {
            updatingLanguage = false
        }
    }

    private fun reloadRecentReads(strings: UiStrings) {
        val model = recentReadsModel ?: return
        model.clear()
        val reads = bridge.recentReads()
        if (reads.isEmpty()) {
            model.addElement(strings.noReads)
            return
        }
        reads.forEach { model.addElement(recentReadLabel(it, strings)) }
    }

    private fun savePathsFromTable() {
        commitTableEdit()
        val model = tableModel ?: return
        for (row in 0 until model.rowCount) savePathFromRow(row)
    }

    private fun saveSelectedPath() {
        commitTableEdit()
        selectedModelRow()?.let { savePathFromRow(it) }
    }

    private fun savePathFromRow(modelRow: Int) {
        val row = currentRows.getOrNull(modelRow) ?: return
        val path = tableModel?.getValueAt(modelRow, CONFIG_PATH_COLUMN)?.toString().orEmpty()
        agentConfig.savePathOverride(row.id, path)
    }

    private fun changedPathRows(): List<Pair<String, String>> {
        val defaults = runCatching { agentConfig.statuses().associateBy { it.id } }.getOrElse { return emptyList() }
        val model = tableModel ?: return emptyList()
        val changed = mutableListOf<Pair<String, String>>()
        for (row in 0 until model.rowCount) {
            val id = currentRows.getOrNull(row)?.id ?: continue
            val path = model.getValueAt(row, CONFIG_PATH_COLUMN)?.toString().orEmpty()
            if (defaults[id]?.configPath != path) changed.add(id to path)
        }
        return changed
    }

    private fun commitTableEdit() {
        val agentTable = table ?: return
        if (agentTable.isEditing) agentTable.cellEditor?.stopCellEditing()
    }

    private fun selectedAgentId(): String? = selectedAgent()?.id

    private fun selectedAgent(): AgentRow? {
        val row = selectedModelRow() ?: return null
        val current = currentRows.getOrNull(row) ?: return null
        val path = tableModel?.getValueAt(row, CONFIG_PATH_COLUMN)?.toString().orEmpty()
        return current.copy(configPath = path)
    }

    private fun selectedModelRow(): Int? {
        val selected = table?.selectedRow ?: return null
        if (selected < 0) return null
        return table?.convertRowIndexToModel(selected) ?: selected
    }

    private fun restoreSelection(selectedId: String?) {
        val agentTable = table ?: return
        val modelIndex = currentRows.indexOfFirst { it.id == selectedId }.takeIf { it >= 0 } ?: if (currentRows.isNotEmpty()) 0 else -1
        if (modelIndex >= 0) {
            val viewIndex = agentTable.convertRowIndexToView(modelIndex)
            agentTable.selectionModel.setSelectionInterval(viewIndex, viewIndex)
        } else {
            agentTable.clearSelection()
        }
    }

    private fun updateSelectedButtons() {
        val hasRows = currentRows.isNotEmpty()
        val hasSelection = selectedModelRow() != null
        configureAllButton?.isEnabled = hasRows
        revokeAllButton?.isEnabled = hasRows
        configureSelectedButton?.isEnabled = hasSelection
        revokeSelectedButton?.isEnabled = hasSelection
        resetPathButton?.isEnabled = hasSelection
    }

    private fun setHeader(column: Int, value: String) {
        val columnModel = table?.columnModel ?: return
        if (column >= columnModel.columnCount) return
        columnModel.getColumn(column).headerValue = value
        table?.tableHeader?.repaint()
    }

    private fun selectedLanguage(): String? = (languageCombo?.selectedItem as? LanguageOption)?.value

    private fun strings(): UiStrings = if (agentConfig.resolvedLanguage() == "zh-CN") UiStrings.ZhCn else UiStrings.En

    private fun languageOptions(strings: UiStrings): Array<LanguageOption> = arrayOf(
        LanguageOption("auto", strings.auto),
        LanguageOption("en", "English"),
        LanguageOption("zh-CN", "中文")
    )

    private fun sectionLabel(): JLabel = JLabel().also { it.font = it.font.deriveFont(Font.BOLD) }

    private fun addFullWidth(panel: JPanel, component: JComponent, row: Int, insets: Insets, weightY: Double = 0.0) {
        panel.add(
            component,
            GridBagConstraints().also {
                it.gridx = 0
                it.gridy = row
                it.weightx = 1.0
                it.weighty = weightY
                it.fill = if (weightY > 0.0) GridBagConstraints.BOTH else GridBagConstraints.HORIZONTAL
                it.insets = insets
            }
        )
    }

    private fun statusLabel(statusKey: String, strings: UiStrings): String = when (statusKey) {
        "configured" -> strings.configured
        "detected" -> strings.detected
        "notFound" -> strings.notFound
        else -> strings.unavailable
    }

    private fun scopeLabel(scope: String, strings: UiStrings): String = if (scope == "global") strings.globalScope else scope

    private fun recentReadLabel(read: ReadRecordPayload, strings: UiStrings): String {
        val toolName = read.toolName ?: "tools/call"
        val file = shortName(read.activeFile) ?: strings.none
        val workspace = shortName(read.activeWorkspaceRoot) ?: strings.none
        val selection = if (read.selectionEmpty == false) read.selectionLength.toString() else strings.emptySelection
        return strings.formatRecentRead(read.clientName, toolName, read.readAt.toString(), file, workspace, selection, read.errorCount)
    }

    private fun shortName(value: String?): String? {
        val trimmed = value?.trim()?.trimEnd('/', '\\')?.takeIf { it.isNotBlank() } ?: return null
        return runCatching { Path.of(trimmed).fileName?.toString() }.getOrNull() ?: trimmed.substringAfterLast('/').substringAfterLast('\\')
    }

    private fun confirm(message: String, strings: UiStrings): Boolean =
        Messages.showOkCancelDialog(message, "ContextToAgent", strings.confirm, strings.cancel, Messages.getWarningIcon()) == Messages.OK

    private fun runUiAction(action: () -> Unit) {
        try {
            action()
        } catch (error: Exception) {
            Messages.showErrorDialog(error.message ?: "ContextToAgent failed", "ContextToAgent")
        }
    }

    private data class AgentRow(
        val id: String,
        val name: String,
        val scope: String,
        val status: String,
        val configPath: String
    )

    private data class LanguageOption(val value: String, val label: String) {
        override fun toString(): String = label
    }

    private data class UiStrings(
        val agent: String,
        val auto: String,
        val bridgeReady: String,
        val bridgeUnavailable: String,
        val cancel: String,
        val configPath: String,
        val configureAll: String,
        val configureAllPrompt: String,
        val configureOtherAgents: String,
        val configureSelected: String,
        val configureSelectedPrompt: String,
        val confirm: String,
        val configured: String,
        val detected: String,
        val emptySelection: String,
        val globalScope: String,
        val language: String,
        val noReads: String,
        val none: String,
        val notFound: String,
        val recentReads: String,
        val resetPath: String,
        val resetSelectedPrompt: String,
        val revokeAll: String,
        val revokeAllPrompt: String,
        val revokeSelected: String,
        val revokeSelectedPrompt: String,
        val scope: String,
        val status: String,
        val unavailable: String,
        val recentReadFormatter: (String, String, String, String, String, String, Int) -> String
    ) {
        fun formatRecentRead(client: String, tool: String, readAt: String, file: String, workspace: String, selection: String, errors: Int): String =
            recentReadFormatter(client, tool, readAt, file, workspace, selection, errors)

        companion object {
            val En = UiStrings(
                agent = "Agent",
                auto = "Auto",
                bridgeReady = "Stdio bridge is ready through command: ",
                bridgeUnavailable = "Stdio bridge is unavailable.",
                cancel = "Cancel",
                configPath = "Config Path",
                configureAll = "Configure All",
                configureAllPrompt = "Update all supported stdio MCP configs?",
                configureOtherAgents = "Configure Other Agents",
                configureSelected = "Configure Selected",
                configureSelectedPrompt = "Update this stdio MCP config?",
                confirm = "Confirm",
                configured = "Configured",
                detected = "Detected",
                emptySelection = "empty",
                globalScope = "Global",
                language = "Language",
                noReads = "No reads yet",
                none = "none",
                notFound = "Not found",
                recentReads = "Recent reads",
                resetPath = "Reset Path",
                resetSelectedPrompt = "Reset this agent config path to its default?",
                revokeAll = "Revoke All",
                revokeAllPrompt = "Remove editor-context-jetbrains from all managed MCP configs?",
                revokeSelected = "Revoke Selected",
                revokeSelectedPrompt = "Remove editor-context-jetbrains from this MCP config?",
                scope = "Scope",
                status = "Status",
                unavailable = "Unavailable"
            ) { client, tool, readAt, file, workspace, selection, errors ->
                "$client $tool at $readAt | file: $file | workspace: $workspace | selection: $selection | errors: $errors"
            }

            val ZhCn = UiStrings(
                agent = "Agent",
                auto = "自动",
                bridgeReady = "Stdio 桥接已就绪，命令：",
                bridgeUnavailable = "Stdio 桥接不可用。",
                cancel = "取消",
                configPath = "配置路径",
                configureAll = "全部配置",
                configureAllPrompt = "更新所有支持的 stdio MCP 配置？",
                configureOtherAgents = "配置其他 Agent",
                configureSelected = "配置选中项",
                configureSelectedPrompt = "更新这个 stdio MCP 配置？",
                confirm = "确认",
                configured = "已配置",
                detected = "已检测",
                emptySelection = "空",
                globalScope = "全局",
                language = "语言",
                noReads = "暂无读取记录",
                none = "无",
                notFound = "未找到",
                recentReads = "最近读取",
                resetPath = "重置路径",
                resetSelectedPrompt = "将这个 Agent 的配置路径重置为默认值？",
                revokeAll = "全部撤销",
                revokeAllPrompt = "从所有托管 MCP 配置中移除 editor-context-jetbrains？",
                revokeSelected = "撤销选中项",
                revokeSelectedPrompt = "从这个 MCP 配置中移除 editor-context-jetbrains？",
                scope = "范围",
                status = "状态",
                unavailable = "不可用"
            ) { client, tool, readAt, file, workspace, selection, errors ->
                "$client $tool 于 $readAt | 文件：$file | 工作区：$workspace | 选区：$selection | 错误：$errors"
            }
        }
    }

    private companion object {
        const val AGENT_COLUMN = 0
        const val SCOPE_COLUMN = 1
        const val STATUS_COLUMN = 2
        const val CONFIG_PATH_COLUMN = 3
    }
}


