[CmdletBinding()]
param([string]$Destination = (Join-Path $env:LOCALAPPDATA 'Programs/CaiwuPreview'))
$ErrorActionPreference = 'Stop'
if (Get-Process -Name 'Caiwu.Desktop' -ErrorAction SilentlyContinue) {
    throw '请先关闭财务套件，再安装或更新。'
}
if ([IO.Path]::GetFullPath($Destination).TrimEnd('\') -eq [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')) {
    throw '目标目录与解压目录相同，无需安装。可直接启动 Caiwu.Desktop.exe。'
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Get-ChildItem $PSScriptRoot -File | Copy-Item -Destination $Destination -Force
Get-ChildItem $PSScriptRoot -Directory | ForEach-Object { Copy-Item $_.FullName -Destination $Destination -Recurse -Force }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '财务套件开发预览.lnk'))
$shortcut.TargetPath = Join-Path $Destination 'Caiwu.Desktop.exe'
$shortcut.WorkingDirectory = $Destination
$shortcut.Save()
Write-Output "已复制程序并创建桌面快捷方式：$Destination"
Write-Output '此为未签名开发预览。账套、备份请保存在程序目录以外；更新不删除用户账套。'
