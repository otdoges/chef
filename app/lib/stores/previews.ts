import type { CodeInterpreter } from '@e2b/code-interpreter';
import { atom } from 'nanostores';
import { createScopedLogger } from 'zapdev-agent/utils/logger';
import { withResolvers } from '~/utils/promises';
import { executeCommand } from '~/lib/e2b';

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
  iframe: HTMLIFrameElement | null;
}

const PROXY_PORT_RANGE_START = 0xc4ef;

type ProxyState = { 
  sourcePort: number; 
  start: (arg: { proxyUrl: string }) => void; 
  stop: () => void; 
  processId?: string;
};

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #codeInterpreter: Promise<CodeInterpreter>;

  previews = atom<PreviewInfo[]>([]);

  #proxies = new Map<number, ProxyState>();
  #portCheckInterval: number | null = null;

  constructor(codeInterpreterPromise: Promise<CodeInterpreter>) {
    this.#codeInterpreter = codeInterpreterPromise;
    this.#init();
  }

  async #init() {
    const codeInterpreter = await this.#codeInterpreter;

    // Start monitoring for dev servers
    this.#startPortMonitoring();
  }

  #startPortMonitoring() {
    // Check for active ports every 3 seconds
    this.#portCheckInterval = window.setInterval(async () => {
      try {
        await this.#checkActivePorts();
      } catch (error) {
        console.error('Error checking active ports:', error);
      }
    }, 3000);
  }

  async #checkActivePorts() {
    try {
      // Check for common dev server ports
      const commonPorts = [3000, 5173, 8080, 4000, 5000, 8000];
      
      for (const port of commonPorts) {
        const isPortOpen = await this.#isPortOpen(port);
        const existingPreview = this.#availablePreviews.get(port);
        
        if (isPortOpen && !existingPreview) {
          // New port opened
          const baseUrl = `http://localhost:${port}`;
          const previewInfo: PreviewInfo = {
            port,
            ready: true,
            baseUrl,
            iframe: null,
          };
          
          this.#availablePreviews.set(port, previewInfo);
          const previews = this.previews.get();
          previews.push(previewInfo);
          this.previews.set([...previews]);
          
          console.log('[Preview] Server detected on port:', port, baseUrl);
        } else if (!isPortOpen && existingPreview) {
          // Port closed
          this.#availablePreviews.delete(port);
          this.previews.set(this.previews.get().filter((preview) => preview.port !== port));
          console.log('[Preview] Server closed on port:', port);
        }
      }
    } catch (error) {
      console.error('Error in port monitoring:', error);
    }
  }

  async #isPortOpen(port: number): Promise<boolean> {
    try {
      const result = await executeCommand(`curl -s --connect-timeout 1 http://localhost:${port} > /dev/null && echo "open" || echo "closed"`);
      return result.stdout.trim() === 'open';
    } catch {
      return false;
    }
  }

  /**
   * Starts a proxy server for the given source port.
   *
   * For E2B, we create a simple tunnel to the source port.
   */
  async startProxy(sourcePort: number): Promise<{ proxyPort: number; proxyUrl: string }> {
    const targetPort = PROXY_PORT_RANGE_START + this.#proxies.size;
    const { promise: onStart, resolve: start } = withResolvers<{ proxyUrl: string }>();

    const proxyLogger = createScopedLogger(`E2B Proxy ${targetPort} → ${sourcePort}`);

    const proxyState: ProxyState = {
      sourcePort,
      start,
      stop() {
        // This should never happen since the external users don't get access to
        // the ProxyState object before `startProxy` returns
        throw new Error('Proxy not started');
      },
    };
    this.#proxies.set(targetPort, proxyState);

    try {
      // Create a simple proxy using socat or nc
      const proxyCommand = `socat TCP-LISTEN:${targetPort},fork TCP:localhost:${sourcePort}`;
      const result = await executeCommand(`nohup ${proxyCommand} > /dev/null 2>&1 & echo $!`);
      const processId = result.stdout.trim();
      
      proxyState.processId = processId;
      proxyState.stop = async () => {
        proxyLogger.info('Stopping E2B proxy');
        if (processId) {
          await executeCommand(`kill ${processId}`);
        }
      };

      // Simulate port opening for the proxy
      setTimeout(() => {
        const proxyUrl = `http://localhost:${targetPort}`;
        start({ proxyUrl });
        proxyLogger.info('E2B proxy started:', proxyUrl);
      }, 1000);

      const { proxyUrl } = await onStart;
      return { proxyPort: targetPort, proxyUrl };
    } catch (error) {
      proxyLogger.error('Failed to start proxy:', error);
      // Fallback: return the source port as proxy
      const proxyUrl = `http://localhost:${sourcePort}`;
      setTimeout(() => start({ proxyUrl }), 100);
      const { proxyUrl: fallbackUrl } = await onStart;
      return { proxyPort: sourcePort, proxyUrl: fallbackUrl };
    }
  }

  /**
   * Called when a proxy server is no longer used and it can be released.
   */
  async stopProxy(proxyPort: number) {
    const proxy = this.#proxies.get(proxyPort);
    if (!proxy) {
      throw new Error(`Proxy for port ${proxyPort} not found`);
    }

    if (typeof proxy.stop === 'function') {
      await proxy.stop();
    }
    this.#proxies.delete(proxyPort);
  }

  async requestAnyScreenshot(timeout = 30000): Promise<string> {
    const t0 = performance.now();
    let previewIndex;
    do {
      previewIndex = this.previews.get().findIndex((preview) => preview.iframe);
      if (previewIndex !== -1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    } while (performance.now() < t0 + timeout);

    return this.requestScreenshot(previewIndex);
  }

  async requestScreenshot(previewIndex: number): Promise<string> {
    const iframe = this.previews.get()[previewIndex].iframe;
    if (!iframe) {
      throw new Error('No preview yet');
    }
    if (!iframe?.contentWindow) {
      throw new Error('No preview yet');
    }

    const targetOrigin = new URL(iframe.src).origin;
    let cleanup: (() => void) | undefined;

    const getScreenshotData = (): Promise<string> =>
      new Promise<string>((resolve) => {
        const handleMessage = (e: MessageEvent) => {
          if (e.origin !== targetOrigin || !('type' in e.data) || e.data.type !== 'screenshot') {
            return;
          }
          resolve(e.data.data as string);
        };
        window.addEventListener('message', handleMessage);
        cleanup = () => window.removeEventListener('message', handleMessage);
      });
    
    try {
      iframe.contentWindow?.postMessage(
        {
          type: 'zapdevPreviewRequest',
          request: 'screenshot',
        },
        targetOrigin,
      );
      return await Promise.race([
        getScreenshotData(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Screenshot timeout')), 1000)),
      ]);
    } finally {
      cleanup?.();
    }
  }

  destroy() {
    if (this.#portCheckInterval) {
      clearInterval(this.#portCheckInterval);
      this.#portCheckInterval = null;
    }

    // Stop all proxies
    for (const [port, proxy] of this.#proxies.entries()) {
      if (typeof proxy.stop === 'function') {
        proxy.stop();
      }
    }
    this.#proxies.clear();
  }
}