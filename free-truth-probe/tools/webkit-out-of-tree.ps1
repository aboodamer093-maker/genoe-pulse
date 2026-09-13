# GENOE — out-of-tree WinCairo WebKit rebuild lane (reserved, NOT auto-run)
# -----------------------------------------------------------------------------
# Doctrine: engines\vendor\webkit is read-only ground truth. Any future rebuild
# MUST produce its binaries OUTSIDE the vendor tree. This lane configures a
# fresh Ninja/Release WinCairo build into genoe\engine\build\wincairo using
# the SAME toolchain the current verified build uses (clang-cl from LLVM).
#
# Usage (only when a rebuild is actually needed):
#   pwsh free-truth-probe\tools\webkit-out-of-tree.ps1
# -----------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$root     = Join-Path $PSScriptRoot '..\..'
$webroot  = Join-Path $root 'engines\vendor\webkit'
$bldout   = Join-Path $root 'genoe\engine\build\wincairo'
$llvm     = 'C:/Program Files/LLVM/bin'
$ninja    = Get-Command ninja -ErrorAction SilentlyContinue
if (-not $ninja) { throw 'ninja not on PATH' }

Write-Host 'GENOE OUT-OF-TREE BUILD LANE (reserved)' -ForegroundColor Yellow
Write-Host "  source : $webroot (untouched)"
Write-Host "  binary : $bldout  (out-of-tree)"

New-Item -ItemType Directory -Force -Path $bldout | Out-Null

cmake -G Ninja -S (Join-Path $webroot 'Source\cmake') -B $bldout `
  -DPORT=Win `
  -DCMAKE_BUILD_TYPE=Release `
  -DCMAKE_MAKE_PROGRAM=ninja `
  -DCMAKE_C_COMPILER="$llvm\clang-cl.exe" `
  -DCMAKE_CXX_COMPILER="$llvm\clang-cl.exe" `
  -DCMAKE_LINKER="$llvm\lld-link.exe" `
  -DENABLE_DEVELOPER_MODE=OFF

if ($LASTEXITCODE -ne 0) { throw 'cmake configure failed' }

# Build lane target exactly matches the verified engine deliverables:
#   bin/MiniBrowser.exe  bin/jsc.exe  bin/WebKitTestRunner.exe  bin/WebDriver.exe
ninja -C $bldout MiniBrowser jsc WebKitTestRunner WebDriver
if ($LASTEXITCODE -ne 0) { throw 'ninja build failed' }

Write-Host 'OUT-OF-TREE BUILD COMPLETE — verify results against engines\vendor historically' -ForegroundColor Green