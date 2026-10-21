import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DocumentFile, ChatMessage, Persona, Source, ConversationSummary, Project, ChatTarget, ChatScope } from '../types';
import { Tooltip } from './Tooltip';
import { MarkdownMessage } from './MarkdownMessage';
import { SourceDialog } from './SourceDialog';
import { SpeakButton } from './SpeakButton';
import { LogoMark } from './Logo';
import { ChatComposer } from './chat/ChatComposer';
import { ChatHistory } from './chat/ChatHistory';
import { projectColor } from './projects/colors';
import { ProjectForm, ProjectPage } from './projects/ProjectPage';
import { useAuth, initials } from '../auth/AuthContext';
import { useBackHandler } from '../hooks/useBackHandler';
import { Sparkles, Layers, Info, ArrowDown, Copy, Check, ListChecks, Lightbulb, HelpCircle, BookOpenText, FolderOpen, PanelLeft, SquarePen, X } from 'lucide-react';
import { conversationsAPI, projectsAPI, studyGroupAPI, getErrorMessage, SendBody } from '../services/api';
import { cachedChat, cachedChats, cachedProjects, forgetChat, saveChat, saveChats, saveProjects } from '../services/chatCache';

const PERSONA_KEY = 'mindai.chatPersona';
const HISTORY_HIDDEN_KEY = 'mindai.chatHistoryHidden';

interface ChatInterfaceProps {
  documents: DocumentFile[];
  initialDocId?: string | null;
  onSelectDoc?: (id: string) => void;
  /** Open a cited passage in the reader */
  onOpenInReader?: (source: Source) => void;
  /** Pre-filled question (e.g. from the concept graph) */
  initialInput?: string | null;
  onInitialInputConsumed?: () => void;
  /** Open a saved chat, or start one in a project (from the Projects screen) */
  target?: ChatTarget | null;
  onTargetConsumed?: () => void;
  /** Upload a file to the library (from a project page); resolves with the new document */
  onUpload: (file: File) => Promise<DocumentFile | null>;
}

// Local-only messages (intro / errors) that are not part of the saved chat
const isLocalMessage = (msg: ChatMessage) => msg.id === 'intro' || msg.id.startsWith('error-');

// Distance from the bottom (px) within which we keep auto-scrolling as content grows
const NEAR_BOTTOM_PX = 120;

const STARTERS = [
  { icon: BookOpenText, text: 'Summarise this in 5 bullet points' },
  { icon: ListChecks, text: 'What are the key terms I should know?' },
  { icon: Lightbulb, text: 'Explain the hardest idea simply, with an example' },
  { icon: HelpCircle, text: 'Ask me 3 questions to test my understanding' },
];

const readHidden = () => {
  try { return window.localStorage.getItem(HISTORY_HIDDEN_KEY) === '1'; } catch { return false; }
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ documents, initialDocId, onSelectDoc, onOpenInReader, initialInput, onInitialInputConsumed, target, onTargetConsumed, onUpload }) => {
  const { user } = useAuth();
  const [focusKey, setFocusKey] = useState(0);
  // Who answers: MindAI (null) or one of the AI personalities
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [persona, setPersona] = useState<string | null>(() => {
    try { return window.localStorage.getItem(PERSONA_KEY) || null; } catch { return null; }
  });
  useEffect(() => {
    studyGroupAPI.personas().then(setPersonas).catch(() => {});
  }, []);
  const choosePersona = (id: string | null) => {
    setPersona(id);
    try { if (id) window.localStorage.setItem(PERSONA_KEY, id); else window.localStorage.removeItem(PERSONA_KEY); } catch { /* ignore */ }
  };
  const personaOf = (id?: string | null) => personas.find(p => p.id === id);
  const [rawSelectedId, setRawSelectedId] = useState<string>(initialDocId || documents[0]?.id || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(initialInput ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [stoppedIds, setStoppedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Cited passage shown in the source dialog
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isNearBottomRef = useRef(true);

  // --- Chat history ---------------------------------------------------------------------------------
  // The open chat (null = a new chat, saved when the first message is sent)
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  // A new chat started inside a project
  const [newChatProjectId, setNewChatProjectId] = useState<string | null>(null);
  // Shown instantly from the last visit, then refreshed from the server
  const [chats, setChats] = useState<ConversationSummary[]>(() => (user ? cachedChats(user.id) ?? [] : []));
  const [chatsLoading, setChatsLoading] = useState(() => !(user && cachedChats(user.id)));
  const [projects, setProjects] = useState<Project[]>(() => (user ? cachedProjects(user.id) ?? [] : []));
  const [notice, setNotice] = useState<string | null>(null);
  // Projects live in the chat, like ChatGPT / Claude: a project's page opens in place of the conversation
  const [projectPageId, setProjectPageId] = useState<string | null>(null);
  // A just-created project: its page is complete without waiting for the server
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  // First message to send in a new project chat (handed over from the Projects screen)
  const pendingSendRef = useRef<string | null>(null);
  // Phone: the history slides in as a drawer. Desktop: a column that can be hidden.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHidden, setHistoryHidden] = useState(readHidden);
  useBackHandler(() => setHistoryOpen(false), historyOpen);

  const toggleHistory = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setHistoryHidden(hidden => {
        try { window.localStorage.setItem(HISTORY_HIDDEN_KEY, hidden ? '0' : '1'); } catch { /* ignore */ }
        return !hidden;
      });
    } else {
      setHistoryOpen(open => !open);
    }
  };

  const loadChats = useCallback(() => {
    conversationsAPI.list({ limit: 200 })
      .then(setChats)
      .catch(err => setNotice(`Couldn't load your chats: ${getErrorMessage(err, 'please try again.')}`))
      .finally(() => setChatsLoading(false));
  }, []);
  const loadProjects = useCallback(() => {
    projectsAPI.list().then(setProjects).catch(() => {});
  }, []);
  useEffect(() => {
    loadChats();
    loadProjects();
  }, [loadChats, loadProjects]);
  // Remember the lists for the next visit
  useEffect(() => { if (user && !chatsLoading) saveChats(user.id, chats); }, [chats, chatsLoading, user]);
  useEffect(() => { if (user) saveProjects(user.id, projects); }, [projects, user]);

  const openProject = (id: string) => {
    setJustCreated(null);
    setProjectPageId(id);
    setHistoryOpen(false);
    setNotice(null);
  };

  /** Add a chat to the list or update it in place (and keep the newest first) */
  const upsertChat = (chat: Partial<ConversationSummary> & { id: string }) => {
    setChats(prev => {
      const existing = prev.find(c => c.id === chat.id);
      const merged = { ...(existing ?? {}), ...chat } as ConversationSummary;
      return [merged, ...prev.filter(c => c.id !== chat.id)].sort((a, b) => b.updated_at - a.updated_at);
    });
    setConversation(current => (current?.id === chat.id ? { ...current, ...chat } : current));
  };

  // Fall back to the first document if the selection is missing or was deleted
  const selectedDocId = rawSelectedId === 'ALL' || documents.some(d => d.id === rawSelectedId)
    ? rawSelectedId
    : (documents[0]?.id || '');
  const selectedDoc = documents.find(d => d.id === selectedDocId);

  // What the open chat answers from (an existing chat keeps its own context)
  const scope: ChatScope = conversation ? conversation.scope : newChatProjectId ? 'project' : selectedDocId === 'ALL' ? 'all' : 'document';
  const projectId = conversation ? conversation.project_id : newChatProjectId;
  const project = projects.find(p => p.id === projectId) ?? null;
  const projectName = conversation?.project_name ?? project?.name ?? 'Project';
  const chatDocTitle = conversation ? conversation.document_title : selectedDoc?.title;
  const isAllDocs = scope === 'all';
  const isProject = scope === 'project';
  const isNewChat = !conversation;
  const contextLabel = isProject ? projectName : isAllDocs ? 'All documents' : chatDocTitle || 'Document';

  const introFor = (chatScope: ChatScope, label: string): ChatMessage => ({
    id: 'intro',
    role: 'model',
    timestamp: Date.now(),
    text: chatScope === 'project'
      ? `You're in the project **${label}**. I'll answer from its documents and follow its instructions. What do you need?`
      : chatScope === 'all'
        ? `Hello! I'm connected to your Knowledge Base. I have access to ${documents.length} documents. What are we studying today?`
        : `Ready to discuss "${label}". Ask me for a summary, key points, or specific details!`,
  });

  // The chat being opened (a slower, older load must not replace a newer choice)
  const openingRef = useRef<string | null>(null);

  /** Start a fresh chat (about the selected document, all documents, or inside a project) */
  const startNewChat = (inProject: string | null = null, docId: string = selectedDocId) => {
    abortRef.current?.abort();
    openingRef.current = null;
    setConversation(null);
    setNewChatProjectId(inProject);
    setProjectPageId(null);
    setNotice(null);
    setHistoryOpen(false);
    isNearBottomRef.current = true;
    const doc = documents.find(d => d.id === docId);
    const name = inProject ? (projects.find(p => p.id === inProject)?.name ?? 'Project') : doc?.title ?? '';
    setMessages(inProject || docId ? [introFor(inProject ? 'project' : docId === 'ALL' ? 'all' : 'document', name)] : []);
    setFocusKey(k => k + 1);
  };

  /** Open a saved chat and its messages (instantly when it was opened before, then refreshed) */
  const openChat = async (id: string) => {
    abortRef.current?.abort();
    setHistoryOpen(false);
    setProjectPageId(null);
    setNotice(null);
    isNearBottomRef.current = true;
    openingRef.current = id;
    const show = (summary: ConversationSummary, saved: ChatMessage[]) => {
      setConversation(summary);
      setNewChatProjectId(null);
      setMessages(saved);
      if (summary.scope === 'document' && summary.document_id) setRawSelectedId(summary.document_id);
    };
    const cached = cachedChat(id);
    const listed = chats.find(c => c.id === id);
    if (cached) {
      const { messages: saved, ...summary } = cached;
      show(summary, saved);
    } else if (listed) {
      show(listed, []); // Title and context right away; the messages follow
    }
    setIsHistoryLoading(!cached);
    try {
      const detail = await conversationsAPI.get(id);
      saveChat(detail);
      // Still on this chat and not sending in it meanwhile: show the server's copy
      if (openingRef.current === id && !abortRef.current) {
        const { messages: saved, ...summary } = detail;
        show(summary, saved);
      }
    } catch (error) {
      if (openingRef.current === id && !cached) setNotice(`Couldn't open that chat: ${getErrorMessage(error, 'please try again.')}`);
    } finally {
      if (openingRef.current === id) setIsHistoryLoading(false);
    }
  };

  // Keep the open chat's latest messages for an instant reopen
  useEffect(() => {
    if (conversation && !streamingId && !isHistoryLoading) {
      saveChat({ ...conversation, messages: messages.filter(m => !isLocalMessage(m)) });
    }
  }, [messages, conversation, streamingId, isHistoryLoading]);

  // Where to start: a chat or project picked elsewhere, otherwise a new chat about the selected document
  const handledTarget = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    // The parent clears the target once it is used: that must not reset the open chat
    if (handledTarget.current !== undefined && !target) return;
    handledTarget.current = target?.key ?? null;
    if (target?.conversationId) {
      openChat(target.conversationId);
    } else if (target?.projectId) {
      startNewChat(target.projectId);
      if (target.message) pendingSendRef.current = target.message;
    } else {
      startNewChat(null);
    }
    if (target) onTargetConsumed?.();
    // Only when a new target arrives (target.key changes), not on every render
  }, [target?.key]);

  // Projects arrive after the first render: name the intro of a new project chat once they do
  useEffect(() => {
    if (isNewChat && newChatProjectId && project) {
      setMessages(prev => prev.map(m => (m.id === 'intro' ? introFor('project', project.name) : m)));
    }
  }, [project?.name]);

  // A pre-filled question is used once
  useEffect(() => {
    if (initialInput) onInitialInputConsumed?.();
  }, []);

  // Abort an in-flight stream when leaving the chat screen
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSelect = (id: string) => {
    setRawSelectedId(id);
    if (id !== 'ALL') onSelectDoc?.(id);
    // A different document means a different chat
    startNewChat(null, id);
  };

  // --- History actions -------------------------------------------------------------------------------
  const renameChat = async (chat: ConversationSummary, title: string) => {
    try {
      upsertChat(await conversationsAPI.rename(chat.id, title));
    } catch (error) {
      setNotice(`Couldn't rename the chat: ${getErrorMessage(error, 'please try again.')}`);
    }
  };
  const togglePin = async (chat: ConversationSummary) => {
    try {
      upsertChat(await conversationsAPI.setPinned(chat.id, !chat.pinned));
    } catch (error) {
      setNotice(`Couldn't ${chat.pinned ? 'unpin' : 'pin'} the chat: ${getErrorMessage(error, 'please try again.')}`);
    }
  };
  const moveChat = async (chat: ConversationSummary, toProject: string | null) => {
    try {
      upsertChat(await conversationsAPI.move(chat.id, toProject));
      loadProjects();
    } catch (error) {
      setNotice(`Couldn't move the chat: ${getErrorMessage(error, 'please try again.')}`);
    }
  };
  const deleteChat = async (chat: ConversationSummary) => {
    try {
      await conversationsAPI.delete(chat.id);
      forgetChat(chat.id);
      setChats(prev => prev.filter(c => c.id !== chat.id));
      if (conversation?.id === chat.id) startNewChat(null);
    } catch (error) {
      setNotice(`Couldn't delete the chat: ${getErrorMessage(error, 'please try again.')}`);
    }
  };

  // Follow new content only if the user hasn't scrolled up to read earlier messages
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: streamingId ? 'auto' : 'smooth' });
    }
  }, [messages, isLoading, streamingId]);

  const scrollToBottom = () => {
    isNearBottomRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleScroll = () => {
    if (scrollContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        const isBottom = scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_PX;
        isNearBottomRef.current = isBottom;
        setShowScrollButton(!isBottom);
    }
  };

  const handleCopy = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(current => (current === msg.id ? null : current)), 1500);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const sendText = async (raw: string) => {
    const text = raw.trim();
    if (!text || isLoading) return;
    if (scope === 'document' && !conversation && !selectedDoc) return;

    const now = Date.now();
    const userMsg: ChatMessage = {
      id: `local-${now}`,
      role: 'user',
      text,
      timestamp: now
    };
    const replyId = `stream-${now}`;
    const replyMsg: ChatMessage = {
      id: replyId,
      role: 'model',
      text: '',
      timestamp: now + 1,
      persona,
    };

    // The server keeps the chat's earlier messages, so only the new question is sent
    const body: SendBody = conversation
      ? { conversation_id: conversation.id, message: text, persona }
      : { scope, document_id: scope === 'document' ? selectedDoc?.id : null, project_id: newChatProjectId, message: text, persona };

    const controller = new AbortController();
    abortRef.current = controller;
    isNearBottomRef.current = true;

    setNotice(null);
    setMessages(prev => [...prev, userMsg, replyMsg]);
    setInput('');
    setIsLoading(true);
    setStreamingId(replyId);

    let received = '';
    let chatId: string | null = conversation?.id ?? null;
    const onSources = (sources: Source[]) => {
      setMessages(prev => prev.map(m => (m.id === replyId ? { ...m, sources } : m)));
    };
    const onDelta = (piece: string) => {
      received += piece;
      setMessages(prev => prev.map(m => (m.id === replyId ? { ...m, text: m.text + piece } : m)));
    };
    const onConversation = (chat: ConversationSummary) => {
      chatId = chat.id;
      // A new chat exists from here on: it shows up in the history right away
      setConversation(current => current ?? chat);
      setNewChatProjectId(null);
      upsertChat({ ...chat, updated_at: Date.now() });
    };
    const onTitle = (id: string, title: string) => upsertChat({ id, title });

    try {
      await conversationsAPI.send(body, { onDelta, onSources, onConversation, onTitle, signal: controller.signal });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        // Stopped by the user: keep the partial answer (the server saves it too)
        if (received.trim()) {
          setStoppedIds(prev => new Set(prev).add(replyId));
        } else {
          setMessages(prev => prev.filter(m => m.id !== replyId));
        }
      } else {
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'model',
          text: `I encountered a glitch: ${getErrorMessage(error, 'Could you try asking that again?')}`,
          timestamp: Date.now()
        };
        // Keep any partial answer; replace an empty placeholder with the error
        setMessages(prev => received.trim()
          ? [...prev, errorMsg]
          : prev.map(m => (m.id === replyId ? errorMsg : m)));
        // A brand-new chat whose first answer failed is not kept by the server
        if (!received.trim() && chatId && !conversation) {
          setChats(prev => prev.filter(c => c.id !== chatId));
          setConversation(null);
        }
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (chatId && received.trim()) upsertChat({ id: chatId, updated_at: Date.now() });
      setIsLoading(false);
      setStreamingId(null);
    }
  };

  // A first message handed over from the Projects screen is sent as soon as the new project chat is ready
  useEffect(() => {
    const pending = pendingSendRef.current;
    if (pending && isNewChat && newChatProjectId && !isLoading) {
      pendingSendRef.current = null;
      sendText(pending);
    }
  });

  // Documents load after the first render: greet a new chat once its document is known
  useEffect(() => {
    if (isNewChat && !newChatProjectId && !messages.some(m => !isLocalMessage(m)) && selectedDocId) {
      setMessages([introFor(selectedDocId === 'ALL' ? 'all' : 'document', selectedDoc?.title ?? '')]);
    }
  }, [selectedDocId, documents.length]);

  // No documents yet: a chat needs one (or a project, which can work without documents)
  const needsDocuments = documents.length === 0 && isNewChat && !newChatProjectId;

  const renderAvatar = (role: ChatMessage['role'], who?: string | null) => {
    const p = role === 'model' ? personaOf(who) : undefined;
    if (p) {
      return (
        <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-bold shadow-md ring-2 ring-white" style={{ background: p.color }} title={`${p.name} · ${p.role}`}>
          {p.name[0]}
        </span>
      );
    }
    return role === 'user' ? (
      <span
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold shadow-sm ring-2 ring-white"
        style={{ background: user?.avatar_color ?? '#334155' }}
        title="You"
      >
        {initials(user?.name ?? 'You')}
      </span>
    ) : (
      <span className="relative flex-shrink-0" title="MindAI">
        <LogoMark size={36} className="drop-shadow-md" />
      </span>
    );
  };

  const showStarters = !needsDocuments && !isHistoryLoading && !isLoading && !messages.some(m => !isLocalMessage(m));
  const badge = isProject
    ? `bg-gradient-to-br ${projectColor(project?.color).gradient}`
    : isAllDocs ? 'bg-gradient-to-br from-fuchsia-600 to-purple-700 rotate-6' : 'bg-gradient-to-br from-blue-600 to-indigo-700';

  const historyPanel = (onClose?: () => void) => (
    <ChatHistory
      items={chats}
      loading={chatsLoading}
      activeId={projectPageId ? null : conversation?.id ?? null}
      projects={projects}
      onOpen={chat => openChat(chat.id)}
      onNew={() => startNewChat(null)}
      onRename={renameChat}
      onTogglePin={togglePin}
      onMove={moveChat}
      onDelete={deleteChat}
      activeProjectId={projectPageId ?? projectId}
      onOpenProject={openProject}
      onNewProject={() => { setHistoryOpen(false); setCreatingProject(true); }}
      onClose={onClose}
    />
  );

  return (
    <div className="flex h-full font-sans overflow-hidden">
      {/* Chat history: a column on wide screens */}
      {!historyHidden && (
        <aside className="hidden lg:flex flex-col w-72 flex-shrink-0 border-r border-slate-200/70 bg-white/80 backdrop-blur" aria-label="Chat history">
          {historyPanel()}
        </aside>
      )}
      {/* ...and a drawer on phones and tablets */}
      {historyOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={() => setHistoryOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-label="Chat history"
            className="drawer-in relative w-80 max-w-[85vw] h-full bg-white shadow-2xl pt-[env(safe-area-inset-top)]">
            {historyPanel(() => setHistoryOpen(false))}
          </aside>
        </div>
      )}

    <div className="flex flex-col flex-1 min-w-0 h-full relative bg-slate-50/60 overflow-hidden">
      {/* Background: dot grid + drifting colour that follows the chat context */}
      <div className="absolute inset-0 dot-grid opacity-50 pointer-events-none [mask-image:linear-gradient(to_bottom,black,transparent_80%)]"></div>
      <div className={`mesh-blob w-[34rem] h-[34rem] -top-64 left-1/4 transition-colors duration-1000 ${isAllDocs ? 'bg-fuchsia-200/60' : 'bg-indigo-200/60'}`}></div>
      <div className={`mesh-blob w-[26rem] h-[26rem] bottom-0 -right-40 transition-colors duration-1000 ${isAllDocs ? 'bg-purple-200/50' : 'bg-sky-200/50'}`} style={{ animationDelay: '-9s' }}></div>

      {projectPageId ? (
        <>
          <div className="z-20 px-3 md:px-6 py-3 bg-white/70 backdrop-blur-xl border-b border-slate-200/50 flex items-center gap-2 shadow-sm flex-shrink-0">
            <Tooltip content="Chat history" position="bottom">
              <button type="button" onClick={toggleHistory} aria-label="Chat history" aria-expanded={historyOpen}
                className="p-2 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex-shrink-0">
                <PanelLeft className="w-5 h-5" />
              </button>
            </Tooltip>
            <p className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-500">
              <FolderOpen className="inline w-4 h-4 mr-1.5 -mt-0.5" />Projects
            </p>
            <Tooltip content="New chat in this project" position="left">
              <button type="button" onClick={() => startNewChat(projectPageId)} aria-label="New chat in this project"
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex-shrink-0">
                <SquarePen className="w-5 h-5" />
              </button>
            </Tooltip>
          </div>
          <div className="relative z-10 flex-1 overflow-y-auto" data-lenis-prevent>
            <ProjectPage
              key={projectPageId}
              projectId={projectPageId}
              documents={documents}
              onBack={() => setProjectPageId(null)}
              onChanged={() => { loadProjects(); loadChats(); }}
              onDeleted={() => {
                const wasOpen = conversation?.project_id === projectPageId || newChatProjectId === projectPageId;
                setProjectPageId(null);
                loadProjects();
                loadChats();
                if (wasOpen) startNewChat(null);
              }}
              onUpload={onUpload}
              initial={(() => {
                const known = projects.find(p => p.id === projectPageId);
                return known ? { ...known, documents: [], chats: chats.filter(c => c.project_id === projectPageId) } : null;
              })()}
              initialComplete={justCreated === projectPageId}
              onOpenChat={id => openChat(id)}
              onStartChat={(pid, message) => {
                startNewChat(pid);
                if (message) pendingSendRef.current = message;
              }}
            />
          </div>
        </>
      ) : (<>
      {/* Header: history toggle, chat title + what it answers from, context picker / new chat */}
      <div className="z-20 px-3 md:px-6 py-3 md:py-4 bg-white/70 backdrop-blur-xl border-b border-slate-200/50 flex items-center gap-2 md:gap-3 shadow-sm flex-shrink-0 animate-slide-up">
        <Tooltip content="Chat history" position="bottom">
          <button type="button" onClick={toggleHistory} aria-label="Chat history" aria-expanded={historyOpen}
            className="p-2 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex-shrink-0">
            <PanelLeft className="w-5 h-5" />
          </button>
        </Tooltip>
        <div className={`relative hidden sm:flex w-10 h-10 rounded-xl items-center justify-center text-white shadow-lg transition-all duration-700 ease-out-expo flex-shrink-0 ${badge}`}>
          {isLoading && <span className="absolute -inset-1 rounded-2xl border-2 border-indigo-400/60 animate-ping"></span>}
          <span key={scope} className="animate-pop">
            {isProject ? <FolderOpen className="w-5 h-5" /> : isAllDocs ? <Layers className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 key={conversation?.id ?? 'new'} className="text-base md:text-lg font-bold text-slate-800 leading-tight truncate animate-slide-in-right">
            {conversation?.title ?? 'New chat'}
          </h2>
          <div className="flex items-center gap-1.5 min-w-0 text-[11px] font-semibold text-slate-400">
            <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
            {isProject && projectId ? (
              <button type="button" onClick={() => openProject(projectId)} className={`truncate hover:underline ${projectColor(project?.color).text}`}>
                {contextLabel}
              </button>
            ) : (
              <span className="truncate">{contextLabel}</span>
            )}
            {(isLoading || isHistoryLoading) && <span className="flex-shrink-0">· {isLoading ? 'Thinking…' : 'Loading…'}</span>}
          </div>
        </div>

        {/* What a new chat answers from (an existing chat keeps its own) */}
        {isNewChat && !newChatProjectId && documents.length > 0 && (
          <Tooltip content="What this chat answers from" position="left">
            <div className="flex items-center relative flex-shrink-0">
              <div className="absolute inset-y-0 left-2 md:left-3 flex items-center pointer-events-none">
                <Info className="h-4 w-4 text-slate-400" />
              </div>
              <select
                value={selectedDocId}
                onChange={(e) => handleSelect(e.target.value)}
                aria-label="What this chat answers from"
                className="w-32 md:w-auto md:max-w-[16rem] pl-8 md:pl-10 pr-4 md:pr-8 py-2 bg-slate-100/50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all hover:bg-white cursor-pointer appearance-none truncate"
              >
                <option value="ALL">All Docs</option>
                {documents.map(doc => (
                  <option key={doc.id} value={doc.id}>{doc.title}</option>
                ))}
              </select>
            </div>
          </Tooltip>
        )}
        {!isNewChat && (
          <Tooltip content={conversation?.project_id ? 'New chat in this project' : 'New chat'} position="left">
            <button type="button" onClick={() => startNewChat(conversation?.project_id ?? null)} aria-label="New chat"
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 flex-shrink-0">
              <SquarePen className="w-5 h-5" />
            </button>
          </Tooltip>
        )}
      </div>

      {notice && (
        <div role="alert" className="z-20 mx-4 md:mx-6 mt-3 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 animate-fade-in">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="p-1 -m-1 rounded text-rose-400 hover:text-rose-700" aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {needsDocuments && (
        <div className="relative z-10 flex-1 flex items-center justify-center p-4">
          <div className="bg-white p-8 md:p-10 rounded-[2.5rem] shadow-2xl border border-slate-100 text-center max-w-md animate-scale-in">
            <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6 mx-auto animate-float">
              <Sparkles className="w-9 h-9 text-indigo-500" />
            </div>
            <h3 className="text-2xl font-display font-bold text-slate-900 mb-3">It's quiet here...</h3>
            <p className="text-slate-500 leading-relaxed">Upload documents to the Knowledge Base to start chatting with your personal AI tutor, or open a project to chat without them.</p>
          </div>
        </div>
      )}

      {/* Messages Area - Flex grow with scroll */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`relative flex-1 overflow-y-auto p-4 md:p-8 pb-56 space-y-6 ${needsDocuments ? 'hidden' : ''}`}
      >
        {messages.map((msg) => {
          const isStreaming = msg.id === streamingId;

          // Waiting for the first token: show the typing indicator instead of an empty bubble
          if (isStreaming && !msg.text) {
            return (
              <div key={msg.id} className="flex gap-3 md:gap-4 msg-in">
                {renderAvatar('model', msg.persona)}
                <div className="relative overflow-hidden bg-white border border-slate-100 rounded-[1.5rem] rounded-tl-sm px-5 py-4 shadow-sm flex items-center gap-3">
                    <span className="typing-dots text-indigo-400" style={personaOf(msg.persona) ? { color: personaOf(msg.persona)!.color } : undefined}><span></span><span></span><span></span></span>
                    <span className="text-xs font-semibold text-slate-400">{personaOf(msg.persona) ? `${personaOf(msg.persona)!.name} is thinking…` : 'Reading your notes…'}</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-3 md:gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} msg-in`}
            >
              {renderAvatar(msg.role, msg.persona)}

              {/* Bubble */}
              <div className={`max-w-[85%] lg:max-w-[70%] min-w-0 p-4 md:p-5 shadow-md text-sm md:text-[15px] leading-relaxed relative group transition-all duration-300
                ${msg.role === 'user'
                  ? 'bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-[1.5rem] rounded-tr-sm shadow-indigo-950/20'
                  : 'bg-white/95 backdrop-blur text-slate-800 rounded-[1.5rem] rounded-tl-sm border border-slate-100 hover:shadow-lg hover:shadow-indigo-100/60'}`}>
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                ) : (
                  <div className={isStreaming ? 'streaming-cursor' : ''}>
                    {personaOf(msg.persona) && (
                      <p className="text-xs font-bold mb-1.5" style={{ color: personaOf(msg.persona)!.color }}>
                        {personaOf(msg.persona)!.name} <span className="font-normal text-slate-400">· {personaOf(msg.persona)!.role}</span>
                      </p>
                    )}
                    <MarkdownMessage text={msg.text} sources={msg.sources} onCite={setOpenSource} />
                  </div>
                )}
                {msg.role === 'model' && !isStreaming && msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Sources</span>
                    {msg.sources.map(source => (
                      <button
                        key={source.n}
                        type="button"
                        onClick={() => setOpenSource(source)}
                        data-cursor="Source"
                        className="inline-flex items-center gap-1 max-w-[14rem] px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 hover:border-indigo-300 hover:text-indigo-700 hover:-translate-y-0.5 hover:shadow-sm transition-all duration-300"
                      >
                        <span className="font-bold text-indigo-600">{source.n}</span>
                        <span className="truncate">{[scope !== 'document' ? source.document_title : '', source.location].filter(Boolean).join(' · ') || 'Passage'}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className={`flex items-center justify-end gap-3 mt-2 text-[10px] font-medium
                   ${msg.role === 'user' ? 'text-slate-300' : 'text-slate-400'}`}>
                  {stoppedIds.has(msg.id) && (
                    <span className="italic text-amber-500">Stopped</span>
                  )}
                  {msg.role === 'model' && !isStreaming && msg.text && !msg.id.startsWith('error-') && (
                    <SpeakButton text={msg.text} />
                  )}
                  {msg.role === 'model' && !isStreaming && msg.id !== 'intro' && msg.text && (
                    <Tooltip content={copiedId === msg.id ? "Copied!" : "Copy answer"} position="top">
                      <button
                        type="button"
                        onClick={() => handleCopy(msg)}
                        className="p-2 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 opacity-60 group-hover:opacity-100 hover-reveal transition-all"
                        aria-label="Copy answer"
                      >
                        {copiedId === msg.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </Tooltip>
                  )}
                  <span className="opacity-50">
                    {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
            onClick={scrollToBottom}
            className="absolute bottom-36 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 pl-3 pr-3.5 py-2 rounded-full bg-slate-900/90 backdrop-blur text-white text-xs font-bold shadow-xl animate-pop"
            aria-label="Scroll to latest"
        >
            <ArrowDown className="w-3.5 h-3.5" /> Latest
        </button>
      )}

      {/* Floating Input Area */}
      <div className={`absolute bottom-0 left-0 right-0 px-4 md:px-6 pb-3 pt-8 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent z-20 pointer-events-none ${needsDocuments ? 'hidden' : ''}`}>
        <div className="max-w-4xl mx-auto pointer-events-auto">
          {showStarters && (
            <div className="flex sm:grid sm:grid-cols-2 gap-2 mb-3 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 snap-x stagger">
              {STARTERS.map(({ icon: Icon, text }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => { setInput(text); setFocusKey(k => k + 1); }}
                  className="group flex-shrink-0 w-[15rem] sm:w-auto snap-start flex items-center gap-3 text-left px-4 py-3 rounded-2xl bg-white/90 backdrop-blur border border-slate-200/80 shadow-sm hover:shadow-lg hover:border-indigo-200 hover:-translate-y-0.5 transition-all duration-500 ease-out-expo"
                >
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6 ${isAllDocs ? 'bg-fuchsia-50 text-fuchsia-600' : 'bg-indigo-50 text-indigo-600'}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-medium text-slate-700">{text}</span>
                </button>
              ))}
            </div>
          )}
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={text => sendText(text)}
            busy={isLoading}
            onStop={handleStop}
            disabled={isHistoryLoading}
            accent={isAllDocs ? 'fuchsia' : isProject ? 'violet' : 'indigo'}
            focusKey={focusKey || undefined}
            placeholder={personaOf(persona)
              ? `Ask ${personaOf(persona)!.name} (${personaOf(persona)!.role.toLowerCase()})…`
              : isProject ? `Ask anything in ${projectName}…` : isAllDocs ? 'Ask your whole knowledge base…' : `Ask about ${chatDocTitle ?? 'this document'}…`}
            above={personas.length > 0 ? (
              <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar bg-white/85 backdrop-blur-md rounded-full px-2 py-1 -mx-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mr-1 flex-shrink-0">Talk to</span>
                {[{ id: null as string | null, name: 'MindAI', role: 'Tutor', color: '#6366f1', description: 'Clear, cited answers' }, ...personas].map(p => {
                  const on = persona === p.id;
                  return (
                    <button key={p.id ?? 'mindai'} type="button" onClick={() => choosePersona(p.id)} aria-pressed={on}
                      title={p.id ? `${p.role}: ${p.description}` : 'MindAI: clear, cited answers'}
                      className={`flex-shrink-0 flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-xs font-semibold border transition-all duration-300 ${on ? 'text-white border-transparent shadow-md' : 'bg-white/90 text-slate-600 border-slate-200 hover:border-slate-300 hover:-translate-y-0.5'}`}
                      style={on ? { background: p.color } : undefined}>
                      <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: on ? 'rgba(255,255,255,0.25)' : p.color }}>
                        {p.id ? p.name[0] : <Sparkles className="w-3 h-3" />}
                      </span>
                      {p.name}{p.id && <span className={`hidden sm:inline font-normal ${on ? 'text-white/80' : 'text-slate-400'}`}>· {p.role.replace(/^The /, '')}</span>}
                    </button>
                  );
                })}
              </div>
            ) : undefined}
          />
        </div>
      </div>

      </>)}

      {creatingProject && (
        <ProjectForm onCancel={() => setCreatingProject(false)} onSave={async values => {
          const created = await projectsAPI.create(values);
          setCreatingProject(false);
          setProjects(prev => [created, ...prev]);
          openProject(created.id);
          setJustCreated(created.id);
        }} />
      )}

      {openSource && (
        <SourceDialog
          source={openSource}
          onClose={() => setOpenSource(null)}
          onOpenInReader={onOpenInReader ? (source) => { setOpenSource(null); onOpenInReader(source); } : undefined}
        />
      )}
    </div>
    </div>
  );
};
