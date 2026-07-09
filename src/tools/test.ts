import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext, TestResults } from '../core/types.js';
import { runMaven, buildGoalArgs } from '../maven/runner.js';
import { readAllReports, aggregateResults, parseSurefireReport } from '../maven/reports.js';
import { checkCache, updateCache, clearCache, getCacheStats } from '../maven/cache.js';
import { join } from 'node:path';

const projectPathOption = z.string().optional().describe('Path to the Maven project/module directory (defaults to current working directory)');

function findTestReports(moduleDir: string): { unitDir: string; itDir: string } {
  const target = join(moduleDir, 'target');
  return {
    unitDir: join(target, 'surefire-reports'),
    itDir: join(target, 'failsafe-reports'),
  };
}

function resolveBaseDir(projectPath?: string): string {
  return projectPath || process.cwd();
}

function collectAllTestResults(moduleDir: string): TestResults {
  const { unitDir, itDir } = findTestReports(moduleDir);
  const unitReports = readAllReports(unitDir);
  const itReports = readAllReports(itDir);
  return aggregateResults([
    ...unitReports.map(r => join(unitDir, `TEST-${r.className}.xml`)),
    ...itReports.map(r => join(itDir, `TEST-${r.className}.xml`)),
  ]);
}

const moduleOption = z.string().optional().describe('Maven module name (for multi-module projects)');
const profileOption = z.string().optional().describe('Maven profile to activate');
const classNameOption = z.string().describe('Full test class name (e.g. com.example.UserServiceTest)');
const methodNameOption = z.string().describe('Test method name');

export function registerTestTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'runTests',
    'Run all tests (mvn test) and return structured results. Uses cache by default: if no source/test files changed since last run, returns cached results instantly. Use force:true to bypass cache.',
    {
      module: moduleOption,
      profile: profileOption,
      projectPath: projectPathOption,
      force: z.boolean().optional().default(false).describe('Bypass cache and force re-run all tests'),
      parallel: z.boolean().optional().default(true).describe('Use parallel execution (-T 2 -DforkCount=2)'),
    },
    async ({ module, profile, projectPath, force, parallel }) => {
      const cwd = resolveBaseDir(projectPath);

      // Check cache first
      if (!force) {
        const cache = checkCache(cwd);
        if (cache.isFresh && cache.cachedResults) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              ...cache.cachedResults,
              _cached: true,
              _message: 'Cached result — no files changed. Use force:true to re-run all tests.',
            }) }],
          };
        }
        if (!cache.isFresh && cache.changedSourceFiles.length > 0 && cache.changedSourceFiles.length <= 3) {
          // Few changes: run only affected test classes
          // (phase 2 — for now, fall through to full run)
        }
      }

      // Build args with optional parallelism
      const goals = ['test'];
      const extraArgs: string[] = [];
      if (parallel) {
        extraArgs.push('-T', '2', '-DforkCount=2', '-Dparallel=classes');
      }

      const args = buildGoalArgs(goals, { module, profile: profile ? [profile] : undefined });
      await runMaven(context.config, { args: [...extraArgs, ...args], cwd });

      const results = collectAllTestResults(cwd);

      // Update cache
      updateCache(cwd, results);

      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  );

  server.tool(
    'runSingleTest',
    'Run a single test class and return structured results',
    { className: classNameOption, module: moduleOption, projectPath: projectPathOption },
    async ({ className, module, projectPath }) => {
      const cwd = resolveBaseDir(projectPath);
      const simpleName = className.includes('.') ? className.split('.').pop()! : className;
      const args = buildGoalArgs(['test'], { test: simpleName, module });
      await runMaven(context.config, { args, cwd });

      const { unitDir } = findTestReports(cwd);
      const reportPath = join(unitDir, `TEST-${className}.xml`);
      const result = parseSurefireReport(reportPath);

      if (!result) {
        const simplePath = join(unitDir, `TEST-${simpleName}.xml`);
        const fallback = parseSurefireReport(simplePath);
        if (!fallback) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              summary: { totalTests: 0, totalPassed: 0, totalFailed: 0, totalSkipped: 0, totalClasses: 0, timeSeconds: 0 },
              byClass: [],
              failedOnly: [],
            }) }],
          };
        }
        const results = aggregateResults([simplePath]);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      }

      const results = aggregateResults([reportPath]);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  );

  server.tool(
    'runSingleMethod',
    'Run a single test method and return structured results',
    { className: classNameOption, methodName: methodNameOption, module: moduleOption, projectPath: projectPathOption },
    async ({ className, methodName, module, projectPath }) => {
      const cwd = resolveBaseDir(projectPath);
      const simpleName = className.includes('.') ? className.split('.').pop()! : className;
      const args = buildGoalArgs(['test'], { test: simpleName, method: methodName, module });
      await runMaven(context.config, { args, cwd });

      const { unitDir } = findTestReports(cwd);
      const reportPath = join(unitDir, `TEST-${className}.xml`);
      const result = parseSurefireReport(reportPath);

      if (!result) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            summary: { totalTests: 0, totalPassed: 0, totalFailed: 0, totalSkipped: 0, totalClasses: 0, timeSeconds: 0 },
            byClass: [],
            failedOnly: [],
          }) }],
        };
      }

      const results = aggregateResults([reportPath]);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  );

  server.tool(
    'getFailedTests',
    'Read test reports and return only failed/errored tests without re-running',
    { module: moduleOption, projectPath: projectPathOption },
    async ({ module, projectPath }) => {
      const cwd = resolveBaseDir(projectPath);
      const moduleDir = module && context.projectInfo
        ? join(context.projectInfo.projectRoot, module)
        : cwd;

      const results = collectAllTestResults(moduleDir);
      return { content: [{ type: 'text', text: JSON.stringify(results.failedOnly) }] };
    },
  );

  server.tool(
    'getTestReports',
    'Read test reports from disk without running tests again',
    { module: moduleOption, projectPath: projectPathOption },
    async ({ module, projectPath }) => {
      const cwd = resolveBaseDir(projectPath);
      const moduleDir = module && context.projectInfo
        ? join(context.projectInfo.projectRoot, module)
        : cwd;

      const results = collectAllTestResults(moduleDir);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  );

  // Cache management tools
  server.tool(
    'getCacheInfo',
    'Show build cache status — which modules are cached and how old',
    {},
    async () => {
      const stats = getCacheStats();
      return { content: [{ type: 'text', text: JSON.stringify(stats) }] };
    },
  );

  server.tool(
    'clearCache',
    'Clear the build cache for a specific module or all modules',
    { projectPath: projectPathOption },
    async ({ projectPath }) => {
      if (projectPath) {
        clearCache(projectPath);
      } else {
        clearCache();
      }
      return { content: [{ type: 'text', text: JSON.stringify({ cleared: true, projectPath: projectPath || 'all' }) }] };
    },
  );
}
