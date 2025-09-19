import type { CodeInterpreter } from '@e2b/code-interpreter';
import type { Message } from 'ai';

type ZapdevDebug = {
  messages?: Message[];
  parsedMessages?: Message[];
  codeInterpreter?: CodeInterpreter;
  setLogLevel?: (level: any) => void;
  chatInitialId?: string;
  sessionId?: string;
};

export function setZapdevDebugProperty(key: keyof ZapdevDebug, value: ZapdevDebug[keyof ZapdevDebug]) {
  if (typeof window === 'undefined') {
    console.warn('setZapdevDebugProperty called on server, ignoring');
    return;
  }
  (window as any).__ZAPDEV_DEBUG = (window as any).__ZAPDEV_DEBUG || {};
  (window as any).__ZAPDEV_DEBUG[key] = value;
}
