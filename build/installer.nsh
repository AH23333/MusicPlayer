!ifdef BUILD_UNINSTALLER
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var /GLOBAL mpKeepData

!macro customUnInstall
  ${GetParameters} $R9
  ${GetOptions} $R9 "/S" $R9
  ${IfNot} ${Errors}
    StrCpy $mpKeepData "1"
  ${Else}
    MessageBox MB_YESNO|MB_ICONQUESTION "是否保留用户数据（播放列表、我的收藏、本地导入的歌曲等）?$\r$\n$\r$\n选择“是”：数据保留在原安装目录，重装到同一位置可自动恢复$\r$\n选择“否”：将删除全部用户数据" IDYES mpu_keep IDNO mpu_del
    mpu_keep:
      StrCpy $mpKeepData "1"
      Goto mpu_done
    mpu_del:
      StrCpy $mpKeepData "0"
    mpu_done:
  ${EndIf}
!macroend

Function un.mpCleanInstDir
  FindFirst $0 $1 "$INSTDIR\*.*"
  mp_loop:
    StrCmp $1 "" mp_done
    StrCmp $1 "." mp_next
    StrCmp $1 ".." mp_next
    StrCmp $1 "resources" mp_next
    IfFileExists "$INSTDIR\$1\*.*" mp_isdir mp_isfile
    mp_isdir:
      RMDir /r "$INSTDIR\$1"
      Goto mp_next
    mp_isfile:
      Delete "$INSTDIR\$1"
    mp_next:
      FindNext $0 $1
      Goto mp_loop
  mp_done:
    FindClose $0
FunctionEnd

Function un.mpCleanResourcesDir
  FindFirst $2 $3 "$INSTDIR\resources\*.*"
  mpr_loop:
    StrCmp $3 "" mpr_done
    StrCmp $3 "." mpr_next
    StrCmp $3 ".." mpr_next
    StrCmp $3 "app" mpr_next
    IfFileExists "$INSTDIR\resources\$3\*.*" mpr_isdir mpr_isfile
    mpr_isdir:
      RMDir /r "$INSTDIR\resources\$3"
      Goto mpr_next
    mpr_isfile:
      Delete "$INSTDIR\resources\$3"
    mpr_next:
      FindNext $2 $3
      Goto mpr_loop
  mpr_done:
    FindClose $2
FunctionEnd

Function un.mpCleanAppDir
  FindFirst $4 $5 "$INSTDIR\resources\app\*.*"
  mpa_loop:
    StrCmp $5 "" mpa_done
    StrCmp $5 "." mpa_next
    StrCmp $5 ".." mpa_next
    ${If} $mpKeepData == "1"
      StrCmp $5 "MyFavorite.json" mpa_next
      StrCmp $5 "Latest.json" mpa_next
      StrCmp $5 "FollowedArtists.json" mpa_next
      StrCmp $5 "DIYSongList.json" mpa_next
      StrCmp $5 "PlayList.json" mpa_next
      StrCmp $5 "SearchHistory.json" mpa_next
      StrCmp $5 "log.txt" mpa_next
      StrCmp $5 "DIYSongListPage" mpa_next
      StrCmp $5 "ImportLocalSongs" mpa_next
    ${EndIf}
    IfFileExists "$INSTDIR\resources\app\$5\*.*" mpa_isdir mpa_isfile
    mpa_isdir:
      RMDir /r "$INSTDIR\resources\app\$5"
      Goto mpa_next
    mpa_isfile:
      Delete "$INSTDIR\resources\app\$5"
    mpa_next:
      FindNext $4 $5
      Goto mpa_loop
  mpa_done:
    FindClose $4
FunctionEnd

!macro customRemoveFiles
  SetOutPath $TEMP
  Call un.mpCleanInstDir
  Call un.mpCleanResourcesDir
  Call un.mpCleanAppDir
  RMDir "$INSTDIR\resources\app"
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR"
  ${If} $mpKeepData == "0"
    RMDir /r "$APPDATA\music_player"
    RMDir /r "$LOCALAPPDATA\music_player"
  ${EndIf}
!macroend
!endif
