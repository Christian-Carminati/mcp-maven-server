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

interface ClassCoverage {
  name: string;
  sourceFile: string;
  lines: CoverageMetric;
  branches: CoverageMetric;
  methods: CoverageMetric;
}

interface DetailedPackage {
  name: string;
  lines: CoverageMetric;
  branches: CoverageMetric;
  methods: CoverageMetric;
  classes: ClassCoverage[];
}

interface CoverageReport {
  overall: {
    lines: CoverageMetric;
    branches: CoverageMetric;
    methods: CoverageMetric;
  };
  packages: DetailedPackage[];
  reportPath: string;
  generated: boolean;
  execFile?: string;
}

function calcPct(covered: number, missed: number): number {
  const total = covered + missed;
  if (total === 0) return 0;
  return Math.round((covered / total) * 1000) / 10;
}

function extractCounters(counterNodes: any | any[] | undefined): Record<string, { missed: number; covered: number }> {
  const result: Record<string, { missed: number; covered: number }> = {};
  if (!counterNodes) return result;

  const list = Array.isArray(counterNodes) ? counterNodes : [counterNodes];
  for (const c of list) {
    const type = c.type as string;
    if (type === 'LINE' || type === 'BRANCH' || type === 'METHOD') {
      result[type] = {
        missed: parseInt(c.missed ?? '0', 10),
        covered: parseInt(c.covered ?? '0', 10),
      };
    }
  }
  return result;
}

function metricFrom(counters: Record<string, { missed: number; covered: number }>, type: string): CoverageMetric {
  const d = counters[type];
  if (!d) return { missed: 0, covered: 0, percentage: 0 };
  return { ...d, percentage: calcPct(d.covered, d.missed) };
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

  const packages: DetailedPackage[] = [];
  const totals = { lines: { missed: 0, covered: 0 }, branches: { missed: 0, covered: 0 }, methods: { missed: 0, covered: 0 } };

  const pkgNodes = report.package;
  if (pkgNodes) {
    const pkgList = Array.isArray(pkgNodes) ? pkgNodes : [pkgNodes];
    for (const pkg of pkgList) {
      const pkgName = (pkg.name ?? '').replace(/\//g, '.');

      // Per-class counters
      const classes: ClassCoverage[] = [];
      const classNodes = pkg.class;
      if (classNodes) {
        const classList = Array.isArray(classNodes) ? classNodes : [classNodes];
        for (const cls of classList) {
          const count = extractCounters(cls.counter);
          const srcFile = cls.sourcefilename ?? `${cls.name?.split('.').pop() ?? 'Unknown'}.java`;
          classes.push({
            name: cls.name ?? '',
            sourceFile: srcFile,
            lines: metricFrom(count, 'LINE'),
            branches: metricFrom(count, 'BRANCH'),
            methods: metricFrom(count, 'METHOD'),
          });
        }
      }

      // Package-aggregated counters
      const pkgCounters = extractCounters(pkg.counter);
      const pkgData: DetailedPackage = {
        name: pkgName,
        lines: metricFrom(pkgCounters, 'LINE'),
        branches: metricFrom(pkgCounters, 'BRANCH'),
        methods: metricFrom(pkgCounters, 'METHOD'),
        classes,
      };

      totals.lines.missed += pkgData.lines.missed;
      totals.lines.covered += pkgData.lines.covered;
      totals.branches.missed += pkgData.branches.missed;
      totals.branches.covered += pkgData.branches.covered;
      totals.methods.missed += pkgData.methods.missed;
      totals.methods.covered += pkgData.methods.covered;

      packages.push(pkgData);
    }
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
    'Read JaCoCo coverage report and return structured coverage data by package. Includes per-class detail so you can identify exactly which files need more tests.',
    {
      projectPath: z.string().optional().describe('Path to the Maven project/module directory'),
      generate: z.boolean().optional().default(false).describe('If true, runs jacoco:report first to generate fresh coverage data'),
      detail: z.enum(['package', 'class']).optional().default('package').describe('Set to "class" to include per-file breakdown within each package'),
      minCoverage: z.number().optional().describe('Filter: only show packages/classes with line coverage below this threshold (e.g. 80 for <80%)'),
    },
    async ({ projectPath, generate, detail, minCoverage }) => {
      const cwd = projectPath || process.cwd();

      if (generate) {
        const args = buildGoalArgs(['jacoco:report']);
        await runMaven(context.config, { args, cwd });
      }

      const report = readJacocoReport(cwd);

      if (!report.generated) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            ...report,
            message: 'No JaCoCo report found. Run tests first or use generate: true to build coverage data.',
          }) }],
        };
      }

      // Apply filters
      let filteredPackages = report.packages;
      if (minCoverage !== undefined) {
        filteredPackages = filteredPackages
          .map(pkg => ({
            ...pkg,
            classes: pkg.classes.filter(cls => cls.lines.percentage < minCoverage && cls.lines.covered + cls.lines.missed > 0),
          }))
          .filter(pkg => pkg.lines.percentage < minCoverage || pkg.classes.length > 0);
      }

      // Strip class detail if not requested
      if (detail === 'package') {
        filteredPackages = filteredPackages.map(pkg => ({ ...pkg, classes: [] }));
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ ...report, packages: filteredPackages }) }],
      };
    },
  );
}
