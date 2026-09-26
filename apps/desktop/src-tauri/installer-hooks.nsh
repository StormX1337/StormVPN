; Remove the WireGuard tunnel service before files are deleted.
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\StormVPN.exe" /remove-tunnel'
!macroend
