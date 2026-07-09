# MCP Maven Server

An MCP (Model Context Protocol) server that wraps Maven and Spring Boot operations for Claude Code. Provides structured JSON output instead of raw build logs — saving tokens and allowing Claude to focus on code fixes.

## Prerequisites

- **Node.js** 18+ (with npm)
- **Maven** 3.6+ (in PATH as `mvn`)
- **Java** 8–21 (detected automatically)

## Installation

```bash
# Clone
cd C:\Java
git clone https://github.com/Christian-Carminati/mcp-maven-server.git
cd mcp-maven-server

# Install and build
npm install
npm run build
```

## Integration with Claude Code

### 1. MCP Server Configuration

Add to `~\.claude\settings.local.json`:

```json
{
  "mcpServers": {
    "mcp-maven": {
      "command": "node",
      "args": ["C:\\Java\\mcp-maven-server\\dist\\index.js"],
      "env": {
        "MCP_MAVEN_TIMEOUT_MS": "300000",
        "MCP_MAVEN_MAX_LOG_LINES": "500"
      }
    }
  }
}
```

### 2. Block Maven via Bash (Permissions)

Prevents Claude from running `mvn`, `./mvnw`, or `java -jar` via raw Bash:

```json
{
  "permissions": {
    "deny": ["Bash(mvn *)", "Bash(./mvnw *)", "Bash(java -jar *)"]
  }
}
```

### 3. PreToolUse Hook (Bash Interception)

When Claude does try `mvn` via Bash, the hook intercepts it and redirects to the MCP tools:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "C:\\Java\\mcp-maven-server\\hooks\\maven-intercept.bat"
          }
        ]
      }
    ]
  }
}
```

### 4. CLAUDE.md Instruction

Add to `~\.claude\CLAUDE.md`:

```markdown
## Maven MCP Server
For ALL Maven operations (compile, test, verify, package, clean, spring-boot)
use ONLY the `mcp-maven` MCP tools. Available:
compileProject, runTests, runSingleTest, runSingleMethod, getFailedTests,
verifyProject, packageProject, cleanProject, executeMavenCommand,
springBootRun, springBootStop, springBootRestart, springBootStatus, springBootLogs,
getProjectInfo, getJavaInfo, getMavenInfo, ping.

The Bash tool is blocked for mvn/java commands by permission rules.
Do not attempt to run mvn via Bash — it will be denied.

### Example
- ❌ "Run `mvn test` in the terminal"
- ✅ "Run tests using mcp-maven's runTests tool"
- ❌ "Compile with `mvn compile` via Bash"
- ✅ "Compile using mcp-maven's compileProject tool"
- ❌ "Start Spring Boot with `mvn spring-boot:run`"
- ✅ "Start Spring Boot using mcp-maven's springBootRun tool"
```

## Available Tools

### Build
| Tool | Description |
|------|-------------|
| `compileProject` | Compile with structured error output (file, line, column, message) |
| `verifyProject` | Compile + test + integration-check |
| `packageProject` | Build JAR/WAR artifact (skips tests by default) |
| `cleanProject` | Clean build artifacts |
| `executeMavenCommand` | Run arbitrary Maven with parsed error output |

### Test
| Tool | Description |
|------|-------------|
| `runTests` | Execute all tests |
| `runSingleTest` | Run one test class |
| `runSingleMethod` | Run one test method |
| `getFailedTests` | Read failed tests without re-running |
| `getTestReports` | Read existing reports from disk |

### Spring Boot
| Tool | Description |
|------|-------------|
| `springBootRun` | Start the application (detects port, captures logs) |
| `springBootStop` | Stop gracefully (actuator shutdown first, SIGTERM fallback) |
| `springBootRestart` | Restart the app |
| `springBootStatus` | Check status, port, PID, health endpoint |
| `springBootLogs` | View recent log lines |

### Project Info
| Tool | Description |
|------|-------------|
| `getProjectInfo` | Detect project structure, modules, Java version |
| `getJavaInfo` | Detect JDK version and vendor |
| `getMavenInfo` | Get Maven version and home |
| `ping` | Health check |

## Configuration

All settings are optional and configure via environment variables:

| Variable | Default | Description |
|---|---|---|
| `MCP_MAVEN_TIMEOUT_MS` | 300000 | Build timeout in milliseconds |
| `MCP_MAVEN_MAX_LOG_LINES` | 500 | Max stdout lines to keep |
| `MCP_MAVEN_SPRING_RING_BUFFER` | 500 | Spring Boot log ring buffer size |
| `MCP_MAVEN_SPRING_STARTUP_TIMEOUT` | 120000 | Max wait for Spring Boot startup |
| `MCP_MAVEN_CACHE_ENABLED` | true | Enable/disable build caching |
| `MCP_MAVEN_DEFAULT_PROFILE` | — | Default Maven profile |
| `MCP_JAVA_HOME` | — | Override JDK path |

## Project Structure

```
src/
├── index.ts              # Entry point
├── core/                 # Server setup, types, config
│   ├── server.ts         # MCP server init, tool registration
│   ├── config.ts         # Environment variable loader
│   └── types.ts          # Shared TypeScript interfaces
├── project/              # Project discovery
│   ├── discovery.ts      # pom.xml upward scan, module resolution
│   ├── pom-parser.ts     # XML parser for pom.xml
│   └── java-env.ts       # JDK version detection (all sources)
├── maven/                # Maven execution
│   ├── runner.ts         # mvn process spawn with execa
│   ├── parser.ts         # Javac error parser (JDK 8–21)
│   ├── reports.ts        # Surefire/Failsafe XML reader
│   └── process-manager.ts # Process queue, cancel, timeout
├── tools/                # MCP tool implementations
│   ├── index.ts          # Tool registry
│   ├── compile.ts        # compileProject, getCompilationErrors
│   ├── test.ts           # runTests, runSingleTest, getFailedTests
│   ├── build.ts          # verifyProject, packageProject, cleanProject
│   ├── project.ts        # getProjectInfo, getJavaInfo, getMavenInfo, ping
│   └── spring-boot.ts    # Spring Boot lifecycle tools
└── utils/
    └── spring-boot-manager.ts  # Long-running process management
```

## License

MIT
