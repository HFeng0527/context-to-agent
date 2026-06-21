using System;
using System.Threading.Tasks;
using System.Windows;

namespace ContextToAgent2026
{
    public partial class BridgeSettingsDialog : Window
    {
        private readonly BridgeClient _bridgeClient;
        private readonly AgentConfigService _agentConfigService;

        internal BridgeSettingsDialog(BridgeClient bridgeClient, AgentConfigService agentConfigService)
        {
            _bridgeClient = bridgeClient;
            _agentConfigService = agentConfigService;
            InitializeComponent();
            _ = RefreshAsync();
        }

        private async Task RefreshAsync()
        {
            AgentGrid.ItemsSource = _agentConfigService.Statuses(_bridgeClient);
            var status = await _bridgeClient.StatusAsync();
            StatusText.Text = status != null ? "Stdio bridge is ready through pipe: " + status.PipeName : "Stdio bridge is unavailable.";
            RecentReadsList.ItemsSource = status?.RecentReadLabels() ?? new[] { "No reads yet" };
        }

        private void StartBridge_Click(object sender, RoutedEventArgs e) => _ = RunUiActionAsync(async () => { await _bridgeClient.EnsureIpcAsync(); await RefreshAsync(); });
        private void ConfigureAll_Click(object sender, RoutedEventArgs e) => _ = RunUiActionAsync(async () => { if (MessageBox.Show("Update supported stdio MCP configs?", "Context To Agent", MessageBoxButton.OKCancel) == MessageBoxResult.OK) { _agentConfigService.ConfigureAll(_bridgeClient); await RefreshAsync(); } });
        private void RevokeAll_Click(object sender, RoutedEventArgs e) => _ = RunUiActionAsync(async () => { if (MessageBox.Show("Remove editor-context from managed MCP configs?", "Context To Agent", MessageBoxButton.OKCancel) == MessageBoxResult.OK) { _agentConfigService.RevokeAll(_bridgeClient); await RefreshAsync(); } });
        private void ConfigureOtherAgents_Click(object sender, RoutedEventArgs e) => _ = RunUiActionAsync(async () => { var text = _agentConfigService.ConfigureOtherAgentsText(_bridgeClient); Clipboard.SetText(text); MessageBox.Show(text + Environment.NewLine + Environment.NewLine + "Other agents configuration guide copied to clipboard.", "Context To Agent", MessageBoxButton.OK, MessageBoxImage.Information); await RefreshAsync(); });
        private void Close_Click(object sender, RoutedEventArgs e) => Close();

        private async Task RunUiActionAsync(Func<Task> action)
        {
            try
            {
                await action();
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "Context To Agent", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }
}
