import { execa } from 'execa';
import { type MavenResult, type McpMavenConfig } from '../core/types.js';

const DEFAULT_ARGS: string[] = [
  '-Duser.language=en',
  '-Dfile.encoding=UTF-8',
  '-Dstyle.color=never',
  '--batch-mode',
  '-Dmaven.test.failure.ignore=true',
];

let cachedMavenCommand: string | null = null;

export async function detectMaven(): Promise<string> {
  if (cachedMavenCommand) return cachedMavenCommand;

  // 1. Env var override (MCP_MAVEN_COMMAND in MCP server env)
  const envOverride = process.env.MCP_MAVEN_COMMAND;
  if (envOverride) {
    cachedMavenCommand = envOverride;
    return cachedMavenCommand;
  }

  // 2. Try 'mvn' from PATH (works if Maven is in Windows/macOS/Linux PATH)
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

  // 3. Fallback: use 'mvn' anyway — will fail with a clear error at runtime
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
