import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';
import { resolveProjectInfo } from '../project/discovery.js';
import { detectJavaInfo } from '../project/java-env.js';
import { parsePom } from '../project/pom-parser.js';
import { detectMaven, runMaven } from '../maven/runner.js';
import { join } from 'node:path';

const projectPathOption = z.string().optional().describe('Path to the Maven project/module directory (defaults to current working directory)');

export function registerProjectTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'getProjectInfo',
    'Detect the current Maven project structure: root, modules, Java version',
    { projectPath: projectPathOption },
    async ({ projectPath }) => {
      const cwd = projectPath || process.cwd();
      const info = resolveProjectInfo(cwd);
      if (!info) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'No pom.xml found in current or parent directories' }) }],
        };
      }
      context.projectInfo = info;
      return { content: [{ type: 'text', text: JSON.stringify(info) }] };
    },
  );

  server.tool(
    'getJavaInfo',
    'Detect which JDK is being used — from JAVA_HOME, mvn --version, or PATH',
    { projectPath: projectPathOption },
    async ({ projectPath }) => {
      const cwd = projectPath || process.cwd();
      const projectInfo = resolveProjectInfo(cwd);
      const pom = projectInfo
        ? parsePom(join(projectInfo.projectRoot, 'pom.xml'))
        : { groupId: '', artifactId: '', version: '', packaging: 'jar', parent: null, properties: {}, modules: [], dependencies: [] };
      const info = detectJavaInfo(pom);
      return { content: [{ type: 'text', text: JSON.stringify(info) }] };
    },
  );

  server.tool(
    'getMavenInfo',
    'Get Maven version and path from mvn --version',
    {},
    async () => {
      try {
        const mvnCmd = await detectMaven();
        const result = await runMaven(context.config, { args: ['--version'] });
        if (!result.success) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Maven not found', path: mvnCmd }) }],
          };
        }
        const lines = result.stdout.split('\n');
        const versionLine = lines.find((l: string) => l.startsWith('Apache Maven'));
        const homeLine = lines.find((l: string) => l.startsWith('Maven home'));

        return {
          content: [{ type: 'text', text: JSON.stringify({
            version: versionLine?.replace('Apache Maven ', '').trim() ?? '',
            home: homeLine?.replace('Maven home: ', '').trim() ?? '',
            command: mvnCmd,
          }) }],
        };
      } catch {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Maven not found' }) }],
        };
      }
    },
  );

  server.tool(
    'ping',
    'Health check — verify the MCP server is alive and responding',
    {},
    async () => {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
        }) }],
      };
    },
  );
}
