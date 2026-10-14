import { useState } from 'react';
import { DocumentFile } from '../types';

/**
 * Track the selected document for a generator screen.
 *
 * Falls back to the first document whenever the stored selection is empty or
 * no longer exists (e.g. documents loaded after mount, or the selected one was deleted).
 */
export const useSelectedDocument = (documents: DocumentFile[], initialId?: string | null) => {
  const [selectedId, setSelectedId] = useState<string>(initialId || documents[0]?.id || '');
  const effectiveId = documents.some(d => d.id === selectedId) ? selectedId : (documents[0]?.id || '');
  return [effectiveId, setSelectedId] as const;
};
