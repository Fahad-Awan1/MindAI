import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FolderInput, FolderMinus, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Search, SquarePen, Trash2, X } from 'lucide-react';
import { ConversationSummary, Project } from '../../types';
import { conversationsAPI, getErrorMessage } from '../../services/api';
import { useBackHandler } from '../../hooks/useBackHandler';
import { projectColor } from '../projects/colors';

interface ChatHistoryProps {
  items: ConversationSummary[];
  loading: boolean;
  activeId: string | null;
  projects: Project[];
  onOpen: (chat: ConversationSummary) => void;
  onNew: () => void;
  onRename: (chat: ConversationSummary, title: string) => Promise<void>;
  onTogglePin: (chat: ConversationSummary) => void;
  onMove: (chat: ConversationSummary, projectId: string | null) => void;
  onDelete: (chat: ConversationSummary) => void;
  /** Phone drawer: a close button in the header */
  onClose?: () => void;
}

const DAY = 24 * 60 * 60 * 1000;

/** "Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", then month names */
const groupChats = (chats: ConversationSummary[]) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const groups: { label: string; chats: ConversationSummary[] }[] = [];
  const add = (label: string, chat: ConversationSummary) => {
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.chats.push(chat);
    else groups.push({ label, chats: [chat] });
  };
  chats.filter(c => c.pinned).forEach(c => add('Pinned', c));
  chats.filter(c => !c.pinned).sort((a, b) => b.updated_at - a.updated_at).forEach(c => {
    const t = c.updated_at;
    if (t >= today) add('Today', c);
    else if (t >= today - DAY) add('Yesterday', c);
    else if (t >= today - 7 * DAY) add('Previous 7 days', c);
    else if (t >= today - 30 * DAY) add('Previous 30 days', c);
    else add(new Date(t).toLocaleDateString([], { month: 'long', year: 'numeric' }), c);
  });
  return groups;
};

const contextLabel = (chat: ConversationSummary) =>
  chat.project_name ? chat.project_name : chat.scope === 'all' ? 'All documents' : chat.document_title || 'Document';

export const ChatHistory: React.FC<ChatHistoryProps> = ({ items, loading, activeId, projects, onOpen, onNew, onRename, onTogglePin, onMove, onDelete, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConversationSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Search titles and messages on the server (debounced)
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setSearchError(null); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      conversationsAPI.list({ q, limit: 50 })
        .then(found => { setResults(found); setSearchError(null); })
        .catch(err => setSearchError(getErrorMessage(err, 'Search failed.')))
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  // A chat renamed / pinned / moved while search results are shown: show the new details there too
  useEffect(() => {
    setResults(prev => prev && prev.map(r => {
      const fresh = items.find(i => i.id === r.id);
      return fresh ? { ...fresh, snippet: r.snippet } : r;
    }));
  }, [items]);
  const deleteChat = (chat: ConversationSummary) => {
    setResults(prev => prev && prev.filter(r => r.id !== chat.id));
    onDelete(chat);
  };

  const closeMenu = () => { setMenuFor(null); setMoving(false); setConfirmDelete(null); };
  useBackHandler(closeMenu, menuFor !== null);
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) closeMenu(); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuFor]);

  const groups = useMemo(() => groupChats(items), [items]);

  const saveRename = async () => {
    if (!renaming) return;
    const chat = items.find(c => c.id === renaming.id) ?? results?.find(c => c.id === renaming.id);
    const title = renaming.title.trim();
    setRenaming(null);
    if (chat && title && title !== chat.title) await onRename(chat, title);
  };

  const renderChat = (chat: ConversationSummary) => {
    const active = chat.id === activeId;
    const menuOpen = menuFor === chat.id;
    if (renaming?.id === chat.id) {
      return (
        <form key={chat.id} onSubmit={e => { e.preventDefault(); saveRename(); }} className="flex items-center gap-1 px-2 py-1.5">
          <input autoFocus value={renaming.title} maxLength={80} aria-label="Chat name"
            onChange={e => setRenaming({ ...renaming, title: e.target.value })}
            onBlur={saveRename}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }}
            className="flex-1 min-w-0 rounded-lg border-indigo-300 text-sm py-1.5 focus:ring-indigo-500/30" />
          <button type="submit" className="p-2 rounded-lg text-indigo-600 hover:bg-indigo-50" aria-label="Save name"><Check className="w-4 h-4" /></button>
        </form>
      );
    }
    return (
      <div key={chat.id} className={`group/chat relative flex items-center rounded-xl transition-colors ${active ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-slate-100 text-slate-700'}`}>
        <button type="button" onClick={() => onOpen(chat)} aria-current={active ? 'true' : undefined}
          className="flex-1 min-w-0 text-left pl-3 pr-1 py-2.5">
          <span className="flex items-center gap-1.5">
            {chat.pinned && <Pin className="w-3 h-3 flex-shrink-0 text-amber-500" aria-label="Pinned" />}
            <span className="block truncate text-sm font-medium">{chat.title}</span>
          </span>
          <span className="block truncate text-[11px] text-slate-400 mt-0.5">
            {chat.snippet ? chat.snippet : contextLabel(chat)}
          </span>
        </button>
        <button type="button" onClick={() => (menuOpen ? closeMenu() : (closeMenu(), setMenuFor(chat.id)))}
          aria-label={`Options for ${chat.title}`} aria-expanded={menuOpen} aria-haspopup="menu"
          className={`p-2 mr-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-opacity ${menuOpen || active ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover/chat:opacity-100 focus:opacity-100'}`}>
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div ref={menuRef} role="menu" className="absolute right-1 top-full mt-1 z-40 w-56 rounded-xl bg-white border border-slate-200 shadow-xl p-1 animate-scale-in origin-top-right">
            {confirmDelete === chat.id ? (
              <div className="p-2">
                <p className="text-sm font-semibold text-slate-800">Delete this chat?</p>
                <p className="text-xs text-slate-500 mt-0.5 mb-3">"{chat.title}" and its messages will be gone for good.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={closeMenu} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600">Cancel</button>
                  <button type="button" onClick={() => { closeMenu(); deleteChat(chat); }} className="flex-1 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold">Delete</button>
                </div>
              </div>
            ) : moving ? (
              <div className="max-h-72 overflow-y-auto">
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Move to project</p>
                {projects.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No projects yet. Create one under Projects.</p>}
                {projects.map(p => (
                  <button key={p.id} type="button" role="menuitem" disabled={p.id === chat.project_id}
                    onClick={() => { closeMenu(); onMove(chat, p.id); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40">
                    <span className={`w-2.5 h-2.5 rounded-full ${projectColor(p.color).dot}`} /> <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <button type="button" role="menuitem" onClick={() => { closeMenu(); setRenaming({ id: chat.id, title: chat.title }); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100"><Pencil className="w-4 h-4" /> Rename</button>
                <button type="button" role="menuitem" onClick={() => { closeMenu(); onTogglePin(chat); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100">
                  {chat.pinned ? <><PinOff className="w-4 h-4" /> Unpin</> : <><Pin className="w-4 h-4" /> Pin</>}
                </button>
                <button type="button" role="menuitem" onClick={() => setMoving(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100"><FolderInput className="w-4 h-4" /> Move to project</button>
                {chat.project_id && (
                  <button type="button" role="menuitem" onClick={() => { closeMenu(); onMove(chat, null); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100"><FolderMinus className="w-4 h-4" /> Remove from project</button>
                )}
                <button type="button" role="menuitem" onClick={() => setConfirmDelete(chat.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-rose-600 hover:bg-rose-50"><Trash2 className="w-4 h-4" /> Delete</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 p-3 pb-2">
        <button type="button" onClick={onNew}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold shadow-sm hover:bg-slate-800 transition-colors">
          <SquarePen className="w-4 h-4" /> New chat
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="p-2.5 rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Close chat history"><X className="w-5 h-5" /></button>
        )}
      </div>
      <div className="px-3 pb-2">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats"
            type="search" className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-100 border-transparent text-sm focus:bg-white focus:border-indigo-300 focus:ring-indigo-500/20" />
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-24 md:pb-4" data-lenis-prevent>
        {query.trim() ? (
          searching && !results ? (
            <p className="flex items-center gap-2 px-3 py-4 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Searching…</p>
          ) : searchError ? (
            <p className="px-3 py-4 text-sm text-rose-600">{searchError}</p>
          ) : results && results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">No chats match "{query.trim()}".</p>
          ) : (
            <div className="space-y-0.5">{results?.map(renderChat)}</div>
          )
        ) : loading && items.length === 0 ? (
          <p className="flex items-center gap-2 px-3 py-4 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading chats…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-sm text-slate-500 leading-relaxed">Your chats will appear here. Ask anything to start one.</p>
        ) : (
          groups.map(group => (
            <section key={group.label} className="mb-3">
              <h3 className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{group.label}</h3>
              <div className="space-y-0.5">{group.chats.map(renderChat)}</div>
            </section>
          ))
        )}
      </div>
    </div>
  );
};
