import { CodeInterpreter } from '@e2b/code-interpreter';
import { WORK_DIR_NAME } from 'zapdev-agent/constants';
import { createScopedLogger } from 'zapdev-agent/utils/logger';
import { setContainerBootState, ContainerBootState } from '~/lib/stores/containerBootState';

let e2bApiKeyPromise: Promise<string> | null = null;

async function fetchE2BApiKey(): Promise<string> {
  if (!e2bApiKeyPromise) {
    e2bApiKeyPromise = fetch('/api/e2b-key')
      .then(async (response) => {
        if (!response.ok) {
          const message = await extractErrorMessage(response);
          throw new Error(message || 'Failed to fetch E2B API key.');
        }

        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || typeof (data as { apiKey?: unknown }).apiKey !== 'string') {
          throw new Error('Malformed response while fetching E2B API key.');
        }

        return (data as { apiKey: string }).apiKey;
      })
      .catch((error) => {
        e2bApiKeyPromise = null;
        throw error;
      });
  }

  return e2bApiKeyPromise;
}

async function extractErrorMessage(response: Response): Promise<string | null> {
  try {
    const data: unknown = await response.clone().json();
    if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
  } catch {
    // ignore JSON parsing errors
  }

  try {
    const text = await response.clone().text();
    if (text) {
      return text;
    }
  } catch {
    // ignore text parsing errors
  }

  return null;
}

interface E2BContext {
  loaded: boolean;
}

const e2bContext: E2BContext = import.meta.hot?.data.e2bContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.e2bContext = e2bContext;
}

export let codeInterpreter: Promise<CodeInterpreter> = new Promise(() => {
  // noop for ssr
});

const logger = createScopedLogger('e2b');

let shouldBootE2B = false;
if (!import.meta.env.SSR) {
  // E2B doesn't require cross-origin isolation like WebContainer
  shouldBootE2B = true;
}

if (shouldBootE2B) {
  codeInterpreter =
    import.meta.hot?.data.codeInterpreter ??
    Promise.resolve()
      .then(async () => {
        setContainerBootState(ContainerBootState.STARTING);

        const apiKey = await fetchE2BApiKey();

        const interpreter = await CodeInterpreter.create({
          apiKey,
          template: 'base',
          metadata: {
            keepAlive: '300s', // 5 minutes
          },
        });

        // Set up working directory
        await interpreter.notebook.execCell(`
import os
os.chdir('${WORK_DIR_NAME}')
if not os.path.exists('${WORK_DIR_NAME}'):
    os.makedirs('${WORK_DIR_NAME}')
`);

        return interpreter;
      })
      .then(async (interpreter) => {
        // Set the container boot state to LOADING_SNAPSHOT to hand off control
        // to the container setup code.
        setContainerBootState(ContainerBootState.LOADING_SNAPSHOT);
        (globalThis as any).codeInterpreter = interpreter;
        logger.info('✅ E2B Code Interpreter initialized!');
        return interpreter;
      })
      .catch((error) => {
        setContainerBootState(ContainerBootState.ERROR, error);
        logger.error('❌ Failed to initialize E2B Code Interpreter:', error);
        throw error;
      });

  if (import.meta.hot) {
    import.meta.hot.data.codeInterpreter = codeInterpreter;
  }
}

// E2B helper functions
export async function executeCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const interpreter = await codeInterpreter;

  try {
    const result = await interpreter.notebook.execCell(`
import subprocess
import sys

result = subprocess.run(
    "${command}",
    shell=True,
    capture_output=True,
    text=True
)

print(f"STDOUT: {result.stdout}")
print(f"STDERR: {result.stderr}")
print(f"EXIT_CODE: {result.returncode}")
`);

    // Parse the output to extract stdout, stderr, and exit code
    const output = result.results?.[0]?.text || '';
    const lines = output.split('\n');

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    for (const line of lines) {
      if (line.startsWith('STDOUT: ')) {
        stdout = line.substring(8);
      } else if (line.startsWith('STDERR: ')) {
        stderr = line.substring(8);
      } else if (line.startsWith('EXIT_CODE: ')) {
        exitCode = parseInt(line.substring(11), 10) || 0;
      }
    }

    return { stdout, stderr, exitCode };
  } catch (error) {
    logger.error('Error executing command:', error);
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Unknown error',
      exitCode: 1,
    };
  }
}

export async function writeFile(path: string, content: string): Promise<void> {
  const interpreter = await codeInterpreter;

  try {
    await interpreter.notebook.execCell(`
import os
import base64

# Ensure directory exists
dir_path = os.path.dirname('${path}')
if dir_path and not os.path.exists(dir_path):
    os.makedirs(dir_path, exist_ok=True)

# Write file content (handling binary data via base64)
content = '''${content.replace(/'/g, "\\'")}'''
with open('${path}', 'w', encoding='utf-8') as f:
    f.write(content)
`);
  } catch (error) {
    logger.error('Error writing file:', error);
    throw error;
  }
}

export async function readFile(path: string): Promise<string> {
  const interpreter = await codeInterpreter;

  try {
    const result = await interpreter.notebook.execCell(`
try:
    with open('${path}', 'r', encoding='utf-8') as f:
        content = f.read()
    print(f"FILE_CONTENT: {content}")
except FileNotFoundError:
    print("FILE_NOT_FOUND")
except Exception as e:
    print(f"ERROR: {e}")
`);

    const output = result.results?.[0]?.text || '';

    if (output.includes('FILE_NOT_FOUND')) {
      throw new Error(`File not found: ${path}`);
    }

    if (output.startsWith('ERROR: ')) {
      throw new Error(output.substring(7));
    }

    if (output.startsWith('FILE_CONTENT: ')) {
      return output.substring(14);
    }

    return '';
  } catch (error) {
    logger.error('Error reading file:', error);
    throw error;
  }
}

export async function listFiles(path: string = '.'): Promise<Array<{ name: string; type: 'file' | 'directory' }>> {
  const interpreter = await codeInterpreter;

  try {
    const result = await interpreter.notebook.execCell(`
import os
import json

try:
    items = []
    for item in os.listdir('${path}'):
        item_path = os.path.join('${path}', item)
        if os.path.isfile(item_path):
            items.append({"name": item, "type": "file"})
        elif os.path.isdir(item_path):
            items.append({"name": item, "type": "directory"})
    
    print(json.dumps(items))
except Exception as e:
    print(f"ERROR: {e}")
`);

    const output = result.results?.[0]?.text || '';

    if (output.startsWith('ERROR: ')) {
      throw new Error(output.substring(7));
    }

    try {
      return JSON.parse(output);
    } catch {
      return [];
    }
  } catch (error) {
    logger.error('Error listing files:', error);
    return [];
  }
}

export async function deleteFile(path: string): Promise<void> {
  const interpreter = await codeInterpreter;

  try {
    await interpreter.notebook.execCell(`
import os

try:
    if os.path.isfile('${path}'):
        os.remove('${path}')
    elif os.path.isdir('${path}'):
        import shutil
        shutil.rmtree('${path}')
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {e}")
`);
  } catch (error) {
    logger.error('Error deleting file:', error);
    throw error;
  }
}

export async function startDevServer(port: number = 5173): Promise<void> {
  const interpreter = await codeInterpreter;

  try {
    // Install dependencies first
    await interpreter.notebook.execCell(`
import subprocess
import os

# Change to working directory
os.chdir('${WORK_DIR_NAME}')

# Install dependencies if package.json exists
if os.path.exists('package.json'):
    result = subprocess.run(['npm', 'install'], capture_output=True, text=True)
    print(f"npm install result: {result.returncode}")
    
    # Start dev server
    subprocess.Popen(['npm', 'run', 'dev', '--', '--port', '${port}'])
    print(f"Started dev server on port ${port}")
`);
  } catch (error) {
    logger.error('Error starting dev server:', error);
    throw error;
  }
}
