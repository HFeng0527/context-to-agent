using Microsoft.VisualStudio.Shell;
using System;
using System.ComponentModel.Design;
using Task = System.Threading.Tasks.Task;

namespace ContextToAgent
{
    internal sealed class BridgeSettingsCommand
    {
        private static readonly Guid CommandSet = new Guid("d6ccb87b-8d24-4915-8748-4464481054bc");
        private const int CommandId = 0x0100;

        private BridgeSettingsCommand(OleMenuCommandService commandService)
        {
            commandService.AddCommand(new MenuCommand(Execute, new CommandID(CommandSet, CommandId)));
        }

        public static async Task InitializeAsync(AsyncPackage package)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            var commandService = await ((IAsyncServiceProvider)package).GetServiceAsync(typeof(IMenuCommandService)) as OleMenuCommandService;
            if (commandService != null) _ = new BridgeSettingsCommand(commandService);
        }

        private void Execute(object sender, EventArgs e)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            new BridgeSettingsDialog().ShowDialog();
        }
    }
}

