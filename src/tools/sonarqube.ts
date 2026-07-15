import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';

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
    throw new Error(`SonarQube API error: ${response.status} ${response.statusText} - ${body.slice(0, 200)}`);
  }

  return response.json();
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
// Tool registration
// ============================================================

export function registerSonarQubeTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'runSonarQubeAnalysis',
    'Fetch SonarQube analysis results from the server API: quality gate, measures (bugs, vulnerabilities, code smells, coverage), issues, and security hotspots. Read-only - does NOT run Maven or trigger a new analysis. Results reflect the latest analysis already on the server.',
    {
      projectPath: z.string().optional().describe('Path to the Maven project/module directory'),
      projectKey: z.string().optional().describe('SonarQube project key (e.g. "be-bancomatpay-develop"). Falls back to MCP_SONAR_PROJECT_KEY env var.'),
      detail: z.enum(['compact', 'normal', 'full']).optional().default('normal').describe('Result detail level: compact (summary only), normal (summary + quality gate + top issues), full (everything including all issues/hotspots).'),
    },
    async ({ projectPath, projectKey, detail }) => {
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

      // Fetch results directly from SonarQube API (read-only, no Maven involved)
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
        _readOnly: true,
        _message: 'Read-only fetch from SonarQube API. No Maven analysis was run.',
      };

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
