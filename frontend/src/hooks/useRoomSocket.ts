import { useCallback, useEffect, useRef, useState } from 'react';
import { roomsAPI, ChallengeRow } from '../services/api';
import { LeaderboardRow, RoomMessage, Source, UserBrief } from '../types';
import type { QuizQuestionEvent, QuizRevealEvent } from '../components/QuizBattle';
import { getToken, notifyUnauthorized, setToken } from '../services/authToken';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Everything the server sends on a room socket (see backend/routers/rooms.py and services/room_service.py). */
export type RoomSocketEvent =
  | { type: 'hello'; online: string[] }
  | { type: 'presence'; online: string[] }
  | { type: 'message'; message: RoomMessage }
  | { type: 'typing'; user: UserBrief }
  | { type: 'ai_start'; stream_id: string; sources?: Source[]; persona?: string | null; document?: { id: string; title: string } | null }
  | { type: 'ai_delta'; stream_id: string; text: string }
  | { type: 'ai_done'; stream_id: string; message: RoomMessage }
  | { type: 'room_updated' }
  | { type: 'challenge_update'; challenge_id: string; leaderboard: ChallengeRow[] }
  | { type: 'quiz_preparing'; started_by: UserBrief; count: number }
  | ({ type: 'quiz_question' } & QuizQuestionEvent)
  | { type: 'quiz_answered'; index: number; answered: number }
  | ({ type: 'quiz_reveal' } & QuizRevealEvent)
  | { type: 'quiz_end'; leaderboard: LeaderboardRow[]; message?: RoomMessage }
  | { type: 'quiz_cancelled' }
  | { type: 'quiz_error'; detail: string }
  | { type: 'error'; detail: string };

// Server close codes
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_NOT_MEMBER = 4403;
// Heartbeat: phones switching networks or waking from the background often keep a socket that looks
// open but delivers nothing. A ping with no reply in time means it is dead, so reconnect.
const PING_EVERY_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;

/**
 * Live connection to a study room. Reconnects with backoff after network drops, straight away when the
 * app comes back to the foreground or the network returns, and not at all when the server says the user
 * signed out or is no longer a member.
 */
export const useRoomSocket = (
  roomId: string,
  onEvent: (event: RoomSocketEvent) => void,
  onRemoved: (reason: string) => void
) => {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const handlers = useRef({ onEvent, onRemoved });
  handlers.current = { onEvent, onRemoved };

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retryTimer: number | null = null;
    let pingTimer: number | null = null;
    let pongTimer: number | null = null;

    const clearTimers = () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      if (pongTimer) window.clearTimeout(pongTimer);
      retryTimer = pingTimer = pongTimer = null;
    };

    /** Drop the current socket without triggering the backoff path, and connect again right away. */
    const reconnectNow = () => {
      if (stopped) return;
      const old = socketRef.current;
      socketRef.current = null;
      if (old) {
        old.onclose = null;
        old.onmessage = null;
        old.close();
      }
      clearTimers();
      attempt = 0;
      connect();
    };

    /** Ask the server for a pong; no reply in time means the socket is dead. */
    const ping = (ws: WebSocket) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'ping' }));
      if (pongTimer) window.clearTimeout(pongTimer);
      pongTimer = window.setTimeout(() => { if (socketRef.current === ws) reconnectNow(); }, PONG_TIMEOUT_MS);
    };

    const connect = () => {
      const token = getToken();
      if (!token) {
        setStatus('closed');
        return;
      }
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      const ws = new WebSocket(roomsAPI.socketUrl(roomId, token));
      socketRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
        pingTimer = window.setInterval(() => ping(ws), PING_EVERY_MS);
      };
      ws.onmessage = (message) => {
        // Any message proves the connection is alive
        if (pongTimer) { window.clearTimeout(pongTimer); pongTimer = null; }
        try {
          const event = JSON.parse(message.data) as RoomSocketEvent | { type: 'pong' } | { type: 'removed'; reason?: string };
          if (event.type === 'pong') return;
          if (event.type === 'removed') handlers.current.onRemoved(event.reason || 'You are no longer in this room.');
          else handlers.current.onEvent(event);
        } catch {
          // Ignore malformed events
        }
      };
      ws.onclose = (close) => {
        if (socketRef.current === ws) socketRef.current = null;
        clearTimers();
        if (stopped) return;
        if (close.code === CLOSE_UNAUTHORIZED) {
          setToken(null);
          notifyUnauthorized();
          setStatus('closed');
          return;
        }
        if (close.code === CLOSE_NOT_MEMBER) {
          handlers.current.onRemoved(close.reason || 'You are not a member of this room.');
          setStatus('closed');
          return;
        }
        // Network drop or server restart: try again with backoff (max ~15s)
        attempt += 1;
        setStatus('reconnecting');
        retryTimer = window.setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(attempt, 4)));
      };
    };

    // Back in the foreground, or the network came back: don't wait for the backoff timer or a dead socket
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) reconnectNow();
      else ping(ws);
    };
    const onOnline = () => reconnectNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    connect();
    return () => {
      stopped = true;
      clearTimers();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomId]);

  const send = useCallback((event: Record<string, unknown>) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
      return true;
    }
    return false;
  }, []);

  return { status, send };
};
