param(
    [Parameter(Mandatory = $true)]
    [string] $PipeName,
    [string] $ClientName = "MCP client"
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Test-HasId($value) {
    if ($null -eq $value) { return $false }
    return $value.PSObject.Properties.Name -contains "id"
}

function Get-RequestIds($line) {
    $parsed = $line | ConvertFrom-Json
    $ids = @()
    if ($line.TrimStart().StartsWith("[")) {
        foreach ($item in @($parsed)) {
            if (Test-HasId $item) { $ids += $item.id }
        }
    } elseif (Test-HasId $parsed) {
        $ids += $parsed.id
    }
    return $ids
}

function Add-ClientName($value) {
    if ($null -eq $value) { return $value }
    if ($value -is [System.Array]) {
        return @($value | ForEach-Object { Add-ClientName $_ })
    }
    if ($value -is [psobject]) {
        if ($value.PSObject.Properties.Name -contains "_clientName") {
            $value._clientName = $ClientName
        } else {
            $value | Add-Member -NotePropertyName "_clientName" -NotePropertyValue $ClientName
        }
    }
    return $value
}

function Convert-WithClientName($line) {
    $parsed = $line | ConvertFrom-Json
    if ($line.TrimStart().StartsWith("[")) {
        return ConvertTo-Json -InputObject @(Add-ClientName $parsed) -Depth 32 -Compress
    }
    return ConvertTo-Json -InputObject (Add-ClientName $parsed) -Depth 32 -Compress
}

function Write-JsonRpcError($ids, $code, $message) {
    if ($null -eq $ids -or $ids.Count -eq 0) { return }
    $responses = @()
    foreach ($id in @($ids)) {
        $responses += [ordered]@{
            jsonrpc = "2.0"
            id = $id
            error = [ordered]@{
                code = $code
                message = $message
            }
        }
    }
    if ($responses.Count -eq 1) {
        [Console]::Out.WriteLine(($responses[0] | ConvertTo-Json -Depth 12 -Compress))
    } else {
        [Console]::Out.WriteLine(($responses | ConvertTo-Json -Depth 12 -Compress))
    }
    [Console]::Out.Flush()
}

function Invoke-Bridge($line) {
    $client = New-Object System.IO.Pipes.NamedPipeClientStream(".", $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    try {
        $client.Connect(2000)
        $encoding = New-Object System.Text.UTF8Encoding($false)
        $reader = New-Object System.IO.StreamReader($client, $encoding)
        $writer = New-Object System.IO.StreamWriter($client, $encoding)
        $writer.AutoFlush = $true
        $writer.WriteLine($line)
        return $reader.ReadLine()
    } finally {
        $client.Dispose()
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    try {
        $ids = @(Get-RequestIds $line)
    } catch {
        Write-JsonRpcError @($null) -32700 $_.Exception.Message
        continue
    }

    if ($ids.Count -eq 0) { continue }

    try {
        $response = Invoke-Bridge (Convert-WithClientName $line)
        if (![string]::IsNullOrWhiteSpace($response)) {
            [Console]::Out.WriteLine($response)
            [Console]::Out.Flush()
        }
    } catch {
        Write-JsonRpcError $ids -32000 "Visual Studio extension is unavailable. Open Visual Studio and enable ContextToAgent."
    }
}
