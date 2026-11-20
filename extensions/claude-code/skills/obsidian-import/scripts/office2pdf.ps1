# Makes PDF copies of PowerPoint and Word files with Office itself. Originals are opened read-only.
#   office2pdf.ps1 -List <file with one "source|destination.pdf" pair per line>
# Prints "ok <src>" or "FAIL <src>: <reason>" per line.
param([Parameter(Mandatory)][string]$List)
$pairs = Get-Content -LiteralPath $List -Encoding UTF8 | Where-Object { $_ -match '\|' }
$pp = $null; $wd = $null
try {
  foreach ($line in $pairs) {
    $src, $out = $line.Split('|', 2)
    New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
    try {
      if ($src -match '\.pptx?$') {
        if (-not $pp) { $pp = New-Object -ComObject PowerPoint.Application }
        $p = $pp.Presentations.Open($src, -1, 0, 0)   # ReadOnly, Untitled=false, WithWindow=false
        $p.SaveAs($out, 32); $p.Close()                # 32 = ppSaveAsPDF
      } elseif ($src -match '\.docx?$') {
        if (-not $wd) { $wd = New-Object -ComObject Word.Application; $wd.Visible = $false; $wd.DisplayAlerts = 0 }
        $d = $wd.Documents.Open($src, $false, $true)  # ConfirmConversions=false, ReadOnly=true
        $d.ExportAsFixedFormat($out, 17); $d.Close(0)  # 17 = wdExportFormatPDF, 0 = don't save
      } else { throw "not a PowerPoint or Word file" }
      "ok $src"
    } catch { "FAIL ${src}: $($_.Exception.Message)" }
  }
} finally {
  if ($pp) { $pp.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($pp) | Out-Null }
  if ($wd) { $wd.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($wd) | Out-Null }
}
