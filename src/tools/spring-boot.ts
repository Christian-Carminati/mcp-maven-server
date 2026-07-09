import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';
import { SpringBootManager } from '../utils/spring-boot-manager.js';

const springBootManager = new SpringBootManager();

export function registerSpringBootTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'springBootRun',
    'Start the Spring Boot application. Captures logs and detects port/startup.',
    {
      module: z.string().optional().describe('Module name (for multi-module projects)'),
      profile: z.string().optional().describe('Spring profile (e.g. "dev", "production")'),
      waitForStartup: z.boolean().optional().default(false).describe('If true, waits for Tomcat/Netty startup confirmation before returning'),
    },
    async ({ module, profile, waitForStartup }) => {
      const baseDir = context.projectInfo?.moduleDir ?? process.cwd();
      const modulePath = module && context.projectInfo
        ? joinPaths(context.projectInfo.projectRoot, module)
        : baseDir;
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const id = `${moduleName}:${modulePath}`;

      try {
        const instance = await springBootManager.start(id, modulePath, moduleName, {
          profile: profile ?? undefined,
          startupTimeout: waitForStartup ? context.config.springBootStartupTimeout : 5000,
        });
        return { content: [{ type: 'text', text: JSON.stringify(instance) }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        };
      }
    },
  );

  server.tool(
    'springBootStop',
    'Stop the Spring Boot application gracefully (actuator shutdown first, SIGTERM fallback)',
    { module: z.string().optional() },
    async ({ module }) => {
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const id = `${moduleName}:${context.projectInfo?.moduleDir ?? process.cwd()}`;

      await springBootManager.stop(id);
      return { content: [{ type: 'text', text: JSON.stringify({ stopped: true, instance: id }) }] };
    },
  );

  server.tool(
    'springBootStatus',
    'Get the current status of the Spring Boot application (port, PID, uptime, health)',
    { module: z.string().optional() },
    async ({ module }) => {
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const id = `${moduleName}:${context.projectInfo?.moduleDir ?? process.cwd()}`;
      const instance = springBootManager.get(id);

      if (!instance) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'STOPPED' }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(instance) }] };
    },
  );

  server.tool(
    'springBootRestart',
    'Restart the Spring Boot application (stop then start)',
    {
      module: z.string().optional(),
      profile: z.string().optional(),
    },
    async ({ module, profile }) => {
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const baseId = `${moduleName}:${context.projectInfo?.moduleDir ?? process.cwd()}`;

      await springBootManager.stop(baseId);

      const baseDir = context.projectInfo?.moduleDir ?? process.cwd();
      const modulePath = module && context.projectInfo
        ? joinPaths(context.projectInfo.projectRoot, module)
        : baseDir;

      try {
        const instance = await springBootManager.start(baseId, modulePath, moduleName, {
          profile: profile ?? undefined,
          startupTimeout: context.config.springBootStartupTimeout,
        });
        return { content: [{ type: 'text', text: JSON.stringify(instance) }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        };
      }
    },
  );

  server.tool(
    'springBootLogs',
    'Get the most recent log lines from the running Spring Boot application',
    {
      module: z.string().optional(),
      lines: z.number().optional().default(50).describe('Number of log lines to return'),
    },
    async ({ module, lines }) => {
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const id = `${moduleName}:${context.projectInfo?.moduleDir ?? process.cwd()}`;
      const instance = springBootManager.get(id);

      if (!instance) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Spring Boot is not running' }) }] };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(instance.logs.slice(-lines)) }],
      };
    },
  );
}

function joinPaths(base: string, sub: string): string {
  return `${base}/${sub}`;
}
