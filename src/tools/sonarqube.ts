import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';
import { runMaven, buildGoalArgs } from '../maven/runner.js';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// ============================================================
// SonarQube REST API client (uses Node 18+ global fetch)
// ============================================================

function sonarAuthHeader(token: string): Record<string, string> {
  const encoded = Buffer.from(`${token}:`).toString('base64');
  return { 'Authorization': `Basic ${encoded}` };
}

async function sonarApiGet(
  hostUrl: string,
  token: string,
  path: string,
): Promise<any> {
  const url = `${hostUrl}/api${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { ...sonarAuthHeader(token) },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`SonarQube API error: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function waitForAnalysis(hostUrl: string, token: string, projectKey: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    let data: any;
    try {
      data = await sonarApiGet(hostUrl, token, `/ce/activity?component=${encodeURIComponent(projectKey)}&limit=1`);
    } catch (e: any) {
      // If CE endpoint is forbidden (403), skip waiting — results may be ready already
      if (e.message.includes('403') || e.message.includes('Forbidden') || e.message.includes('Insufficient privileges')) {
        return;
      }
      throw e;
    }

    const tasks: any[] = data.tasks ?? [];

    if (tasks.length === 0) return; // nothing to wait for

    const status = tasks[0].status;
    if (status === 'SUCCESS' || status === 'CANCELED' || status === 'FAILED') {
      return;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error(`SonarQube analysis did not complete within ${timeoutMs / 1000}s`);
}

// ============================================================
// Measures & Quality Gate
// ============================================================

interface SonarMeasures {
  bugs: number;
  vulnerabilities: number;
  codeSmells: number;
  coverage: number | null;
  duplications: number | null;
  sqaleIndex: string | null;
  linesOfCode: number | null;
  bugsRating: number;
  vulnerabilitiesRating: number;
  sqaleRating: number;
  securityHotspots: number;
}

async function fetchMeasures(hostUrl: string, token: string, projectKey: string): Promise<SonarMeasures> {
  const metricKeys = [
    'bugs', 'vulnerabilities', 'code_smells',
    'coverage', 'duplicated_lines_density',
    'sqale_index', 'ncloc',
    'reliability_rating', 'security_rating', 'sqale_rating',
    'security_hotspots',
  ].join(',');

  const data = await sonarApiGet(hostUrl, token,
    `/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${metricKeys}`);

  const measures: Record<string, string> = {};
  for (const m of (data.component?.measures ?? [])) {
    measures[m.metric] = m.value;
  }

  return {
    bugs: parseInt(measures.bugs ?? '0', 10),
    vulnerabilities: parseInt(measures.vulnerabilities ?? '0', 10),
    codeSmells: parseInt(measures.code_smells ?? '0', 10),
    coverage: measures.coverage ? parseFloat(measures.coverage) : null,
    duplications: measures.duplicated_lines_density ? parseFloat(measures.duplicated_lines_density) : null,
    sqaleIndex: measures.sqale_index ?? null,
    linesOfCode: measures.ncloc ? parseInt(measures.ncloc, 10) : null,
    bugsRating: parseInt(measures.reliability_rating ?? '1', 10),
    vulnerabilitiesRating: parseInt(measures.security_rating ?? '1', 10),
    sqaleRating: parseInt(measures.sqale_rating ?? '1', 10),
    securityHotspots: parseInt(measures.security_hotspots ?? '0', 10),
  };
}

interface QualityGateResult {
  status: 'OK' | 'WARN' | 'ERROR';
  conditions: Array<{
    metric: string;
    operator: string;
    value: string;
    status: 'OK' | 'WARN' | 'ERROR';
    errorThreshold?: string;
  }>;
}

async function fetchQualityGate(hostUrl: string, token: string, projectKey: string): Promise<QualityGateResult> {
  const data = await sonarApiGet(hostUrl, token,
    `/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`);

  const qs = data.projectStatus ?? {};
  return {
    status: qs.status ?? 'OK',
    conditions: (qs.conditions ?? []).map((c: any) => ({
      metric: c.metricKey,
      operator: c.comparator,
      value: c.actualValue,
      status: c.status,
      errorThreshold: c.errorThreshold,
    })),
  };
}

// ============================================================
// Issues & Security Hotspots
// ============================================================

interface SonarIssue {
  key: string;
  severity: string;       // BLOCKER, CRITICAL, MAJOR, MINOR, INFO
  type: string;           // BUG, VULNERABILITY, CODE_SMELL
  rule: string;
  message: string;
  file: string | null;
  line: number | null;
  status: string;
  resolution: string | null;
  effort: string | null;
  createdAt: string;
}

interface SonarHotspot {
  key: string;
  rule: string;
  message: string;
  file: string | null;
  line: number | null;
  status: string;   // TO_REVIEW, ACKNOWLEDGED, FIXED, SAFE
  vulnerabilityCategory: string;
  probability: string;
  riskDescription: string | null;
  createdAt: string;
}

async function fetchIssues(hostUrl: string, token: string, projectKey: string, sinceAnalysis?: string): Promise<{
  issues: SonarIssue[];
  total: number;
}> {
  const params = new URLSearchParams({ componentKeys: projectKey, ps: '100', s: 'FILE_LINE' });
  if (sinceAnalysis) params.set('createdAfter', sinceAnalysis);

  const data = await sonarApiGet(hostUrl, token, `/issues/search?${params.toString()}`);

  return {
    total: data.total ?? 0,
    issues: (data.issues ?? []).map((i: any) => ({
      key: i.key,
      severity: i.severity,
      type: i.type,
      rule: i.rule,
      message: i.message,
      file: i.component?.split(':').pop()?.replace(/^src\/main\/java\//, '') ?? null,
      line: i.line ?? null,
      status: i.status,
      resolution: i.resolution ?? null,
      effort: i.effort ?? null,
      createdAt: i.creationDate,
    })),
  };
}

async function fetchHotspots(hostUrl: string, token: string, projectKey: string): Promise<{
  hotspots: SonarHotspot[];
  total: number;
}> {
  const params = new URLSearchParams({ projectKey, ps: '100' });

  const data = await sonarApiGet(hostUrl, token, `/hotspots/search?${params.toString()}`);

  return {
    total: data.total ?? 0,
    hotspots: (data.hotspots ?? []).map((h: any) => ({
      key: h.key,
      rule: h.rule,
      message: h.message,
      file: h.component?.split(':').pop()?.replace(/^src\/main\/java\//, '') ?? null,
      line: h.line ?? null,
      status: h.status,
      vulnerabilityCategory: h.vulnerabilityProbability,
      probability: h.vulnerabilityProbability,
      riskDescription: null,
      createdAt: h.creationDate,
    })),
  };
}

// ============================================================
// Auth check
// ============================================================

async function checkSonarAuth(hostUrl: string, token: string): Promise<boolean> {
  try {
    await sonarApiGet(hostUrl, token, '/authentication/validate');
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Online freshness check — compare local files vs SonarQube analysis date
// ============================================================

/**
 * Get the latest analysis date from SonarQube API.
 * Returns null if no analysis exists yet.
 */
async function fetchLastAnalysisDate(hostUrl: string, token: string, projectKey: string): Promise<string | null> {
  try {
    const data = await sonarApiGet(hostUrl, token, `/project_analyses/search?project=${encodeURIComponent(projectKey)}&ps=1`);
    const analyses: any[] = data.analyses ?? [];
    return analyses.length > 0 ? analyses[0].date : null;
  } catch {
    return null; // if we can't get the date, fall back to running analysis
  }
}

/**
 * Get the most recent modification time (ms) across all source + test files.
 * Returns 0 if no files found.
 */
function getLatestFileMtime(moduleDir: string): number {
  let latest = 0;
  const dirs = [
    join(moduleDir, 'src', 'main', 'java'),
    join(moduleDir, 'src', 'main', 'resources'),
    join(moduleDir, 'src', 'test', 'java'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const walk = (d: string) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const full = join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.java') || entry.name.endsWith('.yml') || entry.name.endsWith('.yaml') || entry.name.endsWith('.xml') || entry.name.endsWith('.properties')) {
            const mtime = statSync(full).mtimeMs;
            if (mtime > latest) latest = mtime;
          }
        }
      };
      walk(dir);
    } catch { /* skip */ }
  }
  return latest;
}

// ============================================================
// Tool registration
// ============================================================

export function registerSonarQubeTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'runSonarQubeAnalysis',
    'Run SonarQube analysis and return structured results: quality gate, measures (bugs, vulnerabilities, code smells, coverage), new issues, and security hotspots. Skips Maven if no local files changed since last SonarQube analysis — fetches results directly from the API. Use fresh:true to force a full re-analysis.',
    {
      projectPath: z.string().optional().describe('Path to the Maven project/module directory'),
      module: z.string().optional().describe('Maven module name'),
      profile: z.string().optional().describe('Maven profile to activate'),
      projectKey: z.string().optional().describe('SonarQube project key (e.g. "be-bancomatpay-develop"). Falls back to MCP_SONAR_PROJECT_KEY env var.'),
      qualityGateWait: z.boolean().optional().default(true).describe('Wait for SonarQube Compute Engine to complete and fetch fresh quality gate.'),
      runTests: z.boolean().optional().default(true).describe('Run all tests (verify phase, includes integration tests) with JaCoCo first to generate coverage data before analysis.'),
      fresh: z.boolean().optional().default(false).describe('Bypass cache and force re-run analysis even if no files changed.'),
      detail: z.enum(['compact', 'normal', 'full']).optional().default('normal').describe('Result detail level: compact (summary only), normal (summary + quality gate + top issues), full (everything including all issues/hotspots).'),
    },
    async ({ projectPath, module, profile, projectKey, qualityGateWait, runTests, fresh, detail }) => {
      const cwd = projectPath || process.cwd();
      const hostUrl = context.config.sonarHostUrl;
      const token = context.config.sonarToken;
      const key = projectKey || context.config.sonarProjectKey;

      if (!token) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: 'SonarQube token not configured. Set MCP_SONAR_TOKEN in the MCP server env config.',
          }) }],
        };
      }

      if (!key) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: 'SonarQube project key not configured. Pass projectKey parameter or set MCP_SONAR_PROJECT_KEY in env.',
          }) }],
        };
      }

      // Verify auth
      const authOk = await checkSonarAuth(hostUrl, token);
      if (!authOk) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: 'SonarQube authentication failed. Check MCP_SONAR_TOKEN.',
          }) }],
        };
      }

      // Check if SonarQube already has a recent analysis (skip Maven if nothing changed)
      let skipMaven = false;
      if (!fresh && runTests) {
        const lastAnalysisDate = await fetchLastAnalysisDate(hostUrl, token, key);
        if (lastAnalysisDate) {
          const analysisTime = new Date(lastAnalysisDate).getTime();
          const latestLocalMtime = getLatestFileMtime(cwd);
          if (latestLocalMtime > 0 && analysisTime > latestLocalMtime) {
            skipMaven = true;
          }
        }
      }

      let waitWarning: string | undefined;

      if (!skipMaven) {
        // Build Maven goals: tests (unit + integration) + coverage + SonarQube analysis
        const goals = runTests
          ? ['verify', 'jacoco:report', 'sonar:sonar']
          : ['sonar:sonar'];

        const sonarArgs = [
          `-Dsonar.host.url=${hostUrl}`,
          `-Dsonar.token=${token}`,
          `-Dsonar.projectKey=${key}`,
          `-Dsonar.coverage.jacoco.xmlReportPaths=target/site/jacoco/jacoco.xml`,
        ];
        const args = buildGoalArgs(goals, { module, profile: profile ? [profile] : undefined });
        const allArgs = [...args, ...sonarArgs];

        const result = await runMaven(context.config, { args: allArgs, cwd });

        if (!result.success && result.exitCode !== 0) {
          const hasError = result.stdout.toLowerCase().includes('error') || result.stderr.toLowerCase().includes('error');
          if (hasError && result.stdout.includes('[ERROR]')) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: false,
                error: 'SonarQube analysis execution failed',
                exitCode: result.exitCode,
                lastLogLines: result.stdout.slice(-500),
              }) }],
            };
          }
        }

        // Wait for analysis completion
        if (qualityGateWait) {
          try {
            await waitForAnalysis(hostUrl, token, key);
          } catch (e: any) {
            waitWarning = e.message;
          }
        }
      }

      // Fetch results from SonarQube API (fresh from online)
      let qualityGate: QualityGateResult;
      let measures: SonarMeasures;
      let issues: { total: number; issues: SonarIssue[] };
      let hotspots: { total: number; hotspots: SonarHotspot[] };
      try {
        qualityGate = await fetchQualityGate(hostUrl, token, key);
        measures = await fetchMeasures(hostUrl, token, key);
        issues = await fetchIssues(hostUrl, token, key);
        hotspots = await fetchHotspots(hostUrl, token, key);
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: `Failed to fetch SonarQube results: ${e.message}`,
            waitWarning,
          }) }],
        };
      }

      // Build response
      const response: Record<string, any> = {
        success: true,
        projectKey: key,
        hostUrl,
        qualityGate: {
          status: qualityGate.status,
          conditionsCount: qualityGate.conditions.length,
          conditions: qualityGate.conditions,
        },
        measures,
      };
      if (skipMaven) {
        response._fromApi = true;
        response._message = 'Results fetched from SonarQube API — local files unchanged since last analysis. Use fresh:true to force re-analysis.';
      }
      if (waitWarning) {
        response.warning = waitWarning;
      }

      if (detail === 'compact') {
        // Summary only
        response.newIssues = { total: issues.total };
        response.securityHotspots = { total: hotspots.total };
      } else if (detail === 'normal') {
        // Quality gate + top issues
        response.newIssues = {
          total: issues.total,
          bySeverity: groupBy(issues.issues, 'severity'),
          byType: groupBy(issues.issues, 'type'),
          top: issues.issues.slice(0, 20),
        };
        response.securityHotspots = {
          total: hotspots.total,
          byCategory: groupBy(hotspots.hotspots, 'vulnerabilityCategory'),
          top: hotspots.hotspots.slice(0, 10),
        };
      } else {
        // Full
        response.newIssues = {
          total: issues.total,
          bySeverity: groupBy(issues.issues, 'severity'),
          byType: groupBy(issues.issues, 'type'),
          all: issues.issues,
        };
        response.securityHotspots = {
          total: hotspots.total,
          byCategory: groupBy(hotspots.hotspots, 'vulnerabilityCategory'),
          all: hotspots.hotspots,
        };
      }

      // Rating interpretation helper
      response.ratings = {
        bugs: interpretRating(measures.bugsRating, 'reliability'),
        vulnerabilities: interpretRating(measures.vulnerabilitiesRating, 'security'),
        maintainability: interpretRating(measures.sqaleRating, 'maintainability'),
      };

      return { content: [{ type: 'text', text: JSON.stringify(response) }] };
    },
  );
}

// ============================================================
// Helpers
// ============================================================

function groupBy<T extends Record<string, any>>(items: T[], key: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const k = String(item[key] ?? 'UNKNOWN');
    result[k] = (result[k] ?? 0) + 1;
  }
  return result;
}

function interpretRating(rating: number, type: string): string {
  const labels: Record<string, string[]> = {
    reliability: ['A - No bugs', 'B - At least 1 minor bug', 'C - At least 1 major bug', 'D - At least 1 critical bug', 'E - At least 1 blocker bug'],
    security: ['A - No vulnerabilities', 'B - At least 1 minor vulnerability', 'C - At least 1 major vulnerability', 'D - At least 1 critical vulnerability', 'E - At least 1 blocker vulnerability'],
    maintainability: ['A - Highly maintainable', 'B - Moderately maintainable', 'C - Slightly difficult to maintain', 'D - Difficult to maintain', 'E - Very difficult to maintain'],
  };
  const idx = Math.min(Math.max(Math.round(rating), 1), 5) - 1;
  return (labels[type] ?? labels.reliability)[idx] ?? `Rating ${rating}`;
}
