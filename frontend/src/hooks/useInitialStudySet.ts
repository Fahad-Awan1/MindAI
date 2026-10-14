import { useEffect, useRef } from 'react';
import { StudySet } from '../types';
import { studySetsAPI, getErrorMessage } from '../services/api';

/**
 * Open a saved study set passed in from elsewhere (e.g. the dashboard's "Recent study sets").
 * Calls `onLoaded` once the set is fetched and `onConsumed` so the caller can clear the request.
 */
export const useInitialStudySet = <T,>(
  initialSetId: string | null | undefined,
  onLoaded: (set: StudySet<T>) => void,
  onError: (message: string) => void,
  onConsumed?: () => void
) => {
  // Keep the latest callbacks without re-triggering the fetch
  const callbacks = useRef({ onLoaded, onError, onConsumed });
  callbacks.current = { onLoaded, onError, onConsumed };

  useEffect(() => {
    if (!initialSetId) return;
    let cancelled = false;
    studySetsAPI.get<T>(initialSetId)
      .then(set => { if (!cancelled) callbacks.current.onLoaded(set); })
      .catch(err => { if (!cancelled) callbacks.current.onError(getErrorMessage(err, 'Failed to open the saved set.')); })
      .finally(() => { if (!cancelled) callbacks.current.onConsumed?.(); });
    return () => { cancelled = true; };
  }, [initialSetId]);
};
