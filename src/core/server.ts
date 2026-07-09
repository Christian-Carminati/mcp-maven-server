import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type McpMavenConfig, type ToolContext } from './types.js';
import { ProcessManager } from '../maven/process-manager.js';
import { loadConfig } from './config.js';

export interface McpMavenState {
  server: McpServer;
  context: ToolContext;
}

export function createServer(): McpMavenState {
  const config: McpMavenConfig = loadConfig();
  const processManager = new ProcessManager();

  const server = new McpServer({
    name: 'mcp-maven',
    version: '0.1.0',
  });

  const context: ToolContext = {
    projectInfo: null,
    config,
    processManager,
  };

  return { server, context };
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
