import { type CompilationResult, type CompileError } from '../core/types.js';

const JAVAC_ERROR_RE = /^(.+?\.java):(\d+)(?::(\d+))?:\s*(error|warning):\s*(.+)$/i;
const MAVEN_PLUGIN_ERROR_RE = /^\[ERROR\]\s+Failed to execute goal\s+(\S+)/;
const GENERIC_ERROR_RE = /^\[ERROR\]\s+(.+)/;

export function parseCompilationOutput(output: string): CompilationResult {
  const lines = output.split('\n');
  const errors: CompileError[] = [];
  let warnings = 0;
  let contextBuffer: string[] = [];
  let currentError: Partial<CompileError> | null = null;

  function flushContext() {
    if (currentError && contextBuffer.length > 0) {
      currentError.message = (currentError.message ?? '') + ' | ' + contextBuffer.join(' ');
      contextBuffer = [];
    }
  }

  function flushError() {
    if (currentError && currentError.file) {
      if (currentError.severity === 'WARNING') warnings++;
      else errors.push(currentError as CompileError);
    }
    currentError = null;
  }

  for (const line of lines) {
    if (line === '[ERROR] COMPILATION ERROR :') continue;

    const javacMatch = line.match(JAVAC_ERROR_RE);
    if (javacMatch) {
      flushError();
      flushContext();

      const severity = (javacMatch[4].toUpperCase() as 'ERROR' | 'WARNING');
      currentError = {
        file: javacMatch[1],
        line: parseInt(javacMatch[2], 10),
        column: javacMatch[3] ? parseInt(javacMatch[3], 10) : 0,
        severity,
        message: javacMatch[5],
      };
      continue;
    }

    if (currentError && line.startsWith(' ')) {
      const trimmed = line.trim();
      if (trimmed !== '^' && trimmed.length > 1) {
        contextBuffer.push(trimmed);
      }
      continue;
    }

    const mavenMatch = line.match(MAVEN_PLUGIN_ERROR_RE);
    if (mavenMatch && errors.length === 0 && !currentError) {
      flushError();
      flushContext();
      errors.push({
        file: '',
        line: 0,
        column: 0,
        severity: 'ERROR',
        message: `Plugin failed: ${mavenMatch[1]}`,
      });
      continue;
    }

    const genericMatch = line.match(GENERIC_ERROR_RE);
    if (genericMatch) {
      if (genericMatch[1].includes('Compilation failure')) continue;
      if (/\d+ error/.test(genericMatch[1])) continue;

      if (!currentError) {
        errors.push({
          file: '',
          line: 0,
          column: 0,
          severity: 'ERROR',
          message: genericMatch[1],
        });
      }
    }
  }

  flushError();
  flushContext();

  return {
    success: errors.length === 0,
    errors,
    warnings,
    errorCount: errors.length,
  };
}
