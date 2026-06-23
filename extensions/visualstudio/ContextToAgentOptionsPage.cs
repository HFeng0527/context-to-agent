using Microsoft.VisualStudio.Shell;
using System.Windows;

namespace ContextToAgent
{
    public sealed class ContextToAgentOptionsPage : UIElementDialogPage
    {
        private BridgeSettingsControl _control;

        protected override UIElement Child
        {
            get
            {
                return _control ?? (_control = new BridgeSettingsControl(BridgeRuntime.BridgeClient, BridgeRuntime.AgentConfigService));
            }
        }

        public override void LoadSettingsFromStorage()
        {
            base.LoadSettingsFromStorage();
            if (_control != null)
            {
                _ = _control.RefreshAsync();
            }
        }
    }
}
