using Microsoft.VisualStudio.Shell;
using System;
using System.ComponentModel.Design;
using Task = System.Threading.Tasks.Task;

namespace ContextToAgent
{
    internal sealed class BridgeSettingsCommand
    {
        private static readonly Guid CommandSet = new Guid("16ae04a6-f1aa-42cc-ab3a-ce1efb25c540");
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

