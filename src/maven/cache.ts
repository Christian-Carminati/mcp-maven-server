import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type TestResults } from '../core/types.js';

interface BuildCacheEntry {
  timestamp: number;          // When the cache was created
  sourceTimestamps: Record<string, number>;  // File → lastModified per source file
  testResults: TestResults;
  moduleDir: string;
}

const cacheStore = new Map<string, BuildCacheEntry>();

function scanSourceFiles(moduleDir: string): Record<string, number> {
  const result: Record<string, number> = {};
  const srcDir = join(moduleDir, 'src', 'main', 'java');

  if (!existsSync(srcDir)) return result;

  function scan(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.name.endsWith('.java')) {
          const relPath = relative(moduleDir, fullPath);
          result[relPath] = statSync(fullPath).mtimeMs;
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  scan(srcDir);
  return result;
}

function scanTestFiles(moduleDir: string): Record<string, number> {
  const result: Record<string, number> = {};
  const testDir = join(moduleDir, 'src', 'test', 'java');

  if (!existsSync(testDir)) return result;

  function scan(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.name.endsWith('.java')) {
          const relPath = relative(moduleDir, fullPath);
          result[relPath] = statSync(fullPath).mtimeMs;
        }
      }
    } catch { /* skip */ }
  }

  scan(testDir);
  return result;
}

export interface CacheCheckResult {
  isFresh: boolean;
  cachedResults: TestResults | null;
  changedSourceFiles: string[];   // Files that changed since last cache
}

/**
 * Check if the build cache is fresh for a given module directory.
 * Returns the cached results if nothing changed, or a list of changed files.
 */
export function checkCache(moduleDir: string): CacheCheckResult {
  const entry = cacheStore.get(moduleDir);
  if (!entry) {
    return { isFresh: false, cachedResults: null, changedSourceFiles: [] };
  }

  const currentTimestamps = scanSourceFiles(moduleDir);
  const testTimestamps = scanTestFiles(moduleDir);
  const changedFiles: string[] = [];

  // Check if any source file changed
  for (const [file, mtime] of Object.entries(currentTimestamps)) {
    const cachedMtime = entry.sourceTimestamps[file];
    if (cachedMtime === undefined || mtime > cachedMtime) {
      changedFiles.push(file);
    }
  }

  // Check if any test file changed
  for (const [file, mtime] of Object.entries(testTimestamps)) {
    const cachedMtime = entry.sourceTimestamps[file];
    if (cachedMtime === undefined || mtime > cachedMtime) {
      changedFiles.push(file);
    }
  }

  if (changedFiles.length === 0) {
    return { isFresh: true, cachedResults: entry.testResults, changedSourceFiles: [] };
  }

  return { isFresh: false, cachedResults: null, changedSourceFiles: changedFiles };
}

/**
 * Update the build cache with new test results.
 */
export function updateCache(moduleDir: string, testResults: TestResults): void {
  cacheStore.set(moduleDir, {
    timestamp: Date.now(),
    sourceTimestamps: {
      ...scanSourceFiles(moduleDir),
      ...scanTestFiles(moduleDir),
    },
    testResults,
    moduleDir,
  });
}

/**
 * Clear the cache for a specific module (or all modules).
 */
export function clearCache(moduleDir?: string): void {
  if (moduleDir) {
    cacheStore.delete(moduleDir);
  } else {
    cacheStore.clear();
  }
}

/**
 * Get cache stats (for diagnostics).
 */
export function getCacheStats(): { modules: number; entries: Array<{ moduleDir: string; age: number }> } {
  const entries = Array.from(cacheStore.entries()).map(([dir, entry]) => ({
    moduleDir: dir,
    age: Date.now() - entry.timestamp,
  }));
  return { modules: entries.length, entries };
}
