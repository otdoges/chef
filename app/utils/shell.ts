import type { CodeInterpreter } from '@e2b/code-interpreter';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from './promises';
import { ContainerBootState, waitForContainerBootState } from '~/lib/stores/containerBootState';
import { cleanTerminalOutput } from 'zapdev-agent/utils/shell';
import { executeCommand } from '~/lib/e2b';

export async function newShellProcess(codeInterpreter: CodeInterpreter, terminal: ITerminal) {
  // Wait for setup to fully complete before allowing shells to spawn.
  await waitForContainerBootState(ContainerBootState.READY);

  // Initialize E2B terminal session
  terminal.write('🚀 E2B Shell Ready\n\n$ ');
  
  // Set up command input handling
  let commandBuffer = '';
  terminal.onData((data) => {
    if (data === '\r') {
      // Execute command on Enter
      if (commandBuffer.trim()) {
        executeTerminalCommand(codeInterpreter, terminal, commandBuffer.trim());
        commandBuffer = '';
      }
      terminal.write('\r\n$ ');
    } else if (data === '\x7f') {
      // Handle backspace
      if (commandBuffer.length > 0) {
        commandBuffer = commandBuffer.slice(0, -1);
        terminal.write('\b \b');
      }
    } else if (data.charCodeAt(0) >= 32) {
      // Handle printable characters
      commandBuffer += data;
      terminal.write(data);
    }
  });

  return {
    sessionId: `shell_${Date.now()}`,
    destroy: () => {
      // Cleanup logic if needed
    }
  };
}

async function executeTerminalCommand(codeInterpreter: CodeInterpreter, terminal: ITerminal, command: string) {
  try {
    const result = await executeCommand(command);
    
    if (result.stdout) {
      terminal.write(result.stdout + '\n');
    }
    
    if (result.stderr) {
      terminal.write('\x1b[31m' + result.stderr + '\x1b[0m\n'); // Red color for stderr
    }
  } catch (error: any) {
    terminal.write('\x1b[31mError: ' + error.message + '\x1b[0m\n');
  }
}

type ExecutionResult = { output: string; exitCode: number };

export class E2BShell {
  #initialized: (() => void) | undefined;
  #readyPromise: Promise<void>;
  #codeInterpreter: CodeInterpreter | undefined;
  #terminal: ITerminal | undefined;
  #sessionId: string | undefined;

  constructor() {
    this.#readyPromise = new Promise((resolve) => {
      this.#initialized = resolve;
    });
  }

  ready() {
    return this.#readyPromise;
  }

  async init(codeInterpreter: CodeInterpreter, terminal: ITerminal) {
    this.#codeInterpreter = codeInterpreter;
    this.#terminal = terminal;
    this.#sessionId = `e2b_shell_${Date.now()}`;

    // Initialize the terminal
    terminal.write('🚀 E2B Shell Initialized\n\n');
    this.#initialized?.();
  }

  get terminal() {
    return this.#terminal;
  }

  async startCommand(command: string) {
    if (!this.#codeInterpreter || !this.#terminal) {
      throw new Error('Terminal not initialized');
    }

    // For E2B, we execute commands directly
    return this.executeCommand(command);
  }

  async executeCommand(command: string): Promise<ExecutionResult> {
    if (!this.#codeInterpreter) {
      throw new Error('Code interpreter not initialized');
    }

    try {
      const result = await executeCommand(command);
      
      let output = '';
      if (result.stdout) {
        output += result.stdout;
      }
      if (result.stderr) {
        output += result.stderr;
      }

      let cleanedOutput = output;
      try {
        cleanedOutput = cleanTerminalOutput(output);
      } catch (error) {
        console.log('failed to format terminal output', error);
      }

      return { output: cleanedOutput, exitCode: result.exitCode };
    } catch (error: any) {
      return { 
        output: `Error: ${error.message}`, 
        exitCode: 1 
      };
    }
  }

  write(data: string) {
    if (this.#terminal) {
      this.#terminal.write(data);
    }
  }

  destroy() {
    // Cleanup logic for E2B shell
    this.#codeInterpreter = undefined;
    this.#terminal = undefined;
    this.#sessionId = undefined;
  }
}

export function newE2BShellProcess() {
  return new E2BShell();
}

// Legacy alias for backward compatibility
export function newBoltShellProcess() {
  return new E2BShell();
}