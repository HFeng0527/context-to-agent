using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.CommandBars;
using Microsoft.VisualStudio.Shell;
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Threading;
using Task = System.Threading.Tasks.Task;

namespace ContextToAgent
{
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [Guid(PackageGuidString)]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideOptionPage(typeof(ContextToAgentOptionsPage), "ContextToAgent", "General", 0, 0, true)]
    [ProvideAutoLoad(VSConstants.UICONTEXT.ShellInitialized_string, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideAutoLoad(Microsoft.VisualStudio.Shell.Interop.UIContextGuids80.NoSolution, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideAutoLoad(Microsoft.VisualStudio.Shell.Interop.UIContextGuids80.SolutionExists, PackageAutoLoadFlags.BackgroundLoad)]
    public sealed class ContextToAgentPackage : AsyncPackage
    {
        public const string PackageGuidString = "066fbd03-0d37-4aa5-8530-56fcf59a0716";
        private const string ExtensionsMenuCaption = "Context To Agent";
        private const string OpenSettingsCommandName = "ContextToAgent.OpenSettings";
        private const string OpenSettingsCanonicalName = "Extensions.ContextToAgent.OpenSettings";
        private DTE2 _dte;
        private BridgeClient _bridgeClient;
        private EditorStateCollector _collector;
        private DocumentEvents _documentEvents;
        private WindowEvents _windowEvents;
        private DispatcherTimer _stateTimer;
        private DispatcherTimer _extensionsMenuRetryTimer;
        private CommandBarButton _extensionsMenuButton;
        private int _extensionsMenuAttempts;
        private int _pushStateActive;

        protected override Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            _bridgeClient = BridgeRuntime.BridgeClient;
            StartBridgeInBackground();
#pragma warning disable VSTHRD010
            StartVisualStudioIntegration(cancellationToken);
#pragma warning restore VSTHRD010
            return Task.CompletedTask;
        }

        private void StartBridgeInBackground()
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _bridgeClient.EnsureIpcAsync().ConfigureAwait(false);
                    BridgeRuntime.AgentConfigService.RefreshConfiguredAgents(_bridgeClient);
                }
                catch
                {
                }
            });
        }

        private void StartVisualStudioIntegration(CancellationToken cancellationToken)
        {
            _ = JoinableTaskFactory.RunAsync(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false);
                    await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
                    var dte = await GetServiceAsync(typeof(DTE)) as DTE2;
                    if (dte == null) return;
                    _dte = dte;
                    _collector = new EditorStateCollector(_dte);
                    await BridgeSettingsCommand.InitializeAsync(this);
                    WireEditorEvents();
                    StartExtensionsMenuRetry();
                    StartStateTimer();
                    _ = PushStateAsync();
                }
                catch (OperationCanceledException)
                {
                }
                catch
                {
                }
            });
        }

        private void WireEditorEvents()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            _documentEvents = _dte.Events.DocumentEvents;
            _windowEvents = _dte.Events.WindowEvents;
            _documentEvents.DocumentOpened += OnDocumentChanged;
            _documentEvents.DocumentSaved += OnDocumentChanged;
            _windowEvents.WindowActivated += OnWindowActivated;
        }

        private void StartExtensionsMenuRetry()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (TryAddExtensionsMenuButton()) return;

            _extensionsMenuRetryTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            _extensionsMenuRetryTimer.Tick += (sender, args) =>
            {
                _extensionsMenuAttempts++;
                if (TryAddExtensionsMenuButton() || _extensionsMenuAttempts >= 10)
                {
                    _extensionsMenuRetryTimer.Stop();
                    _extensionsMenuRetryTimer = null;
                }
            };
            _extensionsMenuRetryTimer.Start();
        }

        private bool TryAddExtensionsMenuButton()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var commandBars = _dte.CommandBars as CommandBars;
                var extensionsMenu = FindExtensionsCommandBar(commandBars);
                if (extensionsMenu == null) return false;

                foreach (CommandBarControl control in extensionsMenu.Controls)
                {
                    if (!IsContextToAgentMenu(control.Caption)) continue;
                    WireExtensionsMenuButton(control);
                    return true;
                }

                if (TryAddVsCommandButton(extensionsMenu)) return true;

                var button = (CommandBarButton)extensionsMenu.Controls.Add(MsoControlType.msoControlButton, Type.Missing, Type.Missing, 1, true);
                ConfigureExtensionsMenuButton(button);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private bool TryAddVsCommandButton(CommandBar extensionsMenu)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var command = FindOpenSettingsCommand();
                if (command == null) return false;
                command.AddControl(extensionsMenu, 1);
                foreach (CommandBarControl control in extensionsMenu.Controls)
                {
                    if (!IsContextToAgentMenu(control.Caption)) continue;
                    WireExtensionsMenuButton(control);
                    return true;
                }
            }
            catch
            {
            }

            return false;
        }

        private EnvDTE.Command FindOpenSettingsCommand()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var commands = _dte.Commands;
            if (commands == null) return null;
            foreach (var name in new[] { OpenSettingsCommandName, OpenSettingsCanonicalName })
            {
                try
                {
                    return commands.Item(name, -1);
                }
                catch
                {
                }
            }

            return null;
        }

        private void WireExtensionsMenuButton(CommandBarControl control)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (control is CommandBarButton button) ConfigureExtensionsMenuButton(button);
        }

        private void ConfigureExtensionsMenuButton(CommandBarButton button)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            _extensionsMenuButton = button;
            _extensionsMenuButton.Caption = ExtensionsMenuCaption;
            _extensionsMenuButton.Tag = OpenSettingsCommandName;
            _extensionsMenuButton.Style = MsoButtonStyle.msoButtonCaption;
            try
            {
                _extensionsMenuButton.Click -= ExtensionsMenuButton_Click;
            }
            catch
            {
            }
            _extensionsMenuButton.Click += ExtensionsMenuButton_Click;
        }

        private static CommandBar FindExtensionsCommandBar(CommandBars commandBars)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (commandBars == null) return null;
            try
            {
                var menuBar = MainMenuBar(commandBars);
                foreach (CommandBarControl control in menuBar.Controls)
                {
                    if (!IsExtensionsMenu(control.Caption)) continue;
                    if (control is CommandBarPopup popup) return popup.CommandBar;
                }
            }
            catch
            {
            }

            foreach (CommandBar commandBar in commandBars)
            {
                if (IsExtensionsMenu(commandBar.Name) || IsExtensionsMenu(commandBar.NameLocal)) return commandBar;
            }

            return null;
        }

        private static CommandBar MainMenuBar(CommandBars commandBars)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                return commandBars["MenuBar"];
            }
            catch
            {
            }

            try
            {
                return commandBars["Menu Bar"];
            }
            catch
            {
            }

            foreach (CommandBar commandBar in commandBars)
            {
                if (commandBar.Type == MsoBarType.msoBarTypeMenuBar) return commandBar;
            }

            return null;
        }

        private static bool IsExtensionsMenu(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return false;
            var normalized = name.Replace("&", string.Empty).Trim();
            var paren = normalized.IndexOf("(", StringComparison.Ordinal);
            if (paren >= 0) normalized = normalized.Substring(0, paren).Trim();
            return string.Equals(normalized, "Extensions", StringComparison.OrdinalIgnoreCase) || string.Equals(normalized, "扩展", StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsContextToAgentMenu(string caption)
        {
            if (string.IsNullOrWhiteSpace(caption)) return false;
            var normalized = caption.Replace("&", string.Empty).Trim().TrimEnd('.');
            normalized = normalized.Replace(" ", string.Empty);
            return string.Equals(normalized, "ContextToAgent", StringComparison.OrdinalIgnoreCase);
        }

        private void ExtensionsMenuButton_Click(CommandBarButton ctrl, ref bool cancelDefault)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            new BridgeSettingsDialog().ShowDialog();
        }

        private void StartStateTimer()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            _stateTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            _stateTimer.Tick += (sender, args) => _ = PushStateAsync();
            _stateTimer.Start();
        }

        private void OnDocumentChanged(Document document)
        {
            _ = PushStateAsync();
        }

        private void OnWindowActivated(Window gotFocus, Window lostFocus)
        {
            _ = PushStateAsync();
        }

        private async Task PushStateAsync()
        {
            if (Interlocked.Exchange(ref _pushStateActive, 1) == 1) return;
            try
            {
                if (_bridgeClient == null) return;
                await _bridgeClient.EnsureIpcAsync().ConfigureAwait(false);
                await JoinableTaskFactory.SwitchToMainThreadAsync();
                if (_collector == null) return;
                await _bridgeClient.UpsertInstanceAsync(_collector.Collect());
            }
            catch { }
            finally
            {
                Interlocked.Exchange(ref _pushStateActive, 0);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _stateTimer?.Stop();
                _extensionsMenuRetryTimer?.Stop();
                if (_extensionsMenuButton != null)
                {
                    try
                    {
                        _extensionsMenuButton.Click -= ExtensionsMenuButton_Click;
                    }
                    catch
                    {
                    }
                    finally
                    {
                        _extensionsMenuButton = null;
                    }
                }
                _bridgeClient?.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
