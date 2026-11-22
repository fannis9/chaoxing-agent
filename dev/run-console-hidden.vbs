Option Explicit
If WScript.Arguments.Count <> 3 Then WScript.Quit 64
Dim shell, command, result
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = WScript.Arguments(2)
command = Chr(34) & WScript.Arguments(0) & Chr(34) & " " & Chr(34) & WScript.Arguments(1) & Chr(34)
' WScript is a GUI host; window style 0 also hides the Node child console.
result = shell.Run(command, 0, True)
WScript.Quit result
