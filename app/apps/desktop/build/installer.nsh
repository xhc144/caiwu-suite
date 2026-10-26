; 仅检查，不强杀财务进程。用户保存/退出后重试；静默安装遇到运行实例会失败退出。
!include "WordFunc.nsh"
!ifdef BUILD_UNINSTALLER
  !define CAIWU_FUNCTION_PREFIX "un."
!else
  !define CAIWU_FUNCTION_PREFIX ""
!endif
Var /GLOBAL CaiwuDataFound
Var /GLOBAL CaiwuScanDepth

; 在 electron-builder 默认递归移除安装树之前拦截旧账套、备份、配置或目录链接。
; 安装与卸载都做检查；正常安装文件仍由原生 NSIS 模板卸载。
!macro customHeader
  Function ${CAIWU_FUNCTION_PREFIX}CaiwuFindData
    Exch $R0
    Push $R1
    Push $R2
    Push $R3
    IntOp $CaiwuScanDepth $CaiwuScanDepth + 1
    ${If} $CaiwuScanDepth > 64
      StrCpy $CaiwuDataFound 1
      Goto caiwu_scan_done
    ${EndIf}
    FindFirst $R1 $R2 "$R0\*.caiwu*"
    ${If} $R2 != ""
      StrCpy $CaiwuDataFound 1
    ${EndIf}
    FindClose $R1
    FindFirst $R1 $R2 "$R0\desktop-settings.json*"
    ${If} $R2 != ""
      StrCpy $CaiwuDataFound 1
    ${EndIf}
    FindClose $R1
    FindFirst $R1 $R2 "$R0\*.*"
    ${DoWhile} $R2 != ""
      ${If} $CaiwuDataFound == 1
        ${Break}
      ${EndIf}
      ${If} $R2 != "."
      ${AndIf} $R2 != ".."
        System::Call 'kernel32::GetFileAttributesW(w "$R0\$R2") i.s'
        Pop $R3
        IntOp $R3 $R3 & 0x400
        ${If} $R3 != 0
          ; 不跟随 junction/symlink，也不冒险对其执行递归删除。
          StrCpy $CaiwuDataFound 1
        ${Else}
          System::Call 'kernel32::GetFileAttributesW(w "$R0\$R2") i.s'
          Pop $R3
          IntOp $R3 $R3 & 0x10
          ${If} $R3 != 0
            ${If} $R2 == "books"
            ${OrIf} $R2 == "backups"
            ${OrIf} $R2 == "backup"
            ${OrIf} $R2 == "logs"
              StrCpy $CaiwuDataFound 1
            ${Else}
              Push "$R0\$R2"
              Call ${CAIWU_FUNCTION_PREFIX}CaiwuFindData
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      FindNext $R1 $R2
    ${Loop}
    FindClose $R1
    caiwu_scan_done:
    IntOp $CaiwuScanDepth $CaiwuScanDepth - 1
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd

  Function ${CAIWU_FUNCTION_PREFIX}CaiwuGuardInstallTree
    StrCpy $CaiwuDataFound 0
    StrCpy $CaiwuScanDepth 0
    Push "$INSTDIR"
    Call ${CAIWU_FUNCTION_PREFIX}CaiwuFindData
    ${If} $CaiwuDataFound == 1
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONSTOP "安装目录中发现账套、备份、用户配置或目录链接。为保留数据，本次安装/卸载已停止。请先完整备份并将数据放到安装目录之外的独立文件夹，再重试。"
      ${EndIf}
      SetErrorLevel 3
      Quit
    ${EndIf}
    ClearErrors
  FunctionEnd
!macroend

!macro customCheckAppRunning
  caiwu_wait_closed:
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 != 0
      ; 兼容 Wave 0 默认的中文可执行文件名；同样只提示用户保存退出。
      nsProcess::_FindProcess "财务软件.exe"
      Pop $R0
    ${EndIf}
    ${If} $R0 == 0
      IfSilent caiwu_running_abort
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先在财务软件中保存内容并退出，再点击重试。安装和卸载不会强制结束财务进程。" /SD IDCANCEL IDRETRY caiwu_wait_closed
      caiwu_running_abort:
      SetErrorLevel 2
      Quit
    ${EndIf}
    !ifndef BUILD_UNINSTALLER
      ; 手动启动安装包也不得覆盖更高版本；分别核对用户级和系统级注册信息。
      ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
      ${If} $R0 != ""
        ${VersionCompare} "$R0" "${VERSION}" $R1
        ${If} $R1 == 1
          Goto caiwu_downgrade_abort
        ${EndIf}
      ${EndIf}
      ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
      ${If} $R0 != ""
        ${VersionCompare} "$R0" "${VERSION}" $R1
        ${If} $R1 == 1
          Goto caiwu_downgrade_abort
        ${EndIf}
      ${EndIf}
      Goto caiwu_version_ok
      caiwu_downgrade_abort:
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONSTOP "已安装的财务软件版本高于本安装包。为避免旧程序误读新版账套，本次安装已停止。请使用更新的正式安装包；不要覆盖或回滚账套。"
      ${EndIf}
      SetErrorLevel 5
      Quit
      caiwu_version_ok:
    !endif
    Call ${CAIWU_FUNCTION_PREFIX}CaiwuGuardInstallTree
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装财务软件"
  !define MUI_WELCOMEPAGE_TEXT "安装文件与账套数据分开保存。默认账套在文档目录下的「财务账套」，也可在软件的文件菜单中更改位置。$\r$\n$\r$\n覆盖安装前请先备份、保存内容并退出旧实例。升级失败不会删除原账套。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载财务软件"
  !define MUI_WELCOMEPAGE_TEXT "卸载仅删除软件安装文件和快捷方式。$\r$\n$\r$\n账套、备份及用户配置将保留在原位置，不会随卸载删除。请先保存内容并退出财务软件。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInstall
  DetailPrint "保留账套、备份和用户配置；未对数据目录执行删除操作。"
!macroend

; 锁版 NSIS 模板仍识别 --delete-app-data，即使 deleteAppDataOnUninstall=false。
; 本产品的卸载约定是保留用户数据，显式拒绝该参数，避免隐藏路径删除用户配置。
!macro customUnInit
  Push $R0
  Push $R1
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "卸载将保留账套、备份及用户配置，不支持删除用户数据参数。请移除该参数后重试。"
    ${EndIf}
    SetErrorLevel 4
    Quit
  ${EndIf}
  Pop $R1
  Pop $R0
  ClearErrors
!macroend
