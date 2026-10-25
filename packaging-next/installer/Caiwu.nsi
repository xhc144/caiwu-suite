; -*- coding: utf-8 -*-
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"
!ifndef PAYLOAD
  !error "PAYLOAD is required"
!endif
!ifndef HELPER
  !error "HELPER is required"
!endif
!ifndef OUTPUT
  !error "OUTPUT is required"
!endif
!ifndef PRODUCT_VERSION
  !error "PRODUCT_VERSION is required"
!endif
Name "财务套件开发预览"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\CaiwuSuite"
InstallDirRegKey HKCU "Software\CaiwuSuite\Delivery" "InstallRoot"
RequestExecutionLevel user
SetCompressor /SOLID zlib
SetDatablockOptimize on
SetDateSave off
VIProductVersion "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "Caiwu Suite Development Preview"
VIAddVersionKey /LANG=1033 "FileDescription" "Self-contained win-x64 development installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Caiwu Suite contributors"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "安装自研财务套件开发预览。账套与备份保存在程序目录之外。当前发布未签名，自动更新默认禁用。未完成生产验收。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Var DataRoot
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This package requires Windows x64." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Windows 10 or later is required; production deployment must use a currently supported Windows release." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
  ${GetParameters} $0
  ${GetOptions} $0 "/D=" $2
  ${If} ${Errors}
    ReadRegStr $1 HKCU "Software\CaiwuSuite\Delivery" "InstallRoot"
    ${If} $1 != ""
      StrCpy $INSTDIR $1
    ${EndIf}
  ${EndIf}
  ReadRegStr $DataRoot HKCU "Software\CaiwuSuite\Delivery" "DataRoot"
  ${If} $DataRoot == ""
    StrCpy $DataRoot "$LOCALAPPDATA\CaiwuSuite\Data"
  ${EndIf}
  ${GetParameters} $0
  ${GetOptions} $0 "/DATAROOT=" $1
  ${IfNot} ${Errors}
    StrCpy $DataRoot $1
  ${EndIf}
FunctionEnd
Section "Caiwu Suite" SEC_MAIN
  ReadRegStr $1 HKCU "Software\CaiwuSuite\Delivery" "InstallRoot"
  ${If} $1 != ""
    GetFullPathName $1 "$1"
    GetFullPathName $2 "$INSTDIR"
    ${If} $1 != $2
      MessageBox MB_ICONSTOP "已有安装登记在其他目录。迁移程序目录需显式恢复流程，不能作为首次安装绕过升级检查。" /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\engine"
  File /oname=Caiwu.Delivery.exe "${HELPER}"
  SetOutPath "$PLUGINSDIR\payload"
  File /r "${PAYLOAD}\*"
  ClearErrors
  ExecWait '"$PLUGINSDIR\engine\Caiwu.Delivery.exe" install "$PLUGINSDIR\payload" "$INSTDIR" "$DataRoot"' $0
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "交付工具无法启动，安全检查未完成。请保留现有账套并检查安装日志。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "安装或升级安全检查失败。请关闭程序并检查交付说明；原账套和当前版本未被切换。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ; ARP and shortcuts are created only after the atomic application activation succeeded.
  ClearErrors
  CreateDirectory "$SMPROGRAMS\CaiwuSuite"
  IfErrors metadata_failed
  CreateShortcut "$SMPROGRAMS\CaiwuSuite\财务套件.lnk" "$INSTDIR\versions\${PRODUCT_VERSION}\Caiwu.Delivery.exe" 'launch-managed "$INSTDIR"'
  IfErrors metadata_failed
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  IfErrors metadata_failed
  WriteRegStr HKCU "Software\CaiwuSuite\Delivery" "InstallRoot" "$INSTDIR"
  WriteRegStr HKCU "Software\CaiwuSuite\Delivery" "DataRoot" "$DataRoot"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite" "DisplayName" "财务套件开发预览"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite" "NoRepair" 1
  IfErrors metadata_failed
  Goto install_done
metadata_failed:
  MessageBox MB_ICONSTOP "程序文件已激活，但快捷方式或卸载登记未完成。账套和备份已保留，请检查安装目录后修复登记。" /SD IDOK
  SetErrorLevel 1
  Abort
install_done:
SectionEnd
Function un.onInit
  SetRegView 64
  SetShellVarContext current
FunctionEnd
Section "Uninstall"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\engine"
  ; The helper runs from an isolated temp directory, so installed executable files can be removed.
  File /oname=Caiwu.Delivery.exe "${HELPER}"
  ClearErrors
  ExecWait '"$PLUGINSDIR\engine\Caiwu.Delivery.exe" uninstall "$INSTDIR"' $0
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "交付工具无法启动，安全检查未完成。请保留现有账套并检查安装日志。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "卸载未完成。请关闭程序并检查安装状态；账套和备份已保留。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ReadRegStr $1 HKCU "Software\CaiwuSuite\Delivery" "InstallRoot"
  GetFullPathName $1 "$1"
  GetFullPathName $2 "$INSTDIR"
  ${If} $1 == $2
  Delete "$SMPROGRAMS\CaiwuSuite\财务套件.lnk"
  RMDir "$SMPROGRAMS\CaiwuSuite"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite"
  DeleteRegKey HKCU "Software\CaiwuSuite\Delivery"
  ${EndIf}
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\.delivery.lock"
  RMDir "$INSTDIR"
  ; No RMDir /r. Unknown files, modified program files, ledger data and backups are retained.
SectionEnd
