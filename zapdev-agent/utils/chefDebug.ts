import type { WebContainer } from '@webcontainer/api';
import type { Message } from 'ai';

type ZapDevDebug = {
  messages?: Message[];
  parsedMessages?: Message[];
  webcontainer?: WebContainer;
  setLogLevel?: (level: any) => void;
  chatInitialId?: string;
  sessionId?: string;
};

export function setZapDevDebugProperty(key: keyof ZapDevDebug, value: ZapDevDebug[keyof ZapDevDebug]) {
  if (typeof window === 'undefined') {
    console.warn('setZapDevDebugProperty called on server, ignoring');
    return;
  }
  (window as any).__ZAPDEV_DEBUG = (window as any).__ZAPDEV_DEBUG || {};
  (window as any).__ZAPDEV_DEBUG[key] = value;
}
