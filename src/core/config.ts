import { type McpMavenConfig } from './types.js';

export function loadConfig(): McpMavenConfig {
  return {
    timeoutMs: parseInt(process.env.MCP_MAVEN_TIMEOUT_MS ?? '300000', 10),
    maxLogLines: parseInt(process.env.MCP_MAVEN_MAX_LOG_LINES ?? '500', 10),
    springBootRingBuffer: parseInt(process.env.MCP_MAVEN_SPRING_RING_BUFFER ?? '500', 10),
    springBootStartupTimeout: parseInt(process.env.MCP_MAVEN_SPRING_STARTUP_TIMEOUT ?? '120000', 10),
    cacheEnabled: (process.env.MCP_MAVEN_CACHE_ENABLED ?? 'true') === 'true',
    defaultProfile: process.env.MCP_MAVEN_DEFAULT_PROFILE ?? '',
    sonarHostUrl: process.env.MCP_SONAR_HOST_URL ?? 'http://172.16.63.242:9000',
    sonarToken: process.env.MCP_SONAR_TOKEN ?? '',
    sonarProjectKey: process.env.MCP_SONAR_PROJECT_KEY ?? '',
  };
}
