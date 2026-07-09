import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';
import { SpringBootManager } from '../utils/spring-boot-manager.js';

const springBootManager = new SpringBootManager();

const projectPathOption = z.string().optional().describe('Path to the Maven project/module directory (defaults to current working directory)');

function resolveBaseDir(projectPath?: string): string {
  return projectPath || process.cwd();
}

function joinPaths(base: string, sub: string): string {
  return `${base}/${sub}`;
}

export function registerSpringBootTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'springBootRun',
    'Start the Spring Boot application. Captures logs and detects port/startup.',
    {
      module: z.string().optional().describe('Module name (for multi-module projects)'),
      profile: z.string().optional().describe('Spring profile (e.g. "dev", "production")'),
      waitForStartup: z.boolean().optional().default(false).describe('If true, waits for Tomcat/Netty startup confirmation before returning'),
      projectPath: projectPathOption,
    },
    async ({ module, profile, waitForStartup, projectPath }) => {
      const baseDir = resolveBaseDir(projectPath);
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
    { module: z.string().optional(), projectPath: projectPathOption },
    async ({ module, projectPath }) => {
      const baseDir = resolveBaseDir(projectPath);
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const id = `${moduleName}:${baseDir}`;

      await springBootManager.stop(id);
      return { content: [{ type: 'text', text: JSON.stringify({ stopped: true, instance: id }) }] };
    },
  );

  server.tool(
    'springBootStatus',
    'Get the current status of the Spring Boot application (port, PID, uptime, health)',
    { module: z.string().optional(), projectPath: projectPathOption },
    async ({ module, projectPath }) => {
      const baseDir = resolveBaseDir(projectPath);
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const id = `${moduleName}:${baseDir}`;
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
      projectPath: projectPathOption,
    },
    async ({ module, profile, projectPath }) => {
      const baseDir = resolveBaseDir(projectPath);
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const baseId = `${moduleName}:${baseDir}`;

      await springBootManager.stop(baseId);

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
      projectPath: projectPathOption,
    },
    async ({ module, lines, projectPath }) => {
      const baseDir = resolveBaseDir(projectPath);
      const moduleName = module ?? context.projectInfo?.moduleName ?? 'unknown';
      const id = `${moduleName}:${baseDir}`;
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
