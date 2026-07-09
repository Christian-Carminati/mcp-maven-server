import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { type ModuleInfo, type ProjectInfo } from '../core/types.js';
import { resolveJavaVersion } from './java-env.js';
import { parsePom } from './pom-parser.js';

const MAX_PARENT_LEVELS = 5;

export function findPomUpwards(startDir: string): string | null {
  let current = resolve(startDir);
  for (let i = 0; i < MAX_PARENT_LEVELS; i++) {
    const candidate = join(current, 'pom.xml');
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function resolveProjectInfo(cwd: string): ProjectInfo | null {
  const pomPath = findPomUpwards(cwd);
  if (!pomPath) return null;

  const moduleDir = dirname(pomPath);
  const rootPom = parsePom(pomPath);

  // Resolve root (follow <parent> if exists)
  let projectRoot = moduleDir;
  let isMultiModule = (rootPom.packaging === 'pom' || (rootPom.modules && rootPom.modules.length > 0));

  if (rootPom.parent) {
    const parentDir = rootPom.parent.relativePath
      ? resolve(moduleDir, rootPom.parent.relativePath)
      : resolve(moduleDir, '..');
    const parentPomPath = join(parentDir, 'pom.xml');
    if (existsSync(parentPomPath)) {
      projectRoot = parentDir;
      const parentPom = parsePom(parentPomPath);
      isMultiModule = parentPom.modules.length > 0;
    }
  }

  // Enumerate modules
  const modules: ModuleInfo[] = [];
  const rootPomPath = join(projectRoot, 'pom.xml');
  const actualRootPom = parsePom(rootPomPath);
  if (actualRootPom.modules.length > 0) {
    for (const modName of actualRootPom.modules) {
      const modDir = resolve(projectRoot, modName);
      const modPomPath = join(modDir, 'pom.xml');
      if (existsSync(modPomPath)) {
        modules.push({ name: modName, path: modDir, pomPath: modPomPath });
      }
    }
  }

  const javaVersion = resolveJavaVersion(rootPom);

  return {
    projectRoot,
    moduleDir,
    moduleName: rootPom.artifactId,
    isMultiModule,
    modules,
    javaVersion,
    mavenCommand: 'mvn',
    mavenVersion: '',
    hasWrapper: existsSync(join(moduleDir, 'mvnw')) || existsSync(join(moduleDir, 'mvnw.cmd')),
  };
}
