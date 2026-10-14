import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthResult, authAPI, User } from '../services/api';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { getCachedUser, getToken, onUnauthorized, restoreNativeSession, setCachedUser, setToken } from '../services/authToken';

interface AuthContextValue {
  user: User | null;
  /** True while an existing session is being restored on page load */
  isRestoring: boolean;
  /** Set after the first sign-up moved pre-existing study data into the new account */
  claimedDocuments: number;
  /** Resolve to `{ verifyEmail }` when the address must be confirmed with an emailed code first */
  login: (email: string, password: string) => Promise<AuthOutcome>;
  signup: (name: string, email: string, password: string) => Promise<AuthOutcome>;
  /** Finish signing in with a result that carries a token (code verified, password reset, Google) */
  completeAuth: (result: AuthResult) => void;
  logout: () => void;
  updateUser: (user: User) => void;
  dismissClaimNotice: () => void;
  /** Shown on the sign-in screen after an expired session */
  sessionExpired: boolean;
}

export type AuthOutcome = { verifyEmail: string | null };

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isRestoring, setIsRestoring] = useState(() => !!getToken() || Capacitor.isNativePlatform());
  const [claimedDocuments, setClaimedDocuments] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Restore the saved session. Only the server saying the token is invalid (401) signs the user out:
  // when it can't be reached (no internet, server restarting) the app opens with the remembered account.
  useEffect(() => {
    (async () => {
      await restoreNativeSession();
      if (!getToken()) return;
      try {
        const me = await authAPI.me();
        setUser(me);
        setCachedUser(me);
        // Keep the session alive: every visit gets a fresh token with a full lifetime
        authAPI.refresh().then(result => { if (result.token) setToken(result.token); }).catch(() => {});
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status === 401) {
          setToken(null);
        } else {
          const cached = getCachedUser<User>();
          if (cached) setUser(cached);
        }
      }
    })().finally(() => setIsRestoring(false));
  }, []);

  // Any 401 from the API (expired token) returns to the sign-in screen
  useEffect(() => onUnauthorized(() => {
    setUser(current => {
      if (current) setSessionExpired(true);
      return null;
    });
  }), []);

  const completeAuth = useCallback((result: AuthResult) => {
    if (!result.token || !result.user) return;
    setToken(result.token);
    setSessionExpired(false);
    setClaimedDocuments(result.claimed_documents || 0);
    setUser(result.user);
    setCachedUser(result.user);
  }, []);

  const finish = useCallback((result: AuthResult): AuthOutcome => {
    if (result.verification_required || !result.token) return { verifyEmail: result.email || null };
    completeAuth(result);
    return { verifyEmail: null };
  }, [completeAuth]);

  const login = useCallback(async (email: string, password: string) => finish(await authAPI.login(email, password)), [finish]);

  const signup = useCallback(async (name: string, email: string, password: string) =>
    finish(await authAPI.signup(name, email, password)), [finish]);

  const logout = useCallback(() => {
    setToken(null);
    setClaimedDocuments(0);
    setSessionExpired(false);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isRestoring,
    claimedDocuments,
    login,
    signup,
    completeAuth,
    logout,
    updateUser: (next: User) => { setUser(next); setCachedUser(next); },
    dismissClaimNotice: () => setClaimedDocuments(0),
    sessionExpired,
  }), [user, isRestoring, claimedDocuments, login, signup, completeAuth, logout, sessionExpired]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
};

/** Initials for an avatar, e.g. "Olivia Owen" -> "OO" */
export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || '?';
