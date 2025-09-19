import type { CodeInterpreter } from '@e2b/code-interpreter';
import { path as nodePath } from 'zapdev-agent/utils/path';
import { atom, map, type MapStore, type WritableAtom } from 'nanostores';
import type { ActionAlert, FileHistory } from '~/types/actions';
import { createScopedLogger } from 'zapdev-agent/utils/logger';
import { unreachable } from 'zapdev-agent/utils/unreachable';
import type { ActionCallbackData } from 'zapdev-agent/message-parser';
import type { ToolInvocation } from 'ai';
import { viewParameters } from 'zapdev-agent/tools/view';
import { renderDirectory } from 'zapdev-agent/utils/renderDirectory';
import { renderFile } from 'zapdev-agent/utils/renderFile';
import { readPath, workDirRelative } from '~/utils/fileUtils';
import { ContainerBootState, waitForContainerBootState } from '~/lib/stores/containerBootState';
import { npmInstallToolParameters } from 'zapdev-agent/tools/npmInstall';
import { workbenchStore } from '~/lib/stores/workbench.client';
import { z } from 'zod';
import { editToolParameters } from 'zapdev-agent/tools/edit';
import { getAbsolutePath } from 'zapdev-agent/utils/workDir';
import { cleanConvexOutput } from 'zapdev-agent/utils/shell';
import type { BoltAction } from 'zapdev-agent/types';
import type { E2BShell } from '~/utils/shell';
import { outputLabels, type OutputLabels } from '~/lib/runtime/deployToolOutputLabels';
import type { ConvexToolName } from '~/lib/common/types';
import { lookupDocsParameters, docs, type DocKey } from 'zapdev-agent/tools/lookupDocs';
import { firecrawlToolParameters } from 'zapdev-agent/tools/firecrawl';
import { addEnvironmentVariablesParameters } from 'zapdev-agent/tools/addEnvironmentVariables';
import { openDashboardToPath } from '~/lib/stores/dashboardPath';
import { convexProjectStore } from '~/lib/stores/convexProject';
import { executeCommand, writeFile, readFile } from '~/lib/e2b';
import { WORK_DIR } from 'zapdev-agent/constants';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = (BaseActionState | FailedActionState) & { isEdit?: boolean };

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed' | 'content'>>;

type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string })
  | Pick<BaseActionState & { type: 'convex' }, 'output'>;

type ActionsMap = MapStore<Record<string, ActionState>>;

class ActionCommandError extends Error {
  readonly _output: string;
  readonly _header: string;

  constructor(message: string, output: string) {
    // Create a formatted message that includes both the error message and output
    const formattedMessage = `Failed To Execute Shell Command: ${message}\n\nOutput:\n${output}`;
    super(formattedMessage);

    // Set the output separately so it can be accessed programmatically
    this._header = message;
    this._output = output;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ActionCommandError.prototype);

    // Set the name of the error for better debugging
    this.name = 'ActionCommandError';
  }

  // Optional: Add a method to get just the terminal output
  get output() {
    return this._output;
  }
  get header() {
    return this._header;
  }
}

export class ActionRunner {
  #codeInterpreter: Promise<CodeInterpreter>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #shellTerminal: E2BShell;
  #previousToolCalls: Map<string, { toolName: string; args: any }> = new Map();
  runnerId = atom<string>(`${Date.now()}`);
  actions: ActionsMap = map({});
  onAlert?: (alert: ActionAlert) => void;
  buildOutput?: { path: string; exitCode: number; output: string };
  terminalOutput: WritableAtom<string> = atom('');
  onToolCallComplete: (args: {
    kind: 'success' | 'error';
    result: string;
    toolCallId: string;
    toolName: ConvexToolName;
  }) => void;
  
  constructor(
    codeInterpreterPromise: Promise<CodeInterpreter>,
    shellTerminal: E2BShell,
    callbacks: {
      onAlert?: (alert: ActionAlert) => void;
      onToolCallComplete: (args: {
        kind: 'success' | 'error';
        result: string;
        toolCallId: string;
        toolName: ConvexToolName;
      }) => void;
    },
  ) {
    this.#codeInterpreter = codeInterpreterPromise;
    this.#shellTerminal = shellTerminal;
    this.onAlert = callbacks.onAlert;
    this.onToolCallComplete = callbacks.onToolCallComplete;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      if (action.content !== data.action.content) {
        this.updateAction(actionId, { ...action, content: data.action.content });
      }
      return;
    }

    const abortController = new AbortController();

    if (data.action.type === 'file') {
      const files = workbenchStore.files.get();
      const absPath = getAbsolutePath(data.action.filePath);
      const existing = !!files[absPath];
      data.action.isEdit = existing;
    }

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData, args: { isStreaming: boolean }) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return; // No return value here
    }

    if (args.isStreaming && action.type !== 'file') {
      return; // No return value here
    }

    // Check for duplicate tool calls
    if (action.type === 'toolUse') {
      const parsed = action.parsedContent;
      if (parsed.state === 'call') {
        const key = `${parsed.toolName}:${JSON.stringify(parsed.args)}`;
        const previousCall = this.#previousToolCalls.get(key);
        if (previousCall) {
          this.onToolCallComplete({
            kind: 'error',
            result: 'Error: This exact action was already executed. Please try a different approach.',
            toolCallId: parsed.toolCallId,
            toolName: parsed.toolName as ConvexToolName,
          });
          return;
        }
        this.#previousToolCalls.set(key, { toolName: parsed.toolName, args: parsed.args });
      }
    }

    this.updateAction(actionId, { ...action, ...data.action, executed: !args.isStreaming });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId, args);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      });

    await this.#currentExecutionPromise;

    return;
  }

  async #executeAction(actionId: string, args: { isStreaming: boolean }) {
    const action = this.actions.get()[actionId];

    this.updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
        case 'toolUse': {
          await this.#runToolUseAction(actionId, action);
          break;
        }
        default: {
          throw new Error(`Unknown action type: ${JSON.stringify(action)}`);
        }
      }

      this.updateAction(actionId, {
        status: args.isStreaming ? 'running' : action.abortSignal.aborted ? 'aborted' : 'complete',
      });
    } catch (error) {
      if (action.abortSignal.aborted) {
        return;
      }

      this.updateAction(actionId, { status: 'failed', error: 'Action failed' });
      logger.error(`[${action.type}]:Action failed\n\n`, error);

      if (!(error instanceof ActionCommandError)) {
        return;
      }

      this.onAlert?.({
        type: 'error',
        title: 'Dev Server Failed',
        description: error.header,
        content: error.output,
      });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const relativePath = nodePath.relative(WORK_DIR, action.filePath);

    try {
      await writeFile(relativePath, action.content);
      logger.debug(`File written ${relativePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
      throw error;
    }
  }

  updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }

  async getFileHistory(filePath: string): Promise<FileHistory | null> {
    try {
      const historyPath = this.#getHistoryPath(filePath);
      const content = await readFile(historyPath);

      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to get file history:', error);
      return null;
    }
  }

  async saveFileHistory(filePath: string, history: FileHistory) {
    const historyPath = this.#getHistoryPath(filePath);

    await this.#runFileAction({
      type: 'file',
      filePath: historyPath,
      content: JSON.stringify(history),
      changeSource: 'auto-save',
    } as any);
  }

  #getHistoryPath(filePath: string) {
    return nodePath.join('.history', filePath);
  }

  async #runToolUseAction(_actionId: string, action: ActionState) {
    if (action.type !== 'toolUse') {
      unreachable('Expected tool use action');
    }

    const parsed: ToolInvocation = action.parsedContent;

    if (parsed.state === 'result') {
      return;
    }
    if (parsed.state === 'partial-call') {
      throw new Error('Tool call is still in progress');
    }

    let result: string;
    try {
      switch (parsed.toolName) {
        case 'view': {
          const args = viewParameters.parse(parsed.args);
          const relPath = workDirRelative(args.path);
          
          try {
            const content = await readFile(relPath);
            if (args.view_range && args.view_range.length !== 2) {
              throw new Error('When provided, view_range must be an array of two numbers');
            }
            result = renderFile(content, args.view_range as [number, number]);
          } catch (error) {
            // Try to list directory if file read fails
            try {
              const { listFiles } = await import('~/lib/e2b');
              const files = await listFiles(relPath);
              const children = files.reduce((acc, file) => {
                acc[file.name] = { type: file.type as 'file' | 'directory' };
                return acc;
              }, {} as Record<string, { type: 'file' | 'directory' }>);
              result = renderDirectory(children);
            } catch {
              throw new Error(`Could not read file or directory: ${relPath}`);
            }
          }
          break;
        }
        case 'edit': {
          const args = editToolParameters.parse(parsed.args);
          const relPath = workDirRelative(args.path);
          
          try {
            const content = await readFile(relPath);
            
            if (args.old.length > 1024) {
              throw new Error(`Old text must be less than 1024 characters: ${args.old}`);
            }
            if (args.new.length > 1024) {
              throw new Error(`New text must be less than 1024 characters: ${args.new}`);
            }
            const matchPos = content.indexOf(args.old);
            if (matchPos === -1) {
              throw new Error(`Old text not found: ${args.old}`);
            }
            const secondMatchPos = content.indexOf(args.old, matchPos + args.old.length);
            if (secondMatchPos !== -1) {
              throw new Error(`Old text found multiple times: ${args.old}`);
            }
            const newContent = content.replace(args.old, args.new);
            await writeFile(relPath, newContent);
            result = `Successfully edited ${args.path}`;
          } catch (error) {
            throw new Error(`Failed to edit file ${relPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }
        case 'npmInstall': {
          try {
            const args = npmInstallToolParameters.parse(parsed.args);
            await waitForContainerBootState(ContainerBootState.READY);
            
            const command = `npm install ${args.packages}`;
            const commandResult = await executeCommand(command);
            
            this.terminalOutput.set(commandResult.stdout + commandResult.stderr);
            
            const cleanedOutput = cleanConvexOutput(commandResult.stdout + commandResult.stderr);
            if (commandResult.exitCode !== 0) {
              throw new Error(`Npm install failed with exit code ${commandResult.exitCode}: ${cleanedOutput}`);
            }
            result = cleanedOutput;
          } catch (error: unknown) {
            if (error instanceof z.ZodError) {
              result = `Error: Invalid npm install arguments.  ${error}`;
            } else if (error instanceof Error) {
              result = `Error: ${error.message}`;
            } else {
              result = `Error: An unknown error occurred during npm install`;
            }
          }
          break;
        }
        case 'lookupDocs': {
          const args = lookupDocsParameters.parse(parsed.args);
          const docsToLookup = args.docs;
          const results: string[] = [];

          for (const doc of docsToLookup) {
            if (doc in docs) {
              results.push(docs[doc as DocKey]);
            } else {
              throw new Error(`Could not find documentation for component: ${doc}. It may not yet be supported.`);
            }
          }

          result = results.join('\n\n');
          break;
        }
        case 'firecrawl': {
          try {
            const args = firecrawlToolParameters.parse(parsed.args);
            const response = await fetch('/api/firecrawl', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: args.url,
                format: args.format ?? 'markdown',
                includeMetadata: args.includeMetadata ?? true,
              }),
            });

            const responseBody = await response.json().catch(() => null);
            if (!response.ok) {
              const errorMessage = typeof responseBody?.error === 'string'
                ? responseBody.error
                : `Firecrawl request failed with status ${response.status}`;
              throw new Error(errorMessage);
            }

            if (!responseBody || typeof responseBody.content !== 'string') {
              result = 'Error: Firecrawl returned an unexpected response.';
              break;
            }

            const metadata = responseBody.metadata ? `\n\n---\n\n**Metadata**\n\n\`\`\`json\n${JSON.stringify(responseBody.metadata, null, 2)}\n\`\`\`` : '';
            result = `## Firecrawl results for ${responseBody.url || args.url}\n\n${responseBody.content}${metadata}`;
          } catch (error) {
            if (error instanceof z.ZodError) {
              result = `Error: Invalid Firecrawl arguments. ${error.message}`;
            } else if (error instanceof Error) {
              result = `Error: ${error.message}`;
            } else {
              result = 'Error: Failed to fetch content with Firecrawl.';
            }
          }
          break;
        }
        case 'deploy': {
          await waitForContainerBootState(ContainerBootState.READY);

          result = '';

          /** Execute command and return output on success, throws error on failure. */
          const run = async (
            command: string,
            errorPrefix: OutputLabels,
            onOutput?: (s: string) => void,
          ): Promise<string> => {
            logger.info('starting to run', errorPrefix);
            const t0 = performance.now();
            
            const commandResult = await executeCommand(command);
            const output = commandResult.stdout + commandResult.stderr;
            
            if (onOutput) {
              onOutput(output);
            }

            const cleanedOutput = cleanConvexOutput(output);
            const time = performance.now() - t0;
            logger.debug('finished', errorPrefix, 'in', Math.round(time));
            
            if (commandResult.exitCode !== 0) {
              throw new Error(`[${errorPrefix}] Failed with exit code ${commandResult.exitCode}: ${cleanedOutput}`);
            }
            
            if (cleanedOutput.trim().length === 0) {
              return '';
            }
            return cleanedOutput + '\n\n';
          };

          const runCodegenAndTypecheck = async (onOutput?: (output: string) => void) => {
            // Convex codegen does a convex directory typecheck, then tsc does a full-project typecheck.
            let output = await run('convex codegen', outputLabels.convexTypecheck, onOutput);
            output += await run('tsc --noEmit -p tsconfig.app.json', outputLabels.frontendTypecheck, onOutput);
            return output;
          };

          const t0 = performance.now();
          result += await runCodegenAndTypecheck((output) => {
            this.terminalOutput.set(output);
          });
          result += await run('convex dev --once --typecheck=disable', outputLabels.convexDeploy);
          const time = performance.now() - t0;
          logger.info('deploy action finished in', time);

          // Start the default preview if it's not already running
          if (!workbenchStore.isDefaultPreviewRunning()) {
            await this.#shellTerminal.startCommand('npm run dev');
            result += '\n\nDev server started successfully!';
          }

          break;
        }
        case 'addEnvironmentVariables': {
          const args = addEnvironmentVariablesParameters.parse(parsed.args);
          const envVarNames = args.envVarNames;
          if (envVarNames.length === 0) {
            result = 'Error: No environment variables to add. Please provide a list of environment variable names.';
            break;
          }
          let path = `settings/environment-variables?var=${envVarNames[0]}`;
          for (const envVarName of envVarNames.slice(1)) {
            path += `&var=${envVarName}`;
          }
          openDashboardToPath(path);
          result = `Opened dashboard to add environment variables: ${envVarNames.join(', ')}\nPlease add the values in the dashboard.`;
          break;
        }
        case 'getConvexDeploymentName': {
          const convexProject = convexProjectStore.get();
          if (!convexProject) {
            result = 'Error: No Convex project is currently connected. Please connect a Convex project first.';
          } else {
            result = convexProject.deploymentName;
            console.log('getConvexDeploymentName tool called, returning:', result);
          }
          break;
        }
        default: {
          throw new Error(`Unknown tool: ${parsed.toolName}`);
        }
      }
      this.onToolCallComplete({
        kind: 'success',
        result,
        toolCallId: action.parsedContent.toolCallId,
        toolName: parsed.toolName,
      });
    } catch (e: any) {
      console.error('Error on tool call', e);
      let message = e.toString();
      if (!message.startsWith('Error:')) {
        message = 'Error: ' + message;
      }
      this.onToolCallComplete({
        kind: 'error',
        result: message,
        toolCallId: action.parsedContent.toolCallId,
        toolName: parsed.toolName as ConvexToolName,
      });
      throw e;
    }
  }
}