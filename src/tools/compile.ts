import { z } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ToolContext } from '../core/types.js';
import { runMaven, buildGoalArgs } from '../maven/runner.js';
import { parseCompilationOutput } from '../maven/parser.js';

export function registerCompileTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'compileProject',
    'Compile the Maven project and return structured compilation errors',
    {
      module: z.string().optional().describe('Maven module name (for multi-module projects)'),
      profile: z.string().optional().describe('Maven profile to activate'),
    },
    async ({ module, profile }) => {
      const args = buildGoalArgs(['compile'], {
        module,
        profile: profile ? [profile] : undefined,
      });
      const result = await runMaven(context.config, { args });

      if (result.exitCode === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, errors: [], warnings: 0, errorCount: 0 }) }],
        };
      }

      const parsed = parseCompilationOutput(result.stdout + result.stderr);
      if (parsed.errors.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              errors: [{ file: '', line: 0, column: 0, severity: 'ERROR', message: `Build failed with exit code ${result.exitCode}` }],
              warnings: 0,
              errorCount: 1,
            }),
          }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(parsed) }],
      };
    },
  );

  server.tool(
    'getCompilationErrors',
    'Run compile and return only the structured error list (no success noise)',
    {
      module: z.string().optional(),
      profile: z.string().optional(),
    },
    async ({ module, profile }) => {
      const args = buildGoalArgs(['compile'], { module, profile: profile ? [profile] : undefined });
      const result = await runMaven(context.config, { args });
      const parsed = parseCompilationOutput(result.stdout + result.stderr);

      return {
        content: [{ type: 'text', text: JSON.stringify(parsed.errors) }],
      };
    },
  );
}
