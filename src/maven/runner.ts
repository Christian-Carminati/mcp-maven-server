import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { type MavenResult, type McpMavenConfig } from '../core/types.js';

const DEFAULT_ARGS: string[] = [
  '-Duser.language=en',
  '-Dfile.encoding=UTF-8',
  '-Dstyle.color=never',
  '--batch-mode',
  '-Dmaven.test.failure.ignore=true',
];

const MAVEN_FALLBACK_PATHS = [
  'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.3.6\\plugins\\maven\\lib\\maven3\\bin\\mvn.cmd',
  'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2024.3.4\\plugins\\maven\\lib\\maven3\\bin\\mvn.cmd',
  'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2024.2.5\\plugins\\maven\\lib\\maven3\\bin\\mvn.cmd',
  'C:\\Program Files\\JetBrains\\IntelliJ IDEA Community Edition 2025.3\\plugins\\maven\\lib\\maven3\\bin\\mvn.cmd',
  'C:\\Program Files\\Maven\\apache-maven-3.9.9\\bin\\mvn.cmd',
  'C:\\Program Files\\Maven\\apache-maven-3.8.8\\bin\\mvn.cmd',
  'C:\\ProgramData\\chocolatey\\lib\\maven\\apache-maven\\bin\\mvn.cmd',
  'C:\\tools\\apache-maven\\bin\\mvn.cmd',
];

let cachedMavenCommand: string | null = null;

export async function detectMaven(): Promise<string> {
  if (cachedMavenCommand) return cachedMavenCommand;

  // 1. Env override
  const envOverride = process.env.MCP_MAVEN_COMMAND;
  if (envOverride) {
    cachedMavenCommand = envOverride;
    return cachedMavenCommand;
  }

  // 2. Try 'mvn' from PATH
  try {
    const test = await execa('mvn', ['--version'], {
      timeout: 10_000,
      reject: false,
      windowsHide: true,
      all: true,
    });
    if (test.exitCode === 0) {
      cachedMavenCommand = 'mvn';
      return cachedMavenCommand;
    }
  } catch { /* not in PATH */ }

  // 3. Known Windows paths (IntelliJ-bundled, standalone installs)
  for (const p of MAVEN_FALLBACK_PATHS) {
    if (existsSync(p)) {
      cachedMavenCommand = p;
      return cachedMavenCommand;
    }
  }

  cachedMavenCommand = 'mvn';
  return cachedMavenCommand;
}

export function getMavenCommandSync(): string {
  return cachedMavenCommand || 'mvn';
}

export interface RunOptions {
  args: string[];
  cwd?: string;
  timeout?: number;
  maxLines?: number;
}

export async function runMaven(
  config: McpMavenConfig,
  options: RunOptions,
): Promise<MavenResult & { stdout: string; stderr: string }> {
  const mvnCommand = await detectMaven();
  const allArgs = [...DEFAULT_ARGS, ...options.args];
  const startTime = Date.now();

  try {
    const result = await execa(mvnCommand, allArgs, {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeout || config.timeoutMs,
      reject: false,
      all: true,
      windowsHide: true,
    });

    const output = result.all || '';
    const elapsed = Date.now() - startTime;

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode ?? 1,
      stdout: truncateOutput(output, options.maxLines || config.maxLogLines),
      stderr: '',
      duration: elapsed,
      timedOut: result.timedOut ?? false,
      killed: result.isCanceled ?? false,
    };
  } catch (error: any) {
    return {
      success: false,
      exitCode: -1,
      stdout: '',
      stderr: error?.message || 'Unknown error',
      duration: Date.now() - startTime,
      timedOut: false,
      killed: false,
    };
  }
}

function truncateOutput(output: string, maxLines: number): string {
  const lines = output.split('\n');
  if (lines.length <= maxLines) return output;
  return lines.slice(lines.length - maxLines).join('\n');
}

export function buildGoalArgs(goals: string[], opts?: {
  test?: string;
  method?: string;
  profile?: string[];
  skipTests?: boolean;
  module?: string;
}): string[] {
  const args: string[] = [...goals];

  if (opts?.skipTests) args.push('-DskipTests');
  if (opts?.test) args.push(`-Dtest=${opts.test}`, '-DfailIfNoTests=false');
  if (opts?.method && opts.test) args.push(`-Dtest=${opts.test}#${opts.method}`);
  if (opts?.profile?.length) {
    for (const p of opts.profile) args.push(`-P${p}`);
  }
  if (opts?.module) {
    args.push('-pl', opts.module, '-am');
  }

  return args;
}
