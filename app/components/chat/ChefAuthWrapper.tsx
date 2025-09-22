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
import { setZapDevDebugProperty } from 'chef-agent/utils/chefDebug';
import { useAuth } from '@workos-inc/authkit-react';
type ChefAuthState =
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

const ChefAuthContext = createContext<{
  state: ChefAuthState;
}>(null as unknown as { state: ChefAuthState });

export function useChefAuth() {
  const state = useContext(ChefAuthContext);
  if (state === null) {
    throw new Error('useChefAuth must be used within a ChefAuthProvider');
  }
  return state.state;
}

export function useChefAuthContext() {
  const state = useContext(ChefAuthContext);
  if (state === null) {
    throw new Error('useChefAuth must be used within a ChefAuthProvider');
  }
  return state;
}

export const SESSION_ID_KEY = 'sessionIdForConvex';

export const ChefAuthProvider = ({
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
  const { getAccessToken } = useAuth();

  useEffect(() => {
    function setSessionId(sessionId: Id<'sessions'> | null) {
      setSessionIdFromLocalStorage(sessionId);
      sessionIdStore.set(sessionId);
      if (sessionId) {
        setZapDevDebugProperty('sessionId', sessionId);
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
          // Call this to prove that WorkOS is set up
          await getAccessToken({});
          authRetries.current = 0;
        } catch (_e) {
          console.error('Unable to fetch access token from WorkOS');
          if (authRetries.current < 3 && verifySessionTimeout === null) {
            authRetries.current++;
            verifySessionTimeout = setTimeout(() => {
              void verifySession();
            }, 1000);
          }
          return;
        }
        if (!isAuthenticated) {
          // Wait until auth is propagated to Convex before we try to verify the session
          // Give it a bit more time in case there's a delay in auth propagation
          if (authRetries.current < 5) {
            authRetries.current++;
            verifySessionTimeout = setTimeout(() => {
              void verifySession();
            }, 500);
          } else {
            // If we've waited long enough and still no Convex auth, try to force a refresh
            // by calling the auth query again
            try {
              await convex.query(api.sessions.startSession);
            } catch (e) {
              console.warn('Failed to refresh auth state:', e);
            }
          }
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
          } else if (optIns.kind === 'loaded' && optIns.optIns.length > 0) {
            if (!hasAlertedAboutOptIns.current) {
              toast.info('Please accept the Convex Terms of Service to continue');
              hasAlertedAboutOptIns.current = true;
            }
          } else if (optIns.kind === 'error') {
            // If opt-ins fetch fails, still allow the user to use the app
            // This is common in development environments
            console.warn('Failed to fetch opt-ins, but session is valid. Allowing access.');
            setSessionId(sessionIdFromLocalStorage as Id<'sessions'>);
            if (!hasAlertedAboutOptIns.current) {
              toast.error('Unexpected error setting up your account.');
              hasAlertedAboutOptIns.current = true;
            }
          } else if (optIns.kind === 'missingAuth') {
            // If no auth token but session is valid, allow access anyway
            console.warn('No auth token found but session is valid. Allowing access.');
            setSessionId(sessionIdFromLocalStorage as Id<'sessions'>);
          }
        } else {
          // Clear it, the next loop around we'll try creating a new session
          // if we're authenticated.
          setSessionId(null);
          if (authRetries.current === 0) {
            console.log('Session verification failed. Please try refreshing the page if you just signed in.');
          }
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
    getAccessToken,
  ]);

  const isLoading = sessionId === undefined || isConvexAuthLoading;
  const isUnauthenticated = sessionId === null || !isAuthenticated;
  const state: ChefAuthState = isLoading
    ? { kind: 'loading' }
    : isUnauthenticated
      ? { kind: 'unauthenticated' }
      : { kind: 'fullyLoggedIn', sessionId: sessionId as Id<'sessions'> };

  if (redirectIfUnauthenticated && state.kind === 'unauthenticated') {
    console.log('redirecting to /');
    // Hard navigate to avoid any potential state leakage
    window.location.href = '/';
  }

  return <ChefAuthContext.Provider value={{ state }}>{children}</ChefAuthContext.Provider>;
};
