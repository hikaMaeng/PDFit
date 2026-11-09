Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
keyFile = folder & "\client-public-key.txt"
If Not fs.FileExists(keyFile) Then
  WScript.Echo "client-public-key.txt is missing. Save the other PC's public key to that file first."
  WScript.Quit 1
End If

Set shell = CreateObject("Shell.Application")
arguments = "-NoExit -NoProfile -ExecutionPolicy Bypass -File """ & folder & "\Approve-Client-Key.ps1"" -PublicKeyPath """ & keyFile & """"
shell.ShellExecute "powershell.exe", arguments, "", "runas", 1
