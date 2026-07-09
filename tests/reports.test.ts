import { describe, it, expect } from 'vitest';
import { parseSurefireReport, aggregateResults } from '../src/maven/reports.js';

describe('parseSurefireReport', () => {
  it('parses a successful test report', () => {
    const result = parseSurefireReport('tests/fixtures/surefire-success.xml');
    expect(result).not.toBeNull();
    expect(result!.className).toContain('UserServiceTest');
    expect(result!.tests).toBe(3);
    expect(result!.failures).toBe(0);
    expect(result!.errors).toBe(0);
    expect(result!.testCases).toHaveLength(3);
    expect(result!.testCases[0].status).toBe('PASSED');
  });

  it('parses a mixed failures/errors/skipped report', () => {
    const result = parseSurefireReport('tests/fixtures/surefire-failures.xml');
    expect(result).not.toBeNull();
    expect(result!.tests).toBe(4);
    expect(result!.failures).toBe(1);
    expect(result!.errors).toBe(1);
    expect(result!.skipped).toBe(1);
    const failed = result!.testCases.filter(t => t.status === 'FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0].message).toContain('expected:<404>');
  });

  it('handles corrupted XML gracefully', () => {
    const result = parseSurefireReport('tests/fixtures/surefire-corrupted.xml');
    expect(result).toBeNull();
  });
});

describe('aggregateResults', () => {
  it('aggregates multiple class results into summary', () => {
    const results = aggregateResults([
      'tests/fixtures/surefire-success.xml',
      'tests/fixtures/surefire-failures.xml',
    ]);
    expect(results.summary.totalTests).toBe(7); // 3 + 4
    expect(results.summary.totalFailed).toBe(2); // 1 failure + 1 error
    expect(results.summary.totalPassed).toBe(4); // 3 + 1 (shouldReturnOk)
    expect(results.byClass).toHaveLength(2);
    expect(results.failedOnly).toHaveLength(1); // only failures/errors
  });

  it('returns empty summary when no reports found', () => {
    const results = aggregateResults([]);
    expect(results.summary.totalTests).toBe(0);
    expect(results.byClass).toHaveLength(0);
  });
});
