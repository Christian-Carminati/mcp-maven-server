// Helper to read all stdin and echo it (used by maven-intercept.bat on Windows)
var stdin = '';
while (!WScript.StdIn.AtEndOfStream) {
    stdin += WScript.StdIn.ReadAll();
}
WScript.Echo(stdin);
