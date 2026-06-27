import type {
  CommandResult,
  CreateSandboxOptions,
  RunCommandOptions,
  SandboxHandle,
  SandboxProvider,
} from '../../src/sandbox/types.js';

export interface ScriptedCommand {
  /** Substring matched against the command; first match wins. */
  match: string;
  result?: CommandResult;
  /** When set, runCommand throws this message (simulates a sandbox infra error). */
  throwError?: string;
}

const ok: CommandResult = { exitCode: 0, stdout: '', stderr: '' };

let handleSeq = 0;

export class FakeSandboxHandle implements SandboxHandle {
  readonly id = `fake-sbx-${++handleSeq}`;
  readonly commands: { cmd: string; opts?: RunCommandOptions }[] = [];
  killed = 0;

  constructor(private readonly scripts: ScriptedCommand[]) {}

  async runCommand(cmd: string, opts?: RunCommandOptions): Promise<CommandResult> {
    this.commands.push({ cmd, opts });
    const script = this.scripts.find((s) => cmd.includes(s.match));
    if (!script) return ok; // unmatched commands succeed by default
    if (script.throwError) throw new Error(script.throwError);
    return script.result ?? ok;
  }

  async kill(): Promise<void> {
    this.killed += 1;
  }

  ranAny(substr: string): boolean {
    return this.commands.some((c) => c.cmd.includes(substr));
  }
}

export class FakeSandboxProvider implements SandboxProvider {
  readonly created: FakeSandboxHandle[] = [];
  createError?: string;

  constructor(private readonly scripts: ScriptedCommand[] = []) {}

  async create(_opts?: CreateSandboxOptions): Promise<SandboxHandle> {
    if (this.createError) throw new Error(this.createError);
    const handle = new FakeSandboxHandle(this.scripts);
    this.created.push(handle);
    return handle;
  }

  /** The single handle created in a one-run test (asserts teardown). */
  get only(): FakeSandboxHandle {
    if (this.created.length !== 1) {
      throw new Error(`expected exactly one sandbox, got ${this.created.length}`);
    }
    return this.created[0]!;
  }
}
