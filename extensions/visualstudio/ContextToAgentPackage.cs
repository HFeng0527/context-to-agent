using EnvDTE;
using EnvDTE80;
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
    [ProvideAutoLoad(Microsoft.VisualStudio.Shell.Interop.UIContextGuids80.NoSolution, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideAutoLoad(Microsoft.VisualStudio.Shell.Interop.UIContextGuids80.SolutionExists, PackageAutoLoadFlags.BackgroundLoad)]
    public sealed class ContextToAgentPackage : AsyncPackage
    {
        public const string PackageGuidString = "cfd2b31d-7820-4015-b91f-f1b36f6d926f";
        private DTE2 _dte;
        private BridgeClient _bridgeClient;
        private EditorStateCollector _collector;
        private DocumentEvents _documentEvents;
        private WindowEvents _windowEvents;
        private DispatcherTimer _stateTimer;
        private DispatcherTimer _extensionsMenuRetryTimer;
        private CommandBarButton _extensionsMenuButton;
        private int _extensionsMenuAttempts;

        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            var dte = await GetServiceAsync(typeof(DTE)) as DTE2;
            if (dte == null) throw new InvalidOperationException("DTE service is unavailable.");
            _dte = dte;
            _bridgeClient = BridgeRuntime.BridgeClient;
            _collector = new EditorStateCollector(_dte);
            await BridgeSettingsCommand.InitializeAsync(this);
            WireEditorEvents();
            StartExtensionsMenuRetry();
            StartStateTimer();
            _ = PushStateAsync();
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

            _extensionsMenuRetryTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _extensionsMenuRetryTimer.Tick += (sender, args) =>
            {
                _extensionsMenuAttempts++;
                if (TryAddExtensionsMenuButton() || _extensionsMenuAttempts >= 30)
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
                    return true;
                }

                _extensionsMenuButton = (CommandBarButton)extensionsMenu.Controls.Add(MsoControlType.msoControlButton, Type.Missing, Type.Missing, 1, true);
                _extensionsMenuButton.Caption = "ContextToAgent";
                _extensionsMenuButton.Tag = "ContextToAgent.OpenSettings";
                _extensionsMenuButton.Style = MsoButtonStyle.msoButtonCaption;
                _extensionsMenuButton.Click += ExtensionsMenuButton_Click;
                return true;
            }
            catch
            {
                return false;
            }
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
            _stateTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(750) };
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
            try
            {
                await JoinableTaskFactory.SwitchToMainThreadAsync();
                await _bridgeClient.EnsureIpcAsync();
                await _bridgeClient.UpsertInstanceAsync(_collector.Collect());
            }
            catch { }
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
                        _extensionsMenuButton.Delete();
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
