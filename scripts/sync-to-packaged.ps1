# Sync MusicPlayer-main -> MusicPlayer-win32-x64\resources\app
# Does NOT overwrite user JSON, DIYSongListPage, ImportLocalSongs, log.txt (keeps destination files).
# Usage: .\sync-to-packaged.ps1
# Optional: -DestRoot "D:\path\to\MusicPlayer-win32-x64\resources\app"

param(
  [string]$DestRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
if (-not $DestRoot) {
  $musicRoot = Split-Path $repoRoot -Parent
  $DestRoot = Join-Path $musicRoot "MusicPlayer-win32-x64\resources\app"
}

$src = $repoRoot
if (-not (Test-Path -LiteralPath $src)) {
  Write-Error "Source not found: $src"
  exit 1
}
if (-not (Test-Path -LiteralPath $DestRoot)) {
  Write-Error "Destination not found: $DestRoot"
  exit 1
}

Write-Host "Source: $src"
Write-Host "Destination: $DestRoot"

& robocopy $src $DestRoot /E `
  /XD "node_modules" ".git" "DIYSongListPage" "ImportLocalSongs" `
  /XF "MyFavorite.json" "Latest.json" "FollowedArtists.json" "DIYSongList.json" "PlayList.json" "SearchHistory.json" "log.txt" `
  /NFL /NDL /NJH /NJS /nc /ns /np

$code = $LASTEXITCODE
Write-Host "robocopy exit code: $code (0-7 usually OK)"

$exeSrc = Join-Path $repoRoot "music-dl-api.exe"
$resourcesParent = Split-Path $DestRoot -Parent
$exeDst = Join-Path $resourcesParent "music-dl-api.exe"
if (Test-Path -LiteralPath $exeSrc) {
  Copy-Item -LiteralPath $exeSrc -Destination $exeDst -Force
  Write-Host "Copied music-dl-api.exe to resources folder"
}

Write-Host "Done. User data JSON and DIYSongListPage/ImportLocalSongs in app folder were not overwritten."
