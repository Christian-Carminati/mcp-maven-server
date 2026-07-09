import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../core/types.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { runMaven, buildGoalArgs } from '../maven/runner.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseAttributeValue: false,
  trimValues: true,
});

interface CoverageMetric {
  missed: number;
  covered: number;
  percentage: number;
}

interface PackageCoverage {
  name: string;
  lines: CoverageMetric;
  branches: CoverageMetric;
  methods: CoverageMetric;
}

interface CoverageReport {
  overall: {
    lines: CoverageMetric;
    branches: CoverageMetric;
    methods: CoverageMetric;
  };
  packages: PackageCoverage[];
  reportPath: string;
  generated: boolean;
  execFile?: string;
}

function calcPct(covered: number, missed: number): number {
  const total = covered + missed;
  if (total === 0) return 0;
  return Math.round((covered / total) * 1000) / 10;
}

export function readJacocoReport(moduleDir: string): CoverageReport {
  const reportPath = join(moduleDir, 'target', 'site', 'jacoco', 'jacoco.xml');
  const execPath = join(moduleDir, 'target', 'jacoco-ut.exec');
  const hasExec = existsSync(execPath);

  if (!existsSync(reportPath)) {
    return {
      overall: { lines: { missed: 0, covered: 0, percentage: 0 }, branches: { missed: 0, covered: 0, percentage: 0 }, methods: { missed: 0, covered: 0, percentage: 0 } },
      packages: [],
      reportPath,
      generated: false,
      execFile: hasExec ? execPath : undefined,
    };
  }

  const raw = readFileSync(reportPath, 'utf-8');
  const parsed = xmlParser.parse(raw);
  const report = parsed.report || {};

  const packagesRegistry: Record<string, PackageCoverage> = {};

  function ensurePkg(name: string): PackageCoverage {
    if (!packagesRegistry[name]) {
      packagesRegistry[name] = { name, lines: { missed: 0, covered: 0, percentage: 0 }, branches: { missed: 0, covered: 0, percentage: 0 }, methods: { missed: 0, covered: 0, percentage: 0 } };
    }
    return packagesRegistry[name];
  }

  const pkgNodes = report.package;
  if (pkgNodes) {
    const pkgList = Array.isArray(pkgNodes) ? pkgNodes : [pkgNodes];
    for (const pkg of pkgList) {
      const counters = pkg.counter;
      if (!counters) continue;

      const counterList = Array.isArray(counters) ? counters : [counters];
      const pkgData = ensurePkg((pkg.name ?? '').replace(/\//g, '.'));

      for (const c of counterList) {
        const missed = parseInt(c.missed ?? '0', 10);
        const covered = parseInt(c.covered ?? '0', 10);
        switch (c.type) {
          case 'LINE':
            pkgData.lines = { missed, covered, percentage: calcPct(covered, missed) };
            break;
          case 'BRANCH':
            pkgData.branches = { missed, covered, percentage: calcPct(covered, missed) };
            break;
          case 'METHOD':
            pkgData.methods = { missed, covered, percentage: calcPct(covered, missed) };
            break;
        }
      }
    }
  }

  const packages = Object.values(packagesRegistry);

  // Calculate totals
  const totals = { lines: { missed: 0, covered: 0 }, branches: { missed: 0, covered: 0 }, methods: { missed: 0, covered: 0 } };
  for (const p of packages) {
    totals.lines.missed += p.lines.missed;
    totals.lines.covered += p.lines.covered;
    totals.branches.missed += p.branches.missed;
    totals.branches.covered += p.branches.covered;
    totals.methods.missed += p.methods.missed;
    totals.methods.covered += p.methods.covered;
  }

  return {
    overall: {
      lines: { ...totals.lines, percentage: calcPct(totals.lines.covered, totals.lines.missed) },
      branches: { ...totals.branches, percentage: calcPct(totals.branches.covered, totals.branches.missed) },
      methods: { ...totals.methods, percentage: calcPct(totals.methods.covered, totals.methods.missed) },
    },
    packages: packages.sort((a, b) => b.name.localeCompare(a.name)),
    reportPath,
    generated: true,
    execFile: hasExec ? execPath : undefined,
  };
}

export function registerCoverageTools(server: McpServer, context: ToolContext): void {
  server.tool(
    'getCoverageReport',
    'Read the JaCoCo coverage report (jacoco.xml) and return structured coverage data by package',
    {
      projectPath: z.string().optional().describe('Path to the Maven project/module directory'),
      generate: z.boolean().optional().default(false).describe('If true, runs jacoco:report first to generate fresh coverage data'),
    },
    async ({ projectPath, generate }) => {
      const cwd = projectPath || process.cwd();

      if (generate) {
        const args = buildGoalArgs(['jacoco:report']);
        await runMaven(context.config, { args, cwd });
      }

      const report = readJacocoReport(cwd);

      if (!report.generated && !generate) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ...report,
            message: 'No JaCoCo report found. Run tests first or use generate: true to build coverage data.',
          }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(report) }],
      };
    },
  );
}
