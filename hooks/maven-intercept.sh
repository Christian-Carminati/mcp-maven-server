#!/bin/bash
# PreToolUse hook: intercept mvn commands via Bash and redirect to MCP tools

# Prevent recursion
if [ "$MCP_MAVEN_HOOK_ACTIVE" = "1" ]; then
    exit 0
fi

# Read stdin (JSON from Claude Code)
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"command"[[:space:]]*:[[:space:]]*"//;s/"$//')

# Block mvn, ./mvnw, and java -jar commands
case "$COMMAND" in
    mvn*|./mvnw*)
        echo '{"permissionDecision":"deny","systemMessage":"Maven commands via Bash are blocked. Use mcp-maven MCP tools: compileProject, runTests, verifyProject, springBootRun. See CLAUDE.md for full list."}'
        exit 0
        ;;
    "java -jar"*)
        echo '{"permissionDecision":"deny","systemMessage":"java -jar via Bash is blocked. Use mcp-maven'\''s springBootRun tool instead."}'
        exit 0
        ;;
esac

# Allow all other commands
exit 0
