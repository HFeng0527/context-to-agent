namespace ContextToAgent
{
    internal static class BridgeRuntime
    {
        private static readonly object SyncRoot = new object();
        private static BridgeClient _bridgeClient;
        private static AgentConfigService _agentConfigService;

        public static BridgeClient BridgeClient
        {
            get
            {
                lock (SyncRoot)
                {
                    return _bridgeClient ?? (_bridgeClient = new BridgeClient(InstanceIdentity.GetOrCreate()));
                }
            }
        }

        public static AgentConfigService AgentConfigService
        {
            get
            {
                lock (SyncRoot)
                {
                    return _agentConfigService ?? (_agentConfigService = new AgentConfigService());
                }
            }
        }
    }
}
