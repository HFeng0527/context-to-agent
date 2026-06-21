using Microsoft.VisualStudio.Shell;
using System;
using System.ComponentModel.Design;
using Task = System.Threading.Tasks.Task;

namespace ContextToAgent2026
{
    internal sealed class BridgeSettingsCommand
    {
        private static readonly Guid CommandSet = new Guid("d6ccb87b-8d24-4915-8748-4464481054bc");
        private const int CommandId = 0x0100;
        private readonly BridgeClient _bridgeClient;

        private BridgeSettingsCommand(OleMenuCommandService commandService, BridgeClient bridgeClient)
        {
            _bridgeClient = bridgeClient;
            commandService.AddCommand(new MenuCommand(Execute, new CommandID(CommandSet, CommandId)));
        }

        public static async Task InitializeAsync(AsyncPackage package, BridgeClient bridgeClient)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            var commandService = await ((IAsyncServiceProvider)package).GetServiceAsync(typeof(IMenuCommandService)) as OleMenuCommandService;
            if (commandService != null) _ = new BridgeSettingsCommand(commandService, bridgeClient);
        }

        private void Execute(object sender, EventArgs e)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            new BridgeSettingsDialog(_bridgeClient, new AgentConfigService()).ShowDialog();
        }
    }
}

