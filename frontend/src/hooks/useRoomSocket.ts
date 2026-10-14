import { useCallback, useEffect, useRef, useState } from 'react';
import { roomsAPI } from '../services/api';
import { getToken, notifyUnauthorized, setToken } from '../services/authToken';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

// Server close codes
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_NOT_MEMBER = 4403;

/**
 * Live connection to a study room. Reconnects with backoff after network drops,
 * but not when the server says the user signed out or is no longer a member.
 */
export const useRoomSocket = (
  roomId: string,
  onEvent: (event: any) => void,
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

    const connect = () => {
      const token = getToken();
      if (!token) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      const ws = new WebSocket(roomsAPI.socketUrl(roomId, token));
      socketRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus('open');
      };
      ws.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data);
          if (event.type === 'removed') handlers.current.onRemoved(event.reason || 'You are no longer in this room.');
          else handlers.current.onEvent(event);
        } catch {
          // Ignore malformed events
        }
      };
      ws.onclose = (close) => {
        if (socketRef.current === ws) socketRef.current = null;
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

    connect();
    return () => {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
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
