import { useConvex } from 'convex/react';

import { useConvexAuth } from 'convex/react';
import { createContext, useContext, useEffect, useRef } from 'react';

import { sessionIdStore } from '~/lib/stores/sessionId';

import { useConvexSessionIdOrNullOrLoading } from '~/lib/stores/sessionId';
import type { Id } from '@convex/_generated/dataModel';
import { useLocalStorage } from '@uidotdev/usehooks';
import { api } from '@convex/_generated/api';
import { toast } from 'sonner';
import { fetchOptIns } from '~/lib/convexOptins';
import { setZapdevDebugProperty } from 'zapdev-agent/utils/zapdevDebug';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';
type ZapdevAuthState =
  | {
      kind: 'loading';
    }
  | {
      kind: 'unauthenticated';
    }
  | {
      kind: 'fullyLoggedIn';
      sessionId: Id<'sessions'>;
    };

const ZapdevAuthContext = createContext<{
  state: ZapdevAuthState;
}>(null as unknown as { state: ZapdevAuthState });

export function useZapdevAuth() {
  const state = useContext(ZapdevAuthContext);
  if (state === null) {
    throw new Error('useZapdevAuth must be used within a ZapdevAuthProvider');
  }
  return state.state;
}

export function useZapdevAuthContext() {
  const state = useContext(ZapdevAuthContext);
  if (state === null) {
    throw new Error('useZapdevAuth must be used within a ZapdevAuthProvider');
  }
  return state;
}

export const SESSION_ID_KEY = 'sessionIdForConvex';

export const ZapdevAuthProvider = ({
  children,
  redirectIfUnauthenticated,
}: {
  children: React.ReactNode;
  redirectIfUnauthenticated: boolean;
}) => {
  const sessionId = useConvexSessionIdOrNullOrLoading();
  const convex = useConvex();
  const { isAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const [sessionIdFromLocalStorage, setSessionIdFromLocalStorage] = useLocalStorage<Id<'sessions'> | null>(
    SESSION_ID_KEY,
    null,
  );
  const hasAlertedAboutOptIns = useRef(false);
  const authRetries = useRef(0);
  const { getToken, isSignedIn } = useClerkAuth();

  useEffect(() => {
    function setSessionId(sessionId: Id<'sessions'> | null) {
      setSessionIdFromLocalStorage(sessionId);
      sessionIdStore.set(sessionId);
      if (sessionId) {
        setZapdevDebugProperty('sessionId', sessionId);
      }
    }

    const isUnauthenticated = !isAuthenticated && !isConvexAuthLoading;

    if (sessionId === undefined && isUnauthenticated) {
      setSessionId(null);
      return undefined;
    }

    if (sessionId !== null && isUnauthenticated) {
      setSessionId(null);
      return undefined;
    }
    let verifySessionTimeout: ReturnType<typeof setTimeout> | null = null;

    async function verifySession() {
      if (sessionIdFromLocalStorage) {
        // Seems like auth might not automatically refresh its state, so call this to kick it
        try {
          // Ensure Clerk is initialized
          await getToken();
          authRetries.current = 0;
        } catch (_e) {
          console.error('Unable to fetch token from Clerk');
          if (authRetries.current < 3 && verifySessionTimeout === null) {
            authRetries.current++;
            verifySessionTimeout = setTimeout(() => {
              void verifySession();
            }, 1000);
          }
          return;
        }
        if (!isAuthenticated && !isSignedIn) {
          // Wait until auth is propagated to Convex before we try to verify the session
          return;
        }
        let isValid: boolean = false;
        try {
          isValid = await convex.query(api.sessions.verifySession, {
            sessionId: sessionIdFromLocalStorage as Id<'sessions'>,
          });
        } catch (error) {
          console.error('Error verifying session', error);
          toast.error('Unexpected error verifying credentials');
          setSessionId(null);
        }
        if (isValid) {
          const optIns = await fetchOptIns(convex);
          if (optIns.kind === 'loaded' && optIns.optIns.length === 0) {
            setSessionId(sessionIdFromLocalStorage as Id<'sessions'>);
          }
          if (!hasAlertedAboutOptIns.current && optIns.kind === 'loaded' && optIns.optIns.length > 0) {
            toast.info('Please accept the Convex Terms of Service to continue');
            hasAlertedAboutOptIns.current = true;
          }
          if (hasAlertedAboutOptIns.current && optIns.kind === 'error') {
            toast.error('Unexpected error setting up your account.');
          }
        } else {
          // Clear it, the next loop around we'll try creating a new session
          // if we're authenticated.
          setSessionId(null);
        }
      }

      if (isAuthenticated) {
        try {
          const sessionId = await convex.mutation(api.sessions.startSession);
          setSessionId(sessionId);
        } catch (error) {
          console.error('Error creating session', error);
          setSessionId(null);
        }
      }
      return;
    }

    void verifySession();
    return () => {
      if (verifySessionTimeout) {
        clearTimeout(verifySessionTimeout);
      }
    };
  }, [
    convex,
    sessionId,
    isAuthenticated,
    isConvexAuthLoading,
    sessionIdFromLocalStorage,
    setSessionIdFromLocalStorage,
    getToken,
    isSignedIn,
  ]);

  const isLoading = sessionId === undefined || isConvexAuthLoading;
  const isUnauthenticated = sessionId === null || !isAuthenticated;
  const state: ZapdevAuthState = isLoading
    ? { kind: 'loading' }
    : isUnauthenticated
      ? { kind: 'unauthenticated' }
      : { kind: 'fullyLoggedIn', sessionId: sessionId as Id<'sessions'> };

  if (redirectIfUnauthenticated && state.kind === 'unauthenticated') {
    console.log('redirecting to /');
    // Hard navigate to avoid any potential state leakage
    window.location.href = '/';
  }

  return <ZapdevAuthContext.Provider value={{ state }}>{children}</ZapdevAuthContext.Provider>;
};
