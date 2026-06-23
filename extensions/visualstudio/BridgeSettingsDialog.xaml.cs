using System.Windows;

namespace ContextToAgent
{
    public partial class BridgeSettingsDialog : Window
    {
        internal BridgeSettingsDialog()
        {
            InitializeComponent();
        }

        private void Close_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}
