import { type McpMavenConfig } from './types.js';

export function loadConfig(): McpMavenConfig {
  return {
    timeoutMs: parseInt(process.env.MCP_MAVEN_TIMEOUT_MS ?? '300000', 10),
    maxLogLines: parseInt(process.env.MCP_MAVEN_MAX_LOG_LINES ?? '500', 10),
    springBootRingBuffer: parseInt(process.env.MCP_MAVEN_SPRING_RING_BUFFER ?? '500', 10),
    springBootStartupTimeout: parseInt(process.env.MCP_MAVEN_SPRING_STARTUP_TIMEOUT ?? '120000', 10),
    cacheEnabled: (process.env.MCP_MAVEN_CACHE_ENABLED ?? 'true') === 'true',
    defaultProfile: process.env.MCP_MAVEN_DEFAULT_PROFILE ?? '',
  };
}
