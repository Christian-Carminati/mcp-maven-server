import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';
import { runMaven, buildGoalArgs } from '../maven/runner.js';
import { parseCompilationOutput } from '../maven/parser.js';
import { readAllReports, aggregateResults } from '../maven/reports.js';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const projectPathOption = z.string().optional().describe('Path to the Maven project/module directory (defaults to current working directory)');

function resolveBaseDir(projectPath?: string): string {
  return projectPath || process.cwd();
}

export function registerBuildTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'verifyProject',
    'Run mvn verify — compile, test, and integration-check the project',
    {
      module: z.string().optional(),
      profile: z.string().optional(),
      projectPath: projectPathOption,
    },
    async ({ module, profile, projectPath }) => {
      const cwd = resolveBaseDir(projectPath);
      const args = buildGoalArgs(['verify'], { module, profile: profile ? [profile] : undefined });
      const result = await runMaven(context.config, { args, cwd });
      const parsed = parseCompilationOutput(result.stdout + result.stderr);

      const surefireDir = join(cwd, 'target', 'surefire-reports');
      const failsafeDir = join(cwd, 'target', 'failsafe-reports');

      const testResults = aggregateResults([
        ...readAllReports(surefireDir).map(r => join(surefireDir, `TEST-${r.className}.xml`)),
        ...readAllReports(failsafeDir).map(r => join(failsafeDir, `TEST-${r.className}.xml`)),
      ]);

      return {
        content: [{ type: 'text', text: JSON.stringify({ compilation: parsed, tests: testResults }) }],
      };
    },
  );

  server.tool(
    'packageProject',
    'Package the project as JAR/WAR (skip tests by default)',
    {
      module: z.string().optional(),
      profile: z.string().optional(),
      skipTests: z.boolean().optional().default(true),
      projectPath: projectPathOption,
    },
    async ({ module, profile, skipTests, projectPath }) => {
      const cwd = resolveBaseDir(projectPath);
      const args = buildGoalArgs(['package'], { module, profile: profile ? [profile] : undefined, skipTests });
      const result = await runMaven(context.config, { args, cwd });

      let artifactPath = '';
      const targetDir = join(cwd, 'target');
      if (existsSync(targetDir)) {
        try {
          const files = readdirSync(targetDir);
          const artifact = files.find(f => /\.(jar|war)$/.test(f) && !f.endsWith('-sources.jar'));
          if (artifact) artifactPath = join(targetDir, artifact);
        } catch { /* ignore */ }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          artifactPath,
          duration: result.duration,
        }) }],
      };
    },
  );

  server.tool(
    'cleanProject',
    'Clean the project (mvn clean)',
    {
      module: z.string().optional(),
      projectPath: projectPathOption,
    },
    async ({ module, projectPath }) => {
      const cwd = resolveBaseDir(projectPath);
      const args = buildGoalArgs(['clean'], { module });
      const result = await runMaven(context.config, { args, cwd });
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          duration: result.duration,
        }) }],
      };
    },
  );

  server.tool(
    'executeMavenCommand',
    'Execute an arbitrary Maven command with custom arguments. Output is parsed for errors.',
    {
      args: z.array(z.string()).describe('Maven arguments (e.g. ["dependency:tree", "-DoutputFile=deps.txt"])'),
      module: z.string().optional(),
      projectPath: projectPathOption,
    },
    async ({ args, module, projectPath }) => {
      const cwd = resolveBaseDir(projectPath);
      const allArgs = module ? ['-pl', module, '-am', ...args] : args;
      const result = await runMaven(context.config, { args: allArgs, cwd });
      const parsed = parseCompilationOutput(result.stdout + result.stderr);

      if (!result.success && parsed.errors.length === 0) {
        // Include raw output tail when no structured errors were parsed
        const rawTail = result.stdout.split('\n').slice(-20).join('\n');
        parsed.errors.push({
          file: '',
          line: 0,
          column: 0,
          severity: 'ERROR',
          message: `Maven command failed (exit ${result.exitCode}). Last output lines:\n${rawTail}`,
        });
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          errors: parsed.errors,
          warnings: parsed.warnings,
          duration: result.duration,
        }) }],
      };
    },
  );
}
