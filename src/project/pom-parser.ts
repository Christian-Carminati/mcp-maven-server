import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

export interface ParsedPom {
  groupId: string;
  artifactId: string;
  version: string;
  packaging: string;
  parent: { groupId: string; artifactId: string; version: string; relativePath: string | null } | null;
  properties: Record<string, string>;
  modules: string[];
  dependencies: Array<{ groupId: string; artifactId: string; version: string; scope?: string }>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  trimValues: true,
});

export function parsePom(pomPath: string): ParsedPom {
  const raw = readFileSync(pomPath, 'utf-8');
  const parsed = xmlParser.parse(raw);
  const project = parsed.project || {};

  const props: Record<string, string> = {};
  if (project.properties && typeof project.properties === 'object') {
    for (const [key, val] of Object.entries(project.properties)) {
      if (typeof val === 'string' || typeof val === 'number') props[key] = String(val);
    }
  }

  const modules: string[] = [];
  if (project.modules?.module) {
    const mods = project.modules.module;
    if (Array.isArray(mods)) modules.push(...mods);
    else modules.push(mods);
  }

  function resolveVal(value: string | undefined): string {
    if (!value) return '';
    return value.replace(/\$\{([^}]+)\}/g, (_: string, key: string) => props[key] ?? '');
  }

  const parentRaw = project.parent;
  const parent = parentRaw
    ? {
        groupId: parentRaw.groupId ?? '',
        artifactId: parentRaw.artifactId ?? '',
        version: resolveVal(parentRaw.version),
        relativePath: parentRaw.relativePath ?? null,
      }
    : null;

  return {
    groupId: resolveVal(project.groupId),
    artifactId: resolveVal(project.artifactId),
    version: resolveVal(project.version),
    packaging: project.packaging ?? 'jar',
    parent,
    properties: props,
    modules,
    dependencies: [],
  };
}
