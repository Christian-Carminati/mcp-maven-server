@echo off
setlocal enabledelayedexpansion

:: Prevent feedback loop
if "%MCP_MAVEN_HOOK_ACTIVE%"=="1" exit /b 0

:: Read stdin via JScript helper
for /f "usebackq delims=" %%a in (`cscript //nologo "%~dp0read-stdin.js"`) do set "stdin=%%a"

:: Extract command field from JSON — look for "command":"mvn", "command":"./mvnw", "command":"java -jar"
echo !stdin! | findstr /r /i "\"command\"[ 	]*:[ 	]*\"mvn" >nul
if !errorlevel! equ 0 (
    echo {"permissionDecision":"deny","systemMessage":"Maven commands via Bash are blocked. Use mcp-maven MCP tools: compileProject, runTests, verifyProject, springBootRun. See CLAUDE.md for full list."}
    exit /b 0
)

echo !stdin! | findstr /r /i "\"command\"[ 	]*:[ 	]*\"\./mvnw" >nul
if !errorlevel! equ 0 (
    echo {"permissionDecision":"deny","systemMessage":"Maven Wrapper via Bash is blocked. Use mcp-maven MCP tools instead."}
    exit /b 0
)

echo !stdin! | findstr /r /i "\"command\"[ 	]*:[ 	]*\"java -jar" >nul
if !errorlevel! equ 0 (
    echo {"permissionDecision":"deny","systemMessage":"java -jar via Bash is blocked. Use mcp-maven's springBootRun tool instead."}
    exit /b 0
)

:: Pass through for all other commands
exit /b 0
