import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext, TestResults } from '../core/types.js';
import { runMaven, buildGoalArgs } from '../maven/runner.js';
import { readAllReports, aggregateResults, parseSurefireReport } from '../maven/reports.js';
import { join } from 'node:path';

function findTestReports(moduleDir: string): { unitDir: string; itDir: string } {
  const target = join(moduleDir, 'target');
  return {
    unitDir: join(target, 'surefire-reports'),
    itDir: join(target, 'failsafe-reports'),
  };
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
    'Run all tests (mvn test) and return structured results',
    { module: moduleOption, profile: profileOption },
    async ({ module, profile }) => {
      const args = buildGoalArgs(['test'], { module, profile: profile ? [profile] : undefined });
      await runMaven(context.config, { args });

      const baseDir = context.projectInfo?.moduleDir ?? process.cwd();
      const results = collectAllTestResults(baseDir);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  );

  server.tool(
    'runSingleTest',
    'Run a single test class and return structured results',
    { className: classNameOption, module: moduleOption },
    async ({ className, module }) => {
      const simpleName = className.includes('.') ? className.split('.').pop()! : className;
      const args = buildGoalArgs(['test'], { test: simpleName, module });
      await runMaven(context.config, { args });

      const baseDir = context.projectInfo?.moduleDir ?? process.cwd();
      const { unitDir } = findTestReports(baseDir);
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
    { className: classNameOption, methodName: methodNameOption, module: moduleOption },
    async ({ className, methodName, module }) => {
      const simpleName = className.includes('.') ? className.split('.').pop()! : className;
      const args = buildGoalArgs(['test'], { test: simpleName, method: methodName, module });
      await runMaven(context.config, { args });

      const baseDir = context.projectInfo?.moduleDir ?? process.cwd();
      const { unitDir } = findTestReports(baseDir);
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
    { module: moduleOption },
    async ({ module }) => {
      const baseDir = context.projectInfo?.moduleDir ?? process.cwd();
      const moduleDir = module && context.projectInfo
        ? join(context.projectInfo.projectRoot, module)
        : baseDir;

      const results = collectAllTestResults(moduleDir);
      return { content: [{ type: 'text', text: JSON.stringify(results.failedOnly) }] };
    },
  );

  server.tool(
    'getTestReports',
    'Read test reports from disk without running tests again',
    { module: moduleOption },
    async ({ module }) => {
      const baseDir = context.projectInfo?.moduleDir ?? process.cwd();
      const moduleDir = module && context.projectInfo
        ? join(context.projectInfo.projectRoot, module)
        : baseDir;

      const results = collectAllTestResults(moduleDir);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    },
  );
}
