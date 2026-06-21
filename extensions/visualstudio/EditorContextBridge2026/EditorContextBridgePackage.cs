using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell;
using System;
using System.Runtime.InteropServices;
using System.Threading;
using Task = System.Threading.Tasks.Task;

namespace EditorContextBridge2026
{
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [Guid(PackageGuidString)]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideAutoLoad(Microsoft.VisualStudio.Shell.Interop.UIContextGuids80.NoSolution, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideAutoLoad(Microsoft.VisualStudio.Shell.Interop.UIContextGuids80.SolutionExists, PackageAutoLoadFlags.BackgroundLoad)]
    public sealed class EditorContextBridgePackage : AsyncPackage
    {
        public const string PackageGuidString = "cfd2b31d-7820-4015-b91f-f1b36f6d926f";
        private DTE2 _dte;
        private BridgeClient _bridgeClient;
        private EditorStateCollector _collector;
        private DocumentEvents _documentEvents;
        private WindowEvents _windowEvents;
        private string _instanceId;

        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            var dte = await GetServiceAsync(typeof(DTE)) as DTE2;
            if (dte == null) throw new InvalidOperationException("DTE service is unavailable.");
            _dte = dte;
            _instanceId = InstanceIdentity.GetOrCreate();
            _bridgeClient = new BridgeClient(_instanceId);
            _collector = new EditorStateCollector(_dte);
            await BridgeSettingsCommand.InitializeAsync(this, _bridgeClient);
            WireEditorEvents();
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
            if (disposing) _bridgeClient?.Dispose();
            base.Dispose(disposing);
        }
    }
}
