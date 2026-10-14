import React from 'react';

/** Someone (or some AI) that can be @mentioned in a chat. */
export interface MentionCandidate {
  /** What gets inserted after "@" (no spaces), e.g. "MindAI", "Maya", "AdaLovelace" */
  handle: string;
  label: string;
  detail?: string;
  /** Avatar colour */
  color: string;
  kind: 'ai' | 'persona' | 'user';
  online?: boolean;
  /** Short text shown in the avatar (initials or first letter) */
  badge?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Finds an "@query" being typed right before the caret, if any. */
export const activeMentionQuery = (text: string, caret: number): { query: string; start: number } | null => {
  const before = text.slice(0, caret);
  const match = before.match(/(^|\s)@([\w.-]{0,30})$/);
  if (!match) return null;
  return { query: match[2], start: caret - match[2].length - 1 };
};

/** Handles of everyone mentioned in a message (case-insensitive match against known handles). */
export const mentionedHandles = (text: string, handles: string[]): Set<string> => {
  const found = new Set<string>();
  for (const handle of handles) {
    if (new RegExp(`(^|[^\\w])@${escapeRe(handle)}(?![\\w])`, 'i').test(text)) found.add(handle.toLowerCase());
  }
  return found;
};

interface MentionTextProps {
  text: string;
  candidates: MentionCandidate[];
  /** The viewer's own handle: their mentions are highlighted more strongly */
  myHandle?: string;
  /** Dark bubble (own messages) */
  dark?: boolean;
}

/** Message text with @mentions rendered as coloured pills. */
export const MentionText: React.FC<MentionTextProps> = ({ text, candidates, myHandle, dark }) => {
  if (!candidates.length || !text.includes('@')) return <>{text}</>;
  const byHandle = new Map(candidates.map(c => [c.handle.toLowerCase(), c]));
  const pattern = new RegExp(`@(${candidates.map(c => escapeRe(c.handle)).sort((a, b) => b.length - a.length).join('|')})(?![\\w])`, 'gi');
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    const prev = m.index > 0 ? text[m.index - 1] : ' ';
    if (/\w/.test(prev)) continue; // part of an email address etc.
    const c = byHandle.get(m[1].toLowerCase());
    if (!c) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    const isMe = myHandle && c.handle.toLowerCase() === myHandle.toLowerCase();
    parts.push(
      <span
        key={m.index}
        className={`inline-flex items-center px-1.5 rounded-md font-semibold ${isMe ? 'bg-amber-300 text-amber-950' : dark ? 'bg-white/20 text-white' : ''}`}
        style={!isMe && !dark ? { color: c.color, background: `${c.color}18` } : undefined}
        title={c.detail ? `${c.label} · ${c.detail}` : c.label}
      >
        @{c.handle}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
};

interface MentionMenuProps {
  items: MentionCandidate[];
  active: number;
  onPick: (c: MentionCandidate) => void;
  onHover: (index: number) => void;
}

/** Popup list shown above the composer while typing "@". */
export const MentionMenu: React.FC<MentionMenuProps> = ({ items, active, onPick, onHover }) => (
  <div className="absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-slate-900/15 border border-slate-100 p-1.5 z-40 dialog-panel" role="listbox" aria-label="Mention someone">
    <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Mention</p>
    {items.length === 0 ? (
      <p className="px-3 py-3 text-sm text-slate-400">No one matches.</p>
    ) : (
      <ul className="max-h-64 overflow-y-auto" data-lenis-prevent>
        {items.map((c, i) => (
          <li key={c.handle}>
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); onPick(c); }}
              onMouseEnter={() => onHover(i)}
              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors duration-150 ${i === active ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
            >
              <span className="relative w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: c.color }}>
                {c.badge ?? c.label[0]}
                {c.online !== undefined && (
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${c.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-800 truncate">{c.label}</span>
                <span className="block text-[11px] text-slate-400 truncate">@{c.handle}{c.detail ? ` · ${c.detail}` : ''}</span>
              </span>
              {c.kind !== 'user' && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700">AI</span>}
            </button>
          </li>
        ))}
      </ul>
    )}
    <p className="px-3 pt-1 pb-1 text-[10px] text-slate-400 border-t border-slate-100 mt-1">↑↓ to choose · Enter or Tab to insert · Esc to close</p>
  </div>
);
