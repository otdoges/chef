import type { CodeInterpreter } from '@e2b/code-interpreter';
import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal, TerminalInitializationOptions } from '~/types/terminal';
import { newE2BShellProcess } from '~/utils/shell';
import { coloredText } from '~/utils/terminal';
import { workbenchStore } from './workbench.client';
import {
  activeTerminalTabStore,
  CONVEX_DEPLOY_TAB_INDEX,
  isConvexDeployTerminalVisibleStore,
  VITE_TAB_INDEX,
} from './terminalTabs';
import { toast } from 'sonner';
import { ContainerBootState, waitForBootStepCompleted } from './containerBootState';
import { executeCommand } from '~/lib/e2b';

// E2B shell process interface
interface E2BShellProcess {
  init(codeInterpreter: CodeInterpreter, terminal: ITerminal): Promise<void>;
  executeCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  write(data: string): void;
  destroy(): void;
}

export class TerminalStore {
  #codeInterpreter: Promise<CodeInterpreter>;
  #terminals: Array<{ terminal: ITerminal; sessionId: string }> = [];
  #boltTerminal = newE2BShellProcess();
  #deployTerminal = newE2BShellProcess();
  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(true);

  startDevServerOnAttach = false;

  constructor(codeInterpreterPromise: Promise<CodeInterpreter>) {
    this.#codeInterpreter = codeInterpreterPromise;

    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }
  
  get boltTerminal() {
    return this.#boltTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }

  async attachBoltTerminal(terminal: ITerminal) {
    try {
      const codeInterpreter = await this.#codeInterpreter;
      await this.#boltTerminal.init(codeInterpreter, terminal);
      // Note -- do not start the dev server here, since it will be handled by
      // `attachDeployTerminal` and to avoid conflicts with `npx convex dev`
      // triggering this server to restart
    } catch (error: any) {
      console.error('Failed to initialize bolt terminal:', error);
      terminal.write(coloredText.red('Failed to spawn dev server shell\n\n') + error.message);
      return;
    }
  }

  async deployFunctionsAndRunDevServer(shouldDeployConvexFunctions: boolean) {
    if (shouldDeployConvexFunctions) {
      // We want all the code to be there, but do not need to wait for "READY"
      await waitForBootStepCompleted(ContainerBootState.STARTING_BACKUP);
      isConvexDeployTerminalVisibleStore.set(true);
      activeTerminalTabStore.set(CONVEX_DEPLOY_TAB_INDEX);

      await this.#deployTerminal.executeCommand('clear');
      const result = await this.#deployTerminal.executeCommand('convex dev --once');

      if (result.exitCode !== 0) {
        toast.error('Failed to deploy Convex functions. Check the terminal for more details.');
        workbenchStore.currentView.set('code');
        activeTerminalTabStore.set(CONVEX_DEPLOY_TAB_INDEX);
      } else {
        isConvexDeployTerminalVisibleStore.set(false);
        activeTerminalTabStore.set(VITE_TAB_INDEX);
        toast.success('Convex functions deployed successfully');
      }
    }

    if (!workbenchStore.isDefaultPreviewRunning()) {
      await this.#boltTerminal.executeCommand('npm run dev');
    }
  }

  async attachDeployTerminal(terminal: ITerminal, options?: TerminalInitializationOptions) {
    try {
      const codeInterpreter = await this.#codeInterpreter;
      await this.#deployTerminal.init(codeInterpreter, terminal);
      if (options?.isReload) {
        await this.deployFunctionsAndRunDevServer(options.shouldDeployConvexFunctions ?? false);
      }
    } catch (error: any) {
      console.error('Failed to initialize deploy terminal:', error);
      terminal.write(coloredText.red('Failed to spawn dev server shell\n\n') + error.message);
      return;
    }
  }

  async attachTerminal(terminal: ITerminal) {
    try {
      const codeInterpreter = await this.#codeInterpreter;
      const sessionId = `terminal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Initialize terminal session
      terminal.write('🚀 E2B Terminal Ready\n\n');
      
      // Set up command input handling
      let commandBuffer = '';
      terminal.onData((data) => {
        if (data === '\r') {
          // Execute command on Enter
          if (commandBuffer.trim()) {
            this.#executeTerminalCommand(codeInterpreter, terminal, commandBuffer.trim());
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
      
      terminal.write('$ ');
      this.#terminals.push({ terminal, sessionId });
    } catch (error: any) {
      terminal.write(coloredText.red('Failed to spawn shell\n\n') + error.message);
      return;
    }
  }

  async #executeTerminalCommand(codeInterpreter: CodeInterpreter, terminal: ITerminal, command: string) {
    try {
      const result = await executeCommand(command);
      
      if (result.stdout) {
        terminal.write(result.stdout + '\n');
      }
      
      if (result.stderr) {
        terminal.write(coloredText.red(result.stderr) + '\n');
      }
    } catch (error: any) {
      terminal.write(coloredText.red(`Error: ${error.message}\n`));
    }
  }

  onTerminalResize(cols: number, rows: number) {
    // E2B doesn't require explicit terminal resizing like WebContainer
    // The terminal size is handled by the frontend terminal component
  }
}