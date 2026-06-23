param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [string]$OutputDirectory = "",

    [switch]$SkipVerify,
    [switch]$SkipVisualStudio,
    [switch]$SkipVSCode
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Action
}

function Invoke-CommandChecked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    # PowerShell's call operator (&) does not reliably forward splatted
    # arguments to .cmd/.bat shims on Windows.  Use cmd /c as a safe wrapper
    # that always passes the remaining tokens verbatim to the child process.
    Push-Location $WorkingDirectory
    try {
        if ($Arguments.Count -eq 0) {
            cmd /c $FilePath
        } else {
            cmd /c "$FilePath $Arguments"
        }
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath exited with code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Get-LatestVsSdkToolsPath {
    $packagesRoot = Join-Path $env:USERPROFILE ".nuget\packages\microsoft.vssdk.buildtools"
    if (-not (Test-Path $packagesRoot)) {
        return $null
    }

    $package = Get-ChildItem $packagesRoot -Directory |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1

    if (-not $package) {
        return $null
    }

    $tools = Join-Path $package.FullName "tools"
    if (Test-Path $tools) {
        return $tools
    }

    return $null
}

function Get-XmlAttribute {
    param(
        [string]$Path,
        [string]$ElementName,
        [string]$AttributeName
    )

    [xml]$xml = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $namespace = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $namespace.AddNamespace("vsx", "http://schemas.microsoft.com/developer/vsx-schema/2011")
    $node = $xml.SelectSingleNode("//vsx:$ElementName", $namespace)
    if (-not $node) {
        throw "Could not find <$ElementName> in $Path"
    }

    return $node.GetAttribute($AttributeName)
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot "artifacts"
}
else {
    $OutputDirectory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

if (-not $SkipVerify) {
    Invoke-Step "Verify project" {
        Invoke-CommandChecked -FilePath "npm" -Arguments @("run", "verify") -WorkingDirectory $repoRoot
    }
}

$packages = @()

if (-not $SkipVisualStudio) {
    Invoke-Step "Package Visual Studio VSIX" {
        $project = Join-Path $repoRoot "extensions\visualstudio\ContextToAgent.csproj"
        $manifest = Join-Path $repoRoot "extensions\visualstudio\source.extension.vsixmanifest"
        $version = Get-XmlAttribute -Path $manifest -ElementName "Identity" -AttributeName "Version"
        $vsixPath = Join-Path $OutputDirectory "ContextToAgent-visualstudio-$version.vsix"
        $projectDir = Split-Path -Parent $project
        $outputPath = Join-Path $projectDir "bin\$Configuration\net472\"
        $intermediatePath = Join-Path $projectDir "obj\$Configuration\net472\"
        $assemblyPath = Join-Path $outputPath "ContextToAgent.dll"
        $vstoolsPath = Get-LatestVsSdkToolsPath

        Invoke-CommandChecked -FilePath "dotnet" -Arguments @("restore", $project) -WorkingDirectory $repoRoot

        $msbuildArgs = @(
            "msbuild",
            $project,
            "/t:Build;GeneratePkgDef;CreateVsixContainer",
            "/p:Configuration=$Configuration",
            "/p:IntermediateOutputPath=$intermediatePath",
            "/p:OutputPath=$outputPath",
            "/p:OutDir=$outputPath",
            "/p:CreatePkgDefAssemblyToProcess=$assemblyPath",
            "/p:TargetVsixContainer=$vsixPath",
            "/p:DeployExtension=false"
        )

        if ($vstoolsPath) {
            $msbuildArgs += "/p:VSToolsPath=$vstoolsPath"
        }

        Invoke-CommandChecked -FilePath "dotnet" -Arguments $msbuildArgs -WorkingDirectory $repoRoot

        if (-not (Test-Path $vsixPath)) {
            throw "Visual Studio VSIX was not created: $vsixPath"
        }

        $script:packages += $vsixPath
    }
}

if (-not $SkipVSCode) {
    Invoke-Step "Package VS Code VSIX" {
        $vscodeDir = Join-Path $repoRoot "extensions\vscode"
        $manifest = Join-Path $vscodeDir "package.json"
        $packageJson = [System.IO.File]::ReadAllText($manifest, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        $vsixPath = Join-Path $OutputDirectory "ContextToAgent-vscode-$($packageJson.version).vsix"

        Invoke-CommandChecked -FilePath "npx" -Arguments @("--yes", "@vscode/vsce", "package", "--out", $vsixPath) -WorkingDirectory $vscodeDir

        if (-not (Test-Path $vsixPath)) {
            throw "VS Code VSIX was not created: $vsixPath"
        }

        $script:packages += $vsixPath
    }
}

Write-Host ""
Write-Host "Packages created:" -ForegroundColor Green
foreach ($package in $packages) {
    Write-Host "  $package"
}
