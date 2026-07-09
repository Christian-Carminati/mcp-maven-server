import { execa, type Subprocess } from 'execa';
import { request } from 'node:http';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { type SpringBootInstance, type SpringBootStatus } from '../core/types.js';

const STARTUP_PATTERNS = [
  /Started\s+\S+\s+in\s+\d+\.\d+\s+seconds/,
  /Tomcat started on port\(s\):\s*(\d+)/,
  /Netty started on port\(s\):\s*(\d+)/,
  /Application\s+started/,
];

const YAML_PORT_RE = /server:\s*\n\s+port:\s*(\d+)/;
const PROP_PORT_RE = /^server\.port\s*=\s*(\d+)/m;

export class SpringBootManager {
  private instances = new Map<string, SpringBootInstance>();
  private processes = new Map<string, Subprocess>();

  async start(
    id: string,
    modulePath: string,
    moduleName: string,
    opts: { profile?: string; ringBuffer?: number; startupTimeout?: number },
  ): Promise<SpringBootInstance> {
    if (this.processes.has(id)) {
      throw new Error(`Spring Boot instance '${id}' is already running. Stop it first.`);
    }

    const port = detectPort(modulePath);

    const mvnArgs = ['spring-boot:run'];
    if (opts.profile) mvnArgs.push(`-Dspring.profiles.active=${opts.profile}`);

    const proc = execa('mvn', mvnArgs, {
      cwd: modulePath,
      windowsHide: true,
      all: true,
      buffer: false,
    });

    this.processes.set(id, proc);

    const instance: SpringBootInstance = {
      pid: proc.pid ?? 0,
      modulePath,
      moduleName,
      port,
      startTime: new Date(),
      status: 'STARTING',
      logs: [],
      healthEndpoint: `http://localhost:${port}/actuator/health`,
    };

    this.instances.set(id, instance);

    const ringBufferSize = opts.ringBuffer ?? 500;
    const startupTimeout = opts.startupTimeout ?? 120000;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        instance.status = 'RUNNING';
        resolve(instance);
      }, startupTimeout);

      const logHandler = (line: string) => {
        instance.logs.push(line);
        if (instance.logs.length > ringBufferSize) {
          instance.logs.splice(0, instance.logs.length - ringBufferSize);
        }

        const portMatch = line.match(/Tomcat started on port\(s\):\s*(\d+)/);
        if (portMatch) {
          instance.port = parseInt(portMatch[1], 10);
          instance.healthEndpoint = `http://localhost:${instance.port}/actuator/health`;
        }

        if (STARTUP_PATTERNS.some(p => p.test(line))) {
          instance.status = 'RUNNING';
          clearTimeout(timeout);
          resolve(instance);
        }
      };

      const stream = proc.all;
      if (stream) {
        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8');
          text.split('\n').filter(l => l).forEach(logHandler);
        });
      }

      proc.catch((err) => {
        clearTimeout(timeout);
        instance.status = 'CRASHED';
        instance.logs.push(`Process exited with error: ${err.message}`);
        if (!instance.port) resolve(instance);
        else reject(err);
      });
    });
  }

  async stop(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) return;

    try {
      await gracefulShutdown(instance.port);
    } catch { /* fall through */ }

    const proc = this.processes.get(id);
    if (proc) {
      try { await proc.kill('SIGTERM'); } catch { /* ignore */ }
      this.processes.delete(id);
    }

    instance.status = 'STOPPED';
  }

  get(id: string): SpringBootInstance | undefined {
    return this.instances.get(id);
  }

  getAll(): Map<string, SpringBootInstance> {
    return this.instances;
  }

  isRunning(id: string): boolean {
    const instance = this.instances.get(id);
    return instance?.status === 'RUNNING' || instance?.status === 'STARTING';
  }
}

function detectPort(modulePath: string): number {
  const propPath = join(modulePath, 'src', 'main', 'resources', 'application.properties');
  if (existsSync(propPath)) {
    const content = readFileSync(propPath, 'utf-8');
    const match = content.match(PROP_PORT_RE);
    if (match) return parseInt(match[1], 10);
  }

  for (const name of ['application.yml', 'application.yaml']) {
    const ymlPath = join(modulePath, 'src', 'main', 'resources', name);
    if (existsSync(ymlPath)) {
      const content = readFileSync(ymlPath, 'utf-8');
      const match = content.match(YAML_PORT_RE);
      if (match) return parseInt(match[1], 10);
    }
  }

  return 8080;
}

function gracefulShutdown(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: 'localhost', port, path: '/actuator/shutdown', method: 'POST', timeout: 5000 },
      () => resolve(),
    );
    req.on('error', reject);
    req.end();
  });
}
