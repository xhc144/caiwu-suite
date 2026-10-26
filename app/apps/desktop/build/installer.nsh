; 仅检查，不强杀财务进程。用户保存/退出后重试；静默安装遇到运行实例会失败退出。
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
