import { useEffect } from 'react';
import { ContainerBootState, setContainerBootState, waitForBootStepCompleted } from '~/lib/stores/containerBootState';
import { codeInterpreter, executeCommand } from '~/lib/e2b';
import { useStore } from '@nanostores/react';
import { sessionIdStore } from '~/lib/stores/sessionId';
import { api } from '@convex/_generated/api';
import type { ConvexReactClient } from 'convex/react';
import { useConvex } from 'convex/react';
import { decompressWithLz4 } from '~/lib/compression';
import { cleanTerminalOutput } from 'zapdev-agent/utils/shell';
import { toast } from 'sonner';
import { waitForConvexProjectConnection } from '~/lib/stores/convexProject';
import type { ConvexProject } from 'zapdev-agent/types';
import type { CodeInterpreter } from '@e2b/code-interpreter';
import { queryEnvVariableWithRetries, setEnvVariablesWithRetries } from 'zapdev-agent/convexEnvVariables';
import { getConvexSiteUrl } from '~/lib/convexSiteUrl';
import { workbenchStore } from '~/lib/stores/workbench.client';
import { initializeConvexAuth } from 'zapdev-agent/convexAuth';
import { appendEnvVarIfNotSet } from '~/utils/envFileUtils';
import { getFileUpdateCounter } from '~/lib/stores/fileUpdateCounter';
import { chatSyncState } from './chatSyncState';
import { FILE_EVENTS_DEBOUNCE_MS } from '~/lib/stores/files';
import { setZapdevDebugProperty } from 'zapdev-agent/utils/zapdevDebug';

const TEMPLATE_URL = '/template-snapshot-63fbe575.bin';

export function useNewChatContainerSetup() {
  const convex = useConvex();
  useEffect(() => {
    const runSetup = async () => {
      try {
        await waitForBootStepCompleted(ContainerBootState.STARTING);
        await setupContainer(convex, { snapshotUrl: TEMPLATE_URL, allowNpmInstallFailure: false });
      } catch (error: any) {
        toast.error('Failed to setup Zapdev environment. Try reloading the page.');
        setContainerBootState(ContainerBootState.ERROR, error);
      }
    };
    void runSetup();
  }, [convex]);
}

export function useExistingChatContainerSetup(loadedChatId: string | undefined) {
  const sessionId = useStore(sessionIdStore);
  const convex = useConvex();
  useEffect(() => {
    if (!sessionId) {
      return;
    }
    if (!loadedChatId) {
      return;
    }
    const runSetup = async () => {
      try {
        await waitForBootStepCompleted(ContainerBootState.STARTING);
        let snapshotUrl = await convex.query(api.snapshot.getSnapshotUrl, { chatId: loadedChatId, sessionId });
        if (!snapshotUrl) {
          console.warn(`Existing chat ${loadedChatId} has no snapshot. Loading the base template.`);
          snapshotUrl = TEMPLATE_URL;
        }
        await setupContainer(convex, { snapshotUrl, allowNpmInstallFailure: true });
      } catch (error: any) {
        toast.error('Failed to setup Zapdev environment. Try reloading the page.');
        setContainerBootState(ContainerBootState.ERROR, error);
      }
    };
    void runSetup();
  }, [convex, loadedChatId, sessionId]);
}

async function setupContainer(
  convex: ConvexReactClient,
  options: { snapshotUrl: string; allowNpmInstallFailure: boolean },
) {
  const resp = await fetch(options.snapshotUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download snapshot (${resp.statusText}): ${resp.statusText}`);
  }
  const compressed = await resp.arrayBuffer();
  const decompressed = decompressWithLz4(new Uint8Array(compressed));

  const interpreter = await codeInterpreter;
  // TODO: Implement snapshot mounting for E2B
  console.warn('Snapshot mounting not yet implemented for E2B');

  // After loading the snapshot, we need to load the files into the FilesStore since
  // we won't receive file events for snapshot files.
  await workbenchStore.prewarmWorkdir(interpreter);

  setZapdevDebugProperty('codeInterpreter', interpreter);

  setContainerBootState(ContainerBootState.DOWNLOADING_DEPENDENCIES);
  const { stdout, stderr, exitCode } = await executeCommand('npm install --no-fund --no-deprecated');
  const output = stdout + stderr;
  console.log('NPM output', cleanTerminalOutput(output));

  if (exitCode !== 0) {
    if (options.allowNpmInstallFailure) {
      toast.error(`Failed to install dependencies. Fix your package.json and tell Zapdev to redeploy.`, {
        duration: Infinity,
      });
      console.error(`npm install failed with exit code ${exitCode}: ${output}`);
    } else {
      throw new Error(`npm install failed with exit code ${exitCode}: ${output}`);
    }
  }

  setContainerBootState(ContainerBootState.SETTING_UP_CONVEX_PROJECT);
  const convexProject = await waitForConvexProjectConnection();

  setContainerBootState(ContainerBootState.SETTING_UP_CONVEX_ENV_VARS);
  await setupConvexEnvVars(interpreter, convexProject);
  await setupOpenAIToken(convex, convexProject);
  await setupResendToken(convex, convexProject);
  setContainerBootState(ContainerBootState.CONFIGURING_CONVEX_AUTH);
  await initializeConvexAuth(convexProject);

  setContainerBootState(ContainerBootState.STARTING_BACKUP);
  await initializeFileSystemBackup();

  setContainerBootState(ContainerBootState.READY);
}

async function initializeFileSystemBackup() {
  // This is a bit racy, but we need to flush the current file events before
  // deciding that we're synced up to the current update counter. Sleep for
  // twice the batching interval.
  await new Promise((resolve) => setTimeout(resolve, FILE_EVENTS_DEBOUNCE_MS * 2));
  const currentChatSyncState = chatSyncState.get();
  if (currentChatSyncState.savedFileUpdateCounter === null) {
    const fileUpdateCounter = getFileUpdateCounter();
    chatSyncState.set({
      ...currentChatSyncState,
      savedFileUpdateCounter: fileUpdateCounter,
    });
  }
}

async function setupConvexEnvVars(interpreter: CodeInterpreter, convexProject: ConvexProject) {
  const { token } = convexProject;
  // TODO: Implement E2B-compatible env var setup
  console.warn('setupConvexEnvVars not yet implemented for E2B');
}

async function setupOpenAIToken(convex: ConvexReactClient, project: ConvexProject) {
  const existing = await queryEnvVariableWithRetries(project, 'CONVEX_OPENAI_API_KEY');
  if (existing) {
    return;
  }
  const token = await convex.mutation(api.openaiProxy.issueOpenAIToken);
  if (token) {
    await setEnvVariablesWithRetries(project, {
      CONVEX_OPENAI_API_KEY: token,
      CONVEX_OPENAI_BASE_URL: getConvexSiteUrl() + '/openai-proxy',
    });
  }
}

async function setupResendToken(convex: ConvexReactClient, project: ConvexProject) {
  const existing = await queryEnvVariableWithRetries(project, 'CONVEX_RESEND_API_KEY');
  if (existing) {
    return;
  }
  const token = await convex.mutation(api.resendProxy.issueResendToken);
  if (token) {
    await setEnvVariablesWithRetries(project, {
      CONVEX_RESEND_API_KEY: token,
      RESEND_BASE_URL: getConvexSiteUrl() + '/resend-proxy',
    });
  }
}
