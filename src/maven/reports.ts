import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { type TestResults, type TestClassResult, type TestCase, type TestSummary } from '../core/types.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseAttributeValue: false,
  trimValues: true,
});

export function parseSurefireReport(filePath: string): TestClassResult | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = xmlParser.parse(raw);
    const suite = parsed.testsuite;
    if (!suite) return null;

    const testCaseNodes = suite.testcase;
    const testCases: TestCase[] = [];

    if (testCaseNodes) {
      const cases = Array.isArray(testCaseNodes) ? testCaseNodes : [testCaseNodes];
      for (const tc of cases) {
        let status: TestCase['status'] = 'PASSED';
        let message: string | undefined;
        let type: string | undefined;
        let stackTrace: string | undefined;

        if (tc.failure) {
          status = 'FAILED';
          message = typeof tc.failure === 'object' ? tc.failure.message || tc.failure['#text'] : tc.failure;
          type = typeof tc.failure === 'object' ? tc.failure.type : undefined;
          stackTrace = typeof tc.failure === 'object' ? tc.failure['#text'] : undefined;
        } else if (tc.error) {
          status = 'ERROR';
          message = typeof tc.error === 'object' ? tc.error.message || tc.error['#text'] : tc.error;
          type = typeof tc.error === 'object' ? tc.error.type : undefined;
          stackTrace = typeof tc.error === 'object' ? tc.error['#text'] : undefined;
        } else if (tc.skipped) {
          status = 'SKIPPED';
          message = typeof tc.skipped === 'object' ? tc.skipped.message : undefined;
        }

        testCases.push({
          name: tc.name ?? '',
          classname: tc.classname ?? '',
          timeSeconds: parseFloat(tc.time ?? '0'),
          status,
          message,
          type,
          stackTrace: stackTrace ? stackTrace.split('\n').slice(0, 10).join('\n') : undefined,
        });
      }
    }

    return {
      className: suite.name ?? '',
      packageName: suite.name?.substring(0, suite.name.lastIndexOf('.')) ?? '',
      tests: parseInt(suite.tests ?? '0', 10),
      failures: parseInt(suite.failures ?? '0', 10),
      errors: parseInt(suite.errors ?? '0', 10),
      skipped: parseInt(suite.skipped ?? '0', 10),
      timeSeconds: parseFloat(suite.time ?? '0'),
      testCases,
    };
  } catch {
    return null;
  }
}

export function readAllReports(reportsDir: string): TestClassResult[] {
  if (!existsSync(reportsDir)) return [];

  let files: string[];
  try {
    files = readdirSync(reportsDir).filter(f => f.endsWith('.xml') && f.startsWith('TEST-'));
  } catch {
    return [];
  }

  const results: TestClassResult[] = [];
  for (const file of files) {
    const result = parseSurefireReport(join(reportsDir, file));
    if (result) results.push(result);
  }

  return results;
}

export function aggregateResults(filePaths: string[]): TestResults {
  const byClass: TestClassResult[] = [];
  let corruptedCount = 0;

  for (const fp of filePaths) {
    const result = parseSurefireReport(fp);
    if (result) {
      byClass.push(result);
    } else {
      corruptedCount++;
    }
  }

  const summary: TestSummary = {
    totalTests: byClass.reduce((s, c) => s + c.tests, 0),
    totalPassed: byClass.reduce((s, c) => s + c.tests - c.failures - c.errors - c.skipped, 0),
    totalFailed: byClass.reduce((s, c) => s + c.failures + c.errors, 0),
    totalSkipped: byClass.reduce((s, c) => s + c.skipped, 0),
    totalClasses: byClass.length,
    timeSeconds: byClass.reduce((s, c) => s + c.timeSeconds, 0),
  };

  const failedOnly = byClass
    .filter(c => c.failures > 0 || c.errors > 0)
    .map(c => ({
      ...c,
      testCases: c.testCases.filter(tc => tc.status === 'FAILED' || tc.status === 'ERROR'),
    }));

  return { summary, byClass, failedOnly };
}
