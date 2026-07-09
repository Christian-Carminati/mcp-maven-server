import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';
import { runMaven, buildGoalArgs } from '../maven/runner.js';
import { parseCompilationOutput } from '../maven/parser.js';
import { readAllReports, aggregateResults } from '../maven/reports.js';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function registerBuildTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'verifyProject',
    'Run mvn verify — compile, test, and integration-check the project',
    {
      module: z.string().optional(),
      profile: z.string().optional(),
    },
    async ({ module, profile }) => {
      const args = buildGoalArgs(['verify'], { module, profile: profile ? [profile] : undefined });
      const result = await runMaven(context.config, { args });
      const parsed = parseCompilationOutput(result.stdout + result.stderr);

      const targetDir = context.projectInfo ? join(context.projectInfo.moduleDir, 'target') : 'target';
      const surefireDir = join(targetDir, 'surefire-reports');
      const failsafeDir = join(targetDir, 'failsafe-reports');

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
    },
    async ({ module, profile, skipTests }) => {
      const args = buildGoalArgs(['package'], { module, profile: profile ? [profile] : undefined, skipTests });
      const result = await runMaven(context.config, { args });

      let artifactPath = '';
      const targetDir = context.projectInfo ? join(context.projectInfo.moduleDir, 'target') : 'target';
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
    },
    async ({ module }) => {
      const args = buildGoalArgs(['clean'], { module });
      const result = await runMaven(context.config, { args });
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
    },
    async ({ args, module }) => {
      const allArgs = module ? ['-pl', module, '-am', ...args] : args;
      const result = await runMaven(context.config, { args: allArgs });
      const parsed = parseCompilationOutput(result.stdout + result.stderr);

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
