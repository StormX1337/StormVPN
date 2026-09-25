import { execFile } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

/** Runs binaries without a shell (no injection surface). Injectable for tests. */
export interface CommandRunner {
  run(command: string, args: string[], options?: { input?: string; timeoutMs?: number }): Promise<CommandResult>;
}

export class ExecFileRunner implements CommandRunner {
  run(command: string, args: string[], options: { input?: string; timeoutMs?: number } = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        command,
        args,
        { timeout: options.timeoutMs ?? 15_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`${command} ${args[0] ?? ''} failed: ${stderr.trim() || error.message}`));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
      if (options.input !== undefined) child.stdin?.end(options.input);
    });
  }
}
