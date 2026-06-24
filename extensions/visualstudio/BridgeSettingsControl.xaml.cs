using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace ContextToAgent
{
    public partial class BridgeSettingsControl : UserControl
    {
        private readonly BridgeClient _bridgeClient;
        private readonly AgentConfigService _agentConfigService;
        private bool _updatingLanguage;

        public BridgeSettingsControl()
            : this(BridgeRuntime.BridgeClient, BridgeRuntime.AgentConfigService)
        {
        }

        internal BridgeSettingsControl(BridgeClient bridgeClient, AgentConfigService agentConfigService)
        {
            _bridgeClient = bridgeClient;
            _agentConfigService = agentConfigService;
            InitializeComponent();
            ApplyLanguageSelection();
            ApplyStrings();
            _ = RefreshAsync();
        }

        public async Task RefreshAsync()
        {
            var selectedId = SelectedAgent()?.Id;
            var strings = Strings();
            var statuses = _agentConfigService.Statuses(_bridgeClient).Select(agentStatus =>
            {
                agentStatus.Scope = agentStatus.Scope == "global" ? strings.GlobalScope : agentStatus.Scope;
                agentStatus.Status = StatusTextFor(agentStatus.StatusKey, strings);
                return agentStatus;
            }).ToList();
            AgentGrid.ItemsSource = statuses;
            if (!string.IsNullOrWhiteSpace(selectedId))
            {
                AgentGrid.SelectedItem = statuses.FirstOrDefault(agentStatus => string.Equals(agentStatus.Id, selectedId, StringComparison.OrdinalIgnoreCase));
            }

            if (AgentGrid.SelectedItem == null && statuses.Count > 0) AgentGrid.SelectedIndex = 0;
            var ipcStatus = await _bridgeClient.StatusAsync();
            StatusText.Text = ipcStatus != null ? strings.BridgeReady + ipcStatus.PipeName : strings.BridgeUnavailable;
            RecentReadsList.ItemsSource = ipcStatus?.RecentReadLabels() ?? new[] { strings.NoReads };
            OtherAgentsGuideText.Text = _agentConfigService.ConfigureOtherAgentsText(_bridgeClient, _agentConfigService.ResolvedLanguage());
            UpdateSelectedButtons();
        }

        private void ConfigureSelected_Click(object sender, RoutedEventArgs e)
        {
            _ = RunUiActionAsync(async () =>
            {
                SaveSelectedPath();
                var agent = SelectedAgent();
                if (agent == null) return;
                var strings = Strings();
                if (MessageBox.Show(strings.ConfigureSelectedPrompt + Environment.NewLine + Environment.NewLine + agent.Name + Environment.NewLine + agent.ConfigPath, "ContextToAgent", MessageBoxButton.OKCancel) == MessageBoxResult.OK)
                {
                    _agentConfigService.ConfigureAgent(_bridgeClient, agent.Id);
                    await RefreshAsync();
                }
            });
        }

        private void ConfigureAll_Click(object sender, RoutedEventArgs e)
        {
            _ = RunUiActionAsync(async () =>
            {
                var strings = Strings();
                if (MessageBox.Show(strings.ConfigureAllPrompt, "ContextToAgent", MessageBoxButton.OKCancel) == MessageBoxResult.OK)
                {
                    SavePathsFromGrid();
                    _agentConfigService.ConfigureAll(_bridgeClient);
                    await RefreshAsync();
                }
            });
        }

        private void RevokeSelected_Click(object sender, RoutedEventArgs e)
        {
            _ = RunUiActionAsync(async () =>
            {
                SaveSelectedPath();
                var agent = SelectedAgent();
                if (agent == null) return;
                var strings = Strings();
                if (MessageBox.Show(strings.RevokeSelectedPrompt + Environment.NewLine + Environment.NewLine + agent.Name, "ContextToAgent", MessageBoxButton.OKCancel) == MessageBoxResult.OK)
                {
                    _agentConfigService.RevokeAgent(_bridgeClient, agent.Id);
                    await RefreshAsync();
                }
            });
        }

        private void RevokeAll_Click(object sender, RoutedEventArgs e)
        {
            _ = RunUiActionAsync(async () =>
            {
                var strings = Strings();
                if (MessageBox.Show(strings.RevokeAllPrompt, "ContextToAgent", MessageBoxButton.OKCancel) == MessageBoxResult.OK)
                {
                    SavePathsFromGrid();
                    _agentConfigService.RevokeAll(_bridgeClient);
                    await RefreshAsync();
                }
            });
        }

        private void ResetPath_Click(object sender, RoutedEventArgs e)
        {
            _ = RunUiActionAsync(async () =>
            {
                var agent = SelectedAgent();
                if (agent == null) return;
                var strings = Strings();
                if (MessageBox.Show(strings.ResetSelectedPrompt + Environment.NewLine + Environment.NewLine + agent.Name, "ContextToAgent", MessageBoxButton.OKCancel) == MessageBoxResult.OK)
                {
                    _agentConfigService.ResetConfigPath(agent.Id);
                    await RefreshAsync();
                }
            });
        }

        private void AgentGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            UpdateSelectedButtons();
        }

        private void AgentGrid_CellEditEnding(object sender, DataGridCellEditEndingEventArgs e)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                SaveSelectedPath();
                _ = RefreshAsync();
            }), DispatcherPriority.Background);
        }

        private void LanguageCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_updatingLanguage || !(LanguageCombo.SelectedItem is ComboBoxItem item)) return;
            _agentConfigService.SetLanguageMode((string)item.Tag);
            ApplyStrings();
            _ = RefreshAsync();
        }

        private void ApplyLanguageSelection()
        {
            _updatingLanguage = true;
            try
            {
                var mode = _agentConfigService.LanguageMode();
                LanguageCombo.SelectedItem = new[] { LanguageAutoItem, LanguageEnglishItem, LanguageChineseItem }.FirstOrDefault(item => string.Equals((string)item.Tag, mode, StringComparison.OrdinalIgnoreCase)) ?? LanguageAutoItem;
            }
            finally
            {
                _updatingLanguage = false;
            }
        }

        private void ApplyStrings()
        {
            var strings = Strings();
            LanguageLabel.Text = strings.Language;
            LanguageAutoItem.Content = strings.Auto;
            LanguageEnglishItem.Content = "English";
            LanguageChineseItem.Content = "中文";
            AgentColumn.Header = strings.Agent;
            ScopeColumn.Header = strings.Scope;
            StatusColumn.Header = strings.Status;
            ConfigPathColumn.Header = strings.ConfigPath;
            OtherAgentsLabel.Text = strings.ConfigureOtherAgents;
            RecentReadsLabel.Text = strings.RecentReads;
            ConfigureSelectedButton.Content = strings.ConfigureSelected;
            ConfigureAllButton.Content = strings.ConfigureAll;
            ResetPathButton.Content = strings.ResetPath;
            RevokeSelectedButton.Content = strings.RevokeSelected;
            RevokeAllButton.Content = strings.RevokeAll;
        }

        private void SavePathsFromGrid()
        {
            AgentGrid.CommitEdit(DataGridEditingUnit.Cell, true);
            AgentGrid.CommitEdit(DataGridEditingUnit.Row, true);
            var statuses = (AgentGrid.ItemsSource as IEnumerable<AgentStatus>) ?? AgentGrid.Items.OfType<AgentStatus>().ToList();
            _agentConfigService.SaveConfigPaths(statuses, _bridgeClient);
        }

        private void SaveSelectedPath()
        {
            AgentGrid.CommitEdit(DataGridEditingUnit.Cell, true);
            AgentGrid.CommitEdit(DataGridEditingUnit.Row, true);
            var agent = SelectedAgent();
            if (agent != null) _agentConfigService.SaveConfigPath(agent, _bridgeClient);
        }

        private AgentStatus SelectedAgent()
        {
            return AgentGrid.SelectedItem as AgentStatus;
        }

        private void UpdateSelectedButtons()
        {
            var hasSelection = SelectedAgent() != null;
            ConfigureSelectedButton.IsEnabled = hasSelection;
            ResetPathButton.IsEnabled = hasSelection;
            RevokeSelectedButton.IsEnabled = hasSelection;
        }

        private UiStrings Strings()
        {
            return _agentConfigService.ResolvedLanguage() == "zh-CN" ? UiStrings.ZhCn : UiStrings.En;
        }

        private static string StatusTextFor(string statusKey, UiStrings strings)
        {
            if (statusKey == "configured") return strings.Configured;
            if (statusKey == "detected") return strings.Detected;
            if (statusKey == "notFound") return strings.NotFound;
            return strings.Unavailable;
        }

        private async Task RunUiActionAsync(Func<Task> action)
        {
            try
            {
                await action();
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "ContextToAgent", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private sealed class UiStrings
        {
            public string Agent { get; set; }
            public string Auto { get; set; }
            public string BridgeReady { get; set; }
            public string BridgeUnavailable { get; set; }
            public string ConfigPath { get; set; }
            public string ConfigureAll { get; set; }
            public string ConfigureAllPrompt { get; set; }
            public string ConfigureOtherAgents { get; set; }
            public string ConfigureSelected { get; set; }
            public string ConfigureSelectedPrompt { get; set; }
            public string Configured { get; set; }
            public string Detected { get; set; }
            public string GlobalScope { get; set; }
            public string Language { get; set; }
            public string NoReads { get; set; }
            public string NotFound { get; set; }
            public string RecentReads { get; set; }
            public string ResetPath { get; set; }
            public string ResetSelectedPrompt { get; set; }
            public string RevokeAll { get; set; }
            public string RevokeAllPrompt { get; set; }
            public string RevokeSelected { get; set; }
            public string RevokeSelectedPrompt { get; set; }
            public string Scope { get; set; }
            public string Status { get; set; }
            public string Unavailable { get; set; }

            public static readonly UiStrings En = new UiStrings
            {
                Agent = "Agent",
                Auto = "Auto",
                BridgeReady = "Stdio bridge is ready through pipe: ",
                BridgeUnavailable = "Stdio bridge is unavailable.",
                ConfigPath = "Config Path",
                ConfigureAll = "Configure All",
                ConfigureAllPrompt = "Update all supported stdio MCP configs?",
                ConfigureOtherAgents = "Configure Other Agents",
                ConfigureSelected = "Configure Selected",
                ConfigureSelectedPrompt = "Update this stdio MCP config?",
                Configured = "Configured",
                Detected = "Detected",
                GlobalScope = "Global",
                Language = "Language",
                NoReads = "No reads yet",
                NotFound = "Not found",
                RecentReads = "Recent reads",
                ResetPath = "Reset Path",
                ResetSelectedPrompt = "Reset this agent config path to its default?",
                RevokeAll = "Revoke All",
                RevokeAllPrompt = "Remove editor-context-visualstudio from all managed MCP configs?",
                RevokeSelected = "Revoke Selected",
                RevokeSelectedPrompt = "Remove editor-context-visualstudio from this MCP config?",
                Scope = "Scope",
                Status = "Status",
                Unavailable = "Unavailable"
            };

            public static readonly UiStrings ZhCn = new UiStrings
            {
                Agent = "Agent",
                Auto = "自动",
                BridgeReady = "Stdio 桥接已就绪，管道：",
                BridgeUnavailable = "Stdio 桥接不可用。",
                ConfigPath = "配置路径",
                ConfigureAll = "全部配置",
                ConfigureAllPrompt = "更新所有支持的 stdio MCP 配置？",
                ConfigureOtherAgents = "配置其他 Agent",
                ConfigureSelected = "配置选中项",
                ConfigureSelectedPrompt = "更新这个 stdio MCP 配置？",
                Configured = "已配置",
                Detected = "已检测",
                GlobalScope = "全局",
                Language = "语言",
                NoReads = "暂无读取记录",
                NotFound = "未找到",
                RecentReads = "最近读取",
                ResetPath = "重置路径",
                ResetSelectedPrompt = "将这个 Agent 的配置路径重置为默认值？",
                RevokeAll = "全部撤销",
                RevokeAllPrompt = "从所有托管 MCP 配置中移除 editor-context-visualstudio？",
                RevokeSelected = "撤销选中项",
                RevokeSelectedPrompt = "从这个 MCP 配置中移除 editor-context-visualstudio？",
                Scope = "范围",
                Status = "状态",
                Unavailable = "不可用"
            };
        }
    }
}
