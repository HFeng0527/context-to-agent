using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace ContextToAgent
{
    internal sealed class EditorStateCollector
    {
        private readonly DTE2 _dte;
        public EditorStateCollector(DTE2 dte) => _dte = dte;

        public EditorInstanceUpdate Collect()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var activeFile = _dte.ActiveDocument?.FullName;
            var root = SolutionRoot();
            var selection = Selection();
            return new EditorInstanceUpdate
            {
                Source = "visual_studio",
                DisplayName = DisplayName(),
                WorkspaceRoots = root == null ? new List<string>() : new List<string> { root },
                ActiveWorkspaceRoot = root,
                ActiveFile = string.IsNullOrWhiteSpace(activeFile) ? null : activeFile,
                Cursor = selection?.Active,
                Selection = selection,
                Errors = Errors(root, activeFile),
                OpenFiles = OpenFiles(),
                LastActiveAt = DateTimeOffset.UtcNow
            };
        }

        private string DisplayName()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var version = _dte.Version ?? string.Empty;
            if (version.StartsWith("17.", StringComparison.Ordinal)) return "Visual Studio 2022";
            if (version.StartsWith("18.", StringComparison.Ordinal)) return "Visual Studio 2026";
            return "Visual Studio";
        }

        private string SolutionRoot()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (_dte.Solution == null || string.IsNullOrWhiteSpace(_dte.Solution.FullName))
            {
                var activeFile = _dte.ActiveDocument?.FullName;
                return string.IsNullOrWhiteSpace(activeFile) ? null : Path.GetDirectoryName(activeFile);
            }
            return Path.GetDirectoryName(_dte.Solution.FullName);
        }

        private SelectionPayload Selection()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!(_dte.ActiveDocument?.Object("TextDocument") is TextDocument textDocument)) return null;
            var textSelection = textDocument.Selection;
            var text = textSelection.Text;
            var isEmpty = string.IsNullOrEmpty(text);
            var anchor = ToPosition(textSelection.AnchorPoint);
            var active = ToPosition(textSelection.ActivePoint);
            var start = BeforeOrEqual(anchor, active) ? anchor : active;
            var end = BeforeOrEqual(anchor, active) ? active : anchor;
            return new SelectionPayload { IsEmpty = isEmpty, Start = start, End = end, Active = active, Text = isEmpty ? null : text };
        }

        private static PositionPayload ToPosition(TextPoint point)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            return new PositionPayload { Line = Math.Max(0, point.Line - 1), Character = Math.Max(0, point.LineCharOffset - 1) };
        }

        private static bool BeforeOrEqual(PositionPayload left, PositionPayload right)
        {
            if (left.Line != right.Line) return left.Line < right.Line;
            return left.Character <= right.Character;
        }

        private List<string> OpenFiles()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var files = new List<string>();
            foreach (Document document in _dte.Documents)
            {
                if (!string.IsNullOrWhiteSpace(document.FullName)) files.Add(document.FullName);
            }
            return files;
        }

        private List<DiagnosticErrorPayload> Errors(string root, string activeFile)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var errors = new List<DiagnosticErrorPayload>();
            try
            {
                var items = _dte.ToolWindows.ErrorList.ErrorItems;
                for (short i = 1; i <= items.Count && errors.Count < 50; i++)
                {
                    var item = items.Item(i);
                    if (item == null || item.ErrorLevel != vsBuildErrorLevel.vsBuildErrorLevelHigh) continue;
                    var file = item.FileName;
                    if (string.IsNullOrWhiteSpace(file)) continue;
                    if (!Path.IsPathRooted(file) && !string.IsNullOrWhiteSpace(root)) file = Path.Combine(root, file);
                    if (!string.IsNullOrWhiteSpace(root) && !file.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                    errors.Add(new DiagnosticErrorPayload
                    {
                        File = file,
                        Range = new RangePayload { Start = new PositionPayload { Line = Math.Max(0, item.Line - 1), Character = Math.Max(0, item.Column - 1) }, End = new PositionPayload { Line = Math.Max(0, item.Line - 1), Character = Math.Max(0, item.Column) } },
                        Message = item.Description,
                        Code = null,
                        Source = item.Project
                    });
                }
            }
            catch { return errors; }
            return errors.OrderByDescending(error => string.Equals(error.File, activeFile, StringComparison.OrdinalIgnoreCase)).ThenBy(error => error.File, StringComparer.OrdinalIgnoreCase).ThenBy(error => error.Range.Start.Line).Take(50).ToList();
        }
    }
}
