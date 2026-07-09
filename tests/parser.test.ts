import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCompilationOutput } from '../src/maven/parser.js';

function fixture(name: string): string {
  return readFileSync(`tests/fixtures/${name}`, 'utf-8');
}

describe('parseCompilationOutput', () => {
  it('parses JDK 8 errors correctly', () => {
    const result = parseCompilationOutput(fixture('jdk8-errors.txt'));
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].file).toContain('UserService.java');
    expect(result.errors[0].line).toBe(42);
    expect(result.errors[0].message).toContain('cannot find symbol');
  });

  it('parses JDK 11 errors with column number', () => {
    const result = parseCompilationOutput(fixture('jdk11-errors.txt'));
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].column).toBe(13);
  });

  it('parses JDK 17 multi-line errors', () => {
    const result = parseCompilationOutput(fixture('jdk17-errors.txt'));
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain('switch expression');
  });

  it('parses JDK 21 record pattern errors', () => {
    const result = parseCompilationOutput(fixture('jdk21-errors.txt'));
    expect(result.errors.length).toBe(2);
    expect(result.errors[0].file).toContain('RecordMatcher.java');
    expect(result.errors[1].file).toContain('UserService.java');
  });

  it('returns success:true on empty output', () => {
    const result = parseCompilationOutput('');
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
