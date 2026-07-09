import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { findPomUpwards, resolveProjectInfo } from '../src/project/discovery.js';

describe('findPomUpwards', () => {
  it('should find pom.xml starting from its directory', () => {
    const result = findPomUpwards('tests/fixtures');
    expect(result).toBeTruthy();
    expect(result).toContain('pom.xml');
  });

  it('should return null when no pom.xml exists', () => {
    const result = findPomUpwards('/nonexistent');
    expect(result).toBeNull();
  });
});

describe('resolveProjectInfo', () => {
  it('should parse a multi-module project correctly', () => {
    const fixtureDir = 'tests/fixtures';
    const info = resolveProjectInfo(fixtureDir);
    expect(info).not.toBeNull();
    expect(info!.isMultiModule).toBe(true);
    expect(info!.javaVersion).toBe('21');
  });
});
