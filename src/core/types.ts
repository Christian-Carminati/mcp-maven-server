import type { ChildProcessByStdio } from 'node:child_process';

// ============================================================
// Core — Shared Types
// ============================================================

// --- Compilation ---
export interface CompileError {
  file: string;
  line: number;
  column: number;
  severity: 'ERROR' | 'WARNING';
  code?: string;
  message: string;
}

export interface CompilationResult {
  success: boolean;
  errors: CompileError[];
  warnings: number;
  errorCount: number;
}

// --- Build ---
export interface MavenResult {
  success: boolean;
  exitCode: number;
  duration: number;
  timedOut: boolean;
  killed: boolean;
}

// --- Test Reports ---
export interface TestSummary {
  totalTests: number;
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  totalClasses: number;
  timeSeconds: number;
}

export interface TestCase {
  name: string;
  classname: string;
  timeSeconds: number;
  status: 'PASSED' | 'FAILED' | 'ERROR' | 'SKIPPED';
  message?: string;
  type?: string;
  stackTrace?: string;
}

export interface TestClassResult {
  className: string;
  packageName: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  timeSeconds: number;
  testCases: TestCase[];
}

export interface TestResults {
  summary: TestSummary;
  byClass: TestClassResult[];
  failedOnly: TestClassResult[];
}

// --- Project ---
export interface ModuleInfo {
  name: string;
  path: string;
  pomPath: string;
}

export interface ProjectInfo {
  projectRoot: string;
  moduleDir: string;
  moduleName: string | null;
  isMultiModule: boolean;
  modules: ModuleInfo[];
  javaVersion: string;
  mavenCommand: string;
  mavenVersion: string;
  hasWrapper: boolean;
}

export interface JavaInfo {
  version: string;
  home: string;
  vendor: string;
  source: 'project-config' | 'mvn-version' | 'env' | 'path' | 'override';
}

export interface MavenInfo {
  version: string;
  home: string;
}

// --- Spring Boot ---
export type SpringBootStatus = 'STARTING' | 'RUNNING' | 'STOPPED' | 'CRASHED';

export interface SpringBootInstance {
  pid: number;
  modulePath: string;
  moduleName: string;
  port: number;
  startTime: Date;
  status: SpringBootStatus;
  logs: string[];
  healthEndpoint: string;
}

// --- Server Config ---
export interface McpMavenConfig {
  timeoutMs: number;
  maxLogLines: number;
  springBootRingBuffer: number;
  springBootStartupTimeout: number;
  cacheEnabled: boolean;
  defaultProfile: string;
  sonarHostUrl: string;
  sonarToken: string;
  sonarProjectKey: string;
}

// --- MCP Tool Context ---
export interface ProcessManager {
  register(id: string, child: ChildProcessByStdio<null, null, null>): void;
  kill(id: string): Promise<void>;
  killAll(): Promise<void>;
  isRunning(id: string): boolean;
}

export interface ToolContext {
  projectInfo: ProjectInfo | null;
  config: McpMavenConfig;
  processManager: ProcessManager;
}
