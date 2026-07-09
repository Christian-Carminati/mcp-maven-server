import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';
import { resolveProjectInfo } from '../project/discovery.js';
import { detectJavaInfo } from '../project/java-env.js';
import { parsePom } from '../project/pom-parser.js';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

export function registerProjectTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'getProjectInfo',
    'Detect the current Maven project structure: root, modules, Java version',
    {},
    async () => {
      const info = resolveProjectInfo(process.cwd());
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
    {},
    async () => {
      const projectInfo = resolveProjectInfo(process.cwd());
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
        const out = execSync('mvn --version 2>&1', { encoding: 'utf-8' });
        const lines = out.split('\n');
        const versionLine = lines.find(l => l.startsWith('Apache Maven'));
        const homeLine = lines.find(l => l.startsWith('Maven home'));

        return {
          content: [{ type: 'text', text: JSON.stringify({
            version: versionLine?.replace('Apache Maven ', '').trim() ?? '',
            home: homeLine?.replace('Maven home: ', '').trim() ?? '',
          }) }],
        };
      } catch {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Maven not found in PATH' }) }],
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
