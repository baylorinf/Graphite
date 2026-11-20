# Windows PowerShell 5.1: keep this script ASCII; pass all Unicode paths through environment variables or a UTF-8 list.
param([string]$List)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Release-OfficeObject($item) {
    if ($null -ne $item -and [Runtime.InteropServices.Marshal]::IsComObject($item)) {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($item)
    }
}

function Convert-One([string]$source, [string]$dest) {
    $app = $null
    $document = $null
    $ownApplication = $false
    $stage = 'source'
    $code = ''
    try {
        $source = [IO.Path]::GetFullPath($source.Replace('/', '\'))
        $dest = [IO.Path]::GetFullPath($dest.Replace('/', '\'))
        $item = Get-Item -LiteralPath $source
        if ($item.PSIsContainer -or $item.Length -eq 0) { $code = 'officeInvalidDocument'; throw 'Empty file or directory.' }
        $ext = $item.Extension.ToLowerInvariant()
        $slides = @('.ppt','.pptx') -contains $ext
        if (!$slides -and @('.doc','.docx') -notcontains $ext) { $code = 'officeInvalidDocument'; throw 'Unsupported extension.' }
        if ($ext -eq '.docx' -or $ext -eq '.pptx') {
            # Password-encrypted OOXML uses an OLE container. Do not open a blocking password dialog.
            $stream = [IO.File]::Open($source, 'Open', 'Read', 'ReadWrite, Delete')
            try {
                $signature = New-Object byte[] 8
                [void]$stream.Read($signature,0,8)
                if ([BitConverter]::ToString($signature) -eq 'D0-CF-11-E0-A1-B1-1A-E1') {
                    $code = 'officeProtected'; throw 'Encrypted document or legacy container.'
                }
                $stage = 'validate'
                Add-Type -AssemblyName System.IO.Compression
                $stream.Position = 0
                $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Read, $true)
                try {
                    if (!$zip.GetEntry('[Content_Types].xml') -or !$zip.GetEntry('_rels/.rels')) {
                        throw 'Invalid Office Open XML package.'
                    }
                } finally { $zip.Dispose() }
            } finally { $stream.Dispose() }
        }
        $stage = 'output'
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))
        $stage = 'start'
        if ($slides) {
            # PowerPoint can reuse an existing process even when it has no open presentations.
            $alreadyRunning = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
            $app = New-Object -ComObject PowerPoint.Application
            $ownApplication = !$alreadyRunning -and $app.Presentations.Count -eq 0 -and $app.Windows.Count -eq 0
            $stage = 'open'
            # Untitled opens a new copy, even if the user already has this exact source open.
            $document = $app.Presentations.Open($source, -1, -1, 0)
            $stage = 'export'
            $document.SaveAs($dest, 32)
        } else {
            $app = New-Object -ComObject Word.Application
            $ownApplication = $true
            $app.Visible = $false
            $app.DisplayAlerts = 0
            $app.AutomationSecurity = 3
            $stage = 'open'
            # ConfirmConversions=false, ReadOnly=true, AddToRecentFiles=false.
            $document = $app.Documents.Open($source, $false, $true, $false)
            $stage = 'export'
            $document.ExportAsFixedFormat($dest, 17)
        }
        return @{ ok = $true }
    } catch {
        $reason = $_.Exception.GetBaseException()
        $hr = '0x{0:X8}' -f $reason.HResult
        if (!$code) {
            if ($stage -eq 'source' -and $_.CategoryInfo.Category -eq 'ObjectNotFound') { $code = 'officeSourceMissing' }
            elseif ($stage -eq 'source') { $code = 'officeSourceUnreadable' }
            elseif ($stage -eq 'validate') { $code = 'officeInvalidDocument' }
            elseif ($stage -eq 'start') { $code = 'officeUnavailable' }
            elseif ($stage -eq 'open') { $code = 'officeOpenFailed' }
            else { $code = 'officeExportFailed' }
        }
        return @{ ok = $false; code = $code; hresult = $hr; detail = $reason.Message }
    } finally {
        if ($null -ne $document) {
            try { if ($slides) { $document.Close() } else { $document.Close(0) } } catch {}
            Release-OfficeObject $document
        }
        if ($null -ne $app) {
            try {
                if ($ownApplication) {
                    if ($slides) { if ($app.Presentations.Count -eq 0 -and $app.Windows.Count -eq 0) { $app.Quit() } }
                    else { if ($app.Documents.Count -eq 0) { $app.Quit() } }
                }
            } catch {}
            Release-OfficeObject $app
        }
    }
}

if ($List) {
    # Older installed import.js reads this text protocol.
    foreach ($pair in (Get-Content -LiteralPath $List -Encoding UTF8)) {
        if ($pair -notmatch '\|') { continue }
        $source, $dest = $pair.Split('|',2)
        $result = Convert-One $source $dest
        if ($result.ok) { [Console]::WriteLine("ok $source") }
        else { [Console]::WriteLine("FAIL $source - " + $result.code + ': ' + $result.detail) }
    }
} else {
    $result = Convert-One $env:GRAPHITE_SRC $env:GRAPHITE_OUT
    [Console]::WriteLine(($result | ConvertTo-Json -Compress))
    if (!$result.ok) { exit 1 }
}
