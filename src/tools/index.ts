import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ToolContext } from '../core/types.js';
import { registerCompileTools } from './compile.js';
import { registerTestTools } from './test.js';
import { registerBuildTools } from './build.js';
import { registerProjectTools } from './project.js';
import { registerSpringBootTools } from './spring-boot.js';
import { registerCoverageTools } from './coverage.js';

export function registerAllTools(server: McpServer, context: ToolContext): void {
  registerCompileTools(server, context);
  registerTestTools(server, context);
  registerBuildTools(server, context);
  registerProjectTools(server, context);
  registerSpringBootTools(server, context);
  registerCoverageTools(server, context);
}
