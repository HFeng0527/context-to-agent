using System;
using System.IO;

namespace EditorContextBridge2026
{
    internal static class InstanceIdentity
    {
        public static string GetOrCreate()
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EditorContextBridge");
            Directory.CreateDirectory(directory);
            var file = Path.Combine(directory, "visualstudio-instance-id.txt");
            if (File.Exists(file))
            {
                var existing = File.ReadAllText(file).Trim();
                if (!string.IsNullOrWhiteSpace(existing)) return existing;
            }
            var id = "visual-studio-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(file, id);
            return id;
        }
    }
}
