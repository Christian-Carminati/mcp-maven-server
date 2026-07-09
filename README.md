# MCP Maven Server

An MCP (Model Context Protocol) server that wraps Maven and Spring Boot operations for Claude Code. Provides structured JSON output instead of raw build logs — saving tokens and allowing Claude to focus on code fixes.

## Prerequisites

- **Node.js** 18+ (with npm)
- **Maven** 3.6+ (in PATH or configured via `MCP_MAVEN_COMMAND`)
- **Java** 8–21+ (detected automatically)

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

Add to `~\.claude.json`:

```json
{
  "mcpServers": {
    "mcp-maven": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\Java\\mcp-maven-server\\dist\\index.js"],
      "env": {
        "MCP_MAVEN_TIMEOUT_MS": "300000",
        "MCP_MAVEN_MAX_LOG_LINES": "500",
        "MCP_MAVEN_COMMAND": "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.3.6\\plugins\\maven\\lib\\maven3\\bin\\mvn.cmd"
      }
    }
  }
}
```

> `MCP_MAVEN_COMMAND` is optional — set it if `mvn` is not in your system PATH.
> Omitting it makes the server look for `mvn` via PATH.

### 2. Block Maven via Bash (Permissions)

Add to `~\.claude\settings.json`:

```json
{
  "permissions": {
    "deny": ["Bash(mvn *)", "Bash(./mvnw *)", "Bash(java -jar *)"]
  }
}
```

### 3. PreToolUse Hook (Bash Interception)

Add to `~\.claude\settings.json`:

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
getCoverageReport,
springBootRun, springBootStop, springBootRestart, springBootStatus, springBootLogs,
getProjectInfo, getJavaInfo, getMavenInfo, ping,
getCacheInfo, clearCache.

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
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `compileProject` | Compile with structured error output (file, line, column, message) | `projectPath`, `module`, `profile` |
| `verifyProject` | Compile + test + integration-check | `projectPath`, `module`, `profile` |
| `packageProject` | Build JAR/WAR artifact (skips tests by default) | `projectPath`, `module`, `skipTests` |
| `cleanProject` | Clean build artifacts | `projectPath`, `module` |
| `executeMavenCommand` | Run arbitrary Maven with parsed error output | `projectPath`, `args[]` |

### Test
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `runTests` | Execute tests with **build cache** (second call is instant) | `projectPath`, `module`, `profile`, `force`, `parallel` |
| `runSingleTest` | Run one test class | `projectPath`, `className` |
| `runSingleMethod` | Run one test method | `projectPath`, `className`, `methodName` |
| `getFailedTests` | Read failed tests without re-running | `projectPath`, `module` |
| `getTestReports` | Read existing reports from disk | `projectPath`, `module` |

> **`runTests` caching:** By default, checks if any source/test files changed since the last run.
> If nothing changed, returns cached results *instantly* — no Maven execution.
> Use `force: true` to bypass cache and re-run all tests.
> Use `parallel: true` (default) for parallel execution (`-T 2 -DforkCount=2`).
> Response includes `_cached: true` flag when served from cache.

### Cache Management
| Tool | Description |
|------|-------------|
| `getCacheInfo` | Show which modules are cached and how old |
| `clearCache` | Invalidate cache for a module (or all) |

### Coverage
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `getCoverageReport` | Read JaCoCo coverage report (lines, branches, methods per package) | `projectPath`, `generate` (run `jacoco:report` first) |

### Spring Boot
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `springBootRun` | Start the application (detects port, captures logs) | `projectPath`, `profile`, `waitForStartup` |
| `springBootStop` | Stop gracefully (actuator shutdown first, SIGTERM fallback) | `projectPath`, `module` |
| `springBootRestart` | Restart the app | `projectPath`, `profile` |
| `springBootStatus` | Check status, port, PID, health endpoint | `projectPath`, `module` |
| `springBootLogs` | View recent log lines | `projectPath`, `lines` |

### Project Info
| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `getProjectInfo` | Detect project structure, modules, Java version | `projectPath` |
| `getJavaInfo` | Detect JDK version and vendor | `projectPath` |
| `getMavenInfo` | Get Maven version and home | — |
| `ping` | Health check | — |

> **`projectPath`**: all build/test/project tools accept an optional `projectPath` parameter.
> Use it to target a specific module without changing Claude Code's working directory.
> Example: `runTests({ projectPath: "C:/Java/BancomatPay/be-bancomatpay" })`

## Configuration

All settings are optional and configured via environment variables (set in the MCP server `env` block):

| Variable | Default | Description |
|---|---|---|
| `MCP_MAVEN_TIMEOUT_MS` | 300000 | Build timeout in milliseconds |
| `MCP_MAVEN_MAX_LOG_LINES` | 500 | Max stdout lines to keep |
| `MCP_MAVEN_SPRING_RING_BUFFER` | 500 | Spring Boot log ring buffer size |
| `MCP_MAVEN_SPRING_STARTUP_TIMEOUT` | 120000 | Max wait for Spring Boot startup |
| `MCP_MAVEN_CACHE_ENABLED` | true | Enable/disable build caching |
| `MCP_MAVEN_DEFAULT_PROFILE` | — | Default Maven profile |
| `MCP_JAVA_HOME` | — | Override JDK path |
| **`MCP_MAVEN_COMMAND`** | `mvn` | **Full path to `mvn.cmd`/`mvn` binary** (e.g. IntelliJ-bundled Maven) |
| `MCP_MAVEN_CACHE_ENABLED` | `true` | Enable/disable build cache |

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
