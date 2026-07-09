import { execSync } from 'node:child_process';
import { type JavaInfo } from '../core/types.js';
import { type ParsedPom } from './pom-parser.js';

export function resolveJavaVersion(pom: ParsedPom): string {
  return pom.properties['java.version']
    || pom.properties['maven.compiler.source']
    || pom.properties['maven.compiler.target']
    || '11';
}

export function detectJavaInfo(pom: ParsedPom): JavaInfo {
  // Priority 1: JAVA_HOME env
  const javaHome = process.env.JAVA_HOME || process.env.JDK_HOME;
  if (javaHome) {
    try {
      const out = execSync(`"${javaHome}\\bin\\java" -version 2>&1`, { encoding: 'utf-8' });
      const match = out.match(/openjdk version|java version "([^"]+)"/);
      if (match) {
        return {
          version: match[1] || extractVersion(out),
          home: javaHome,
          vendor: out.includes('Adoptium') ? 'Eclipse Adoptium' : out.includes('Oracle') ? 'Oracle' : 'Unknown',
          source: 'env',
        };
      }
    } catch { /* fall through */ }
  }

  // Priority 2: mvn --version
  try {
    const mvnOut = execSync('mvn --version 2>&1', { encoding: 'utf-8' });
    const jvmLine = mvnOut.split('\n').find(l => l.includes('Java version:') || l.includes('java version:'));
    if (jvmLine) {
      const versionMatch = jvmLine.match(/(\d+\.\d+(?:\.\d+)?)/);
      const homeMatch = mvnOut.match(/Java home: (.+)/);
      return {
        version: versionMatch?.[1] || extractVersion(mvnOut),
        home: homeMatch?.[1]?.trim() || '',
        vendor: mvnOut.includes('Adoptium') ? 'Eclipse Adoptium' : mvnOut.includes('Oracle') ? 'Oracle' : 'Unknown',
        source: 'mvn-version',
      };
    }
  } catch { /* fall through */ }

  // Priority 3: java -version from PATH
  try {
    const out = execSync('java -version 2>&1', { encoding: 'utf-8' });
    const match = out.match(/(\d+\.\d+(?:\.\d+)?)/);
    return {
      version: match?.[1] ?? pom.properties['java.version'] ?? '11',
      home: '',
      vendor: out.includes('Adoptium') ? 'Eclipse Adoptium' : 'Unknown',
      source: 'path',
    };
  } catch { /* fall through */ }

  // Priority 4: Override via env var
  if (process.env.MCP_JAVA_HOME) {
    return {
      version: pom.properties['java.version'] ?? '11',
      home: process.env.MCP_JAVA_HOME,
      vendor: 'override',
      source: 'override',
    };
  }

  // Fallback: from pom properties
  return {
    version: pom.properties['java.version'] ?? '11',
    home: '',
    vendor: 'Unknown',
    source: 'project-config',
  };
}

function extractVersion(output: string): string {
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1] ?? '11';
}
