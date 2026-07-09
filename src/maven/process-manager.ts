import { type ChildProcessByStdio } from 'node:child_process';

interface SpawnedProcess {
  id: string;
  child: ChildProcessByStdio<null, null, null>;
  startTime: number;
}

export class ProcessManager {
  private processes = new Map<string, SpawnedProcess>();

  register(id: string, child: ChildProcessByStdio<null, null, null>): void {
    this.processes.set(id, { id, child, startTime: Date.now() });
  }

  async kill(id: string): Promise<void> {
    const entry = this.processes.get(id);
    if (!entry) return;
    try {
      entry.child.kill('SIGTERM');
    } finally {
      this.processes.delete(id);
    }
  }

  async killAll(): Promise<void> {
    const ids = Array.from(this.processes.keys());
    await Promise.all(ids.map(id => this.kill(id)));
  }

  isRunning(id: string): boolean {
    return this.processes.has(id);
  }

  getRunningCount(): number {
    return this.processes.size;
  }
}
