
import React, { useState, useEffect, useRef } from 'react';
import { DocumentFile, ChatMessage, Persona, Source } from '../types';
import { Tooltip } from './Tooltip';
import { MarkdownMessage } from './MarkdownMessage';
import { SourceDialog } from './SourceDialog';
import { SpeakButton } from './SpeakButton';
import { LogoMark } from './Logo';
import { ChatComposer } from './chat/ChatComposer';
import { useAuth, initials } from '../auth/AuthContext';
import { Sparkles, Layers, Info, ArrowDown, Copy, Check, ListChecks, Lightbulb, HelpCircle, BookOpenText } from 'lucide-react';
import { chatAPI, studyGroupAPI, getErrorMessage, ChatHistoryItem } from '../services/api';

const PERSONA_KEY = 'mindai.chatPersona';

interface ChatInterfaceProps {
  documents: DocumentFile[];
  initialDocId?: string | null;
  onSelectDoc?: (id: string) => void;
  /** Open a cited passage in the reader */
  onOpenInReader?: (source: Source) => void;
  /** Pre-filled question (e.g. from the concept graph) */
  initialInput?: string | null;
  onInitialInputConsumed?: () => void;
}

// Local-only messages (intro / errors) that must not be sent to the AI as history
const isLocalMessage = (msg: ChatMessage) => msg.id === 'intro' || msg.id.startsWith('error-');

// Distance from the bottom (px) within which we keep auto-scrolling as content grows
const NEAR_BOTTOM_PX = 120;

const STARTERS = [
  { icon: BookOpenText, text: 'Summarise this in 5 bullet points' },
  { icon: ListChecks, text: 'What are the key terms I should know?' },
  { icon: Lightbulb, text: 'Explain the hardest idea simply, with an example' },
  { icon: HelpCircle, text: 'Ask me 3 questions to test my understanding' },
];

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ documents, initialDocId, onSelectDoc, onOpenInReader, initialInput, onInitialInputConsumed }) => {
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

  // Fall back to the first document if the selection is missing or was deleted
  const selectedDocId = rawSelectedId === 'ALL' || documents.some(d => d.id === rawSelectedId)
    ? rawSelectedId
    : (documents[0]?.id || '');
  const selectedDoc = documents.find(d => d.id === selectedDocId);
  const isAllDocs = selectedDocId === 'ALL';
  const selectedTitle = selectedDoc?.title;

  // Load saved chat history whenever the chat context changes
  useEffect(() => {
    // Stop any answer still streaming for the previous context
    abortRef.current?.abort();

    if (!selectedDocId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    const introMessage: ChatMessage = isAllDocs
      ? {
          id: 'intro',
          role: 'model',
          text: `Hello! I'm connected to your Knowledge Base. I have access to ${documents.length} documents. What are we studying today?`,
          timestamp: Date.now()
        }
      : {
          id: 'intro',
          role: 'model',
          text: `Ready to discuss "${selectedTitle}". Ask me for a summary, key points, or specific details!`,
          timestamp: Date.now()
        };

    setMessages([introMessage]);
    setIsHistoryLoading(true);
    isNearBottomRef.current = true;

    const loadHistory = isAllDocs
      ? chatAPI.getKnowledgeBaseHistory()
      : chatAPI.getHistory(selectedDocId);

    loadHistory
      .then(history => {
        if (!cancelled && history.length > 0) {
          setMessages([introMessage, ...history]);
        }
      })
      .catch(error => console.error('Error loading chat history:', error))
      .finally(() => {
        if (!cancelled) setIsHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Only reload when the selected context changes, not on every document list update
  }, [selectedDocId]);

  // A pre-filled question is used once
  useEffect(() => {
    if (initialInput) onInitialInputConsumed?.();
  }, []);

  // Abort an in-flight stream when leaving the chat screen
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSelect = (id: string) => {
    setRawSelectedId(id);
    if (id !== 'ALL') onSelectDoc?.(id);
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
    if (!isAllDocs && !selectedDoc) return;

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

    // Previous conversation (excluding local-only messages) gives the AI context
    const history: ChatHistoryItem[] = messages
      .filter(m => !isLocalMessage(m) && m.text.trim())
      .map(m => ({ role: m.role, text: m.text }));

    const controller = new AbortController();
    abortRef.current = controller;
    isNearBottomRef.current = true;

    setMessages(prev => [...prev, userMsg, replyMsg]);
    setInput('');
    setIsLoading(true);
    setStreamingId(replyId);

    let received = '';
    const onSources = (sources: Source[]) => {
      setMessages(prev => prev.map(m => (m.id === replyId ? { ...m, sources } : m)));
    };
    const onDelta = (piece: string) => {
      received += piece;
      setMessages(prev => prev.map(m => (m.id === replyId ? { ...m, text: m.text + piece } : m)));
    };

    try {
      if (isAllDocs) {
        await chatAPI.streamKnowledgeBase(text, history, { onDelta, onSources, signal: controller.signal }, persona);
      } else {
        await chatAPI.streamDocument(selectedDoc!.id, text, history, { onDelta, onSources, signal: controller.signal }, persona);
      }
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
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsLoading(false);
      setStreamingId(null);
    }
  };

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.05] bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:20px_20px]"></div>
        <div className="relative z-10 bg-white p-10 rounded-[2.5rem] shadow-2xl border border-slate-100 text-center max-w-md mx-4 animate-scale-in">
            <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6 mx-auto animate-float">
                <Sparkles className="w-10 h-10 text-indigo-500" />
            </div>
            <h3 className="text-2xl font-display font-bold text-slate-900 mb-3">It's quiet here...</h3>
            <p className="text-slate-500 leading-relaxed">Upload documents to the Knowledge Base to start chatting with your personal AI tutor.</p>
        </div>
      </div>
    );
  }

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

  const showStarters = !isHistoryLoading && !isLoading && messages.length <= 1;

  return (
    <div className="flex flex-col h-full relative bg-slate-50/60 font-sans overflow-hidden">
      {/* Background: dot grid + drifting colour that follows the chat context */}
      <div className="absolute inset-0 dot-grid opacity-50 pointer-events-none [mask-image:linear-gradient(to_bottom,black,transparent_80%)]"></div>
      <div className={`mesh-blob w-[34rem] h-[34rem] -top-64 left-1/4 transition-colors duration-1000 ${isAllDocs ? 'bg-fuchsia-200/60' : 'bg-indigo-200/60'}`}></div>
      <div className={`mesh-blob w-[26rem] h-[26rem] bottom-0 -right-40 transition-colors duration-1000 ${isAllDocs ? 'bg-purple-200/50' : 'bg-sky-200/50'}`} style={{ animationDelay: '-9s' }}></div>

      {/* Header - Flex Item, relative to stack properly */}
      <div className="z-20 px-4 md:px-6 py-4 bg-white/70 backdrop-blur-xl border-b border-slate-200/50 flex items-center justify-between shadow-sm flex-shrink-0 animate-slide-up">
        <div className="flex items-center gap-4 overflow-hidden">
            <Tooltip content={isAllDocs ? "Connected to all documents" : "Connected to single document"} position="bottom">
                <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg transition-all duration-700 ease-out-expo flex-shrink-0
                    ${isAllDocs ? 'bg-gradient-to-br from-fuchsia-600 to-purple-700 rotate-6' : 'bg-gradient-to-br from-blue-600 to-indigo-700'}`}>
                    {isLoading && <span className="absolute -inset-1 rounded-2xl border-2 border-indigo-400/60 animate-ping"></span>}
                    <span key={isAllDocs ? 'all' : 'one'} className="animate-pop">{isAllDocs ? <Layers className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}</span>
                </div>
            </Tooltip>
            <div className="min-w-0">
                <h2 key={selectedDocId} className="text-lg font-bold text-slate-800 leading-tight truncate animate-slide-in-right">
                    {isAllDocs ? "Knowledge Base" : selectedDoc?.title || "Document Chat"}
                </h2>
                <div className="flex items-center gap-2">
                  <span className={`flex w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{isLoading ? "AI Thinking..." : isHistoryLoading ? "Loading history..." : "Active"}</p>
                </div>
            </div>
        </div>

        {/* Context Selector */}
        <Tooltip content="Switch document context" position="left">
            <div className="flex items-center relative ml-2">
                <div className="absolute inset-y-0 left-2 md:left-3 flex items-center pointer-events-none">
                    <Info className="h-4 w-4 text-slate-400" />
                </div>
                <select
                    value={selectedDocId}
                    onChange={(e) => handleSelect(e.target.value)}
                    className="w-32 md:w-auto pl-8 md:pl-10 pr-4 md:pr-8 py-2 bg-slate-100/50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all hover:bg-white cursor-pointer appearance-none truncate"
                >
                    <option value="ALL">All Docs</option>
                    {documents.map(doc => (
                    <option key={doc.id} value={doc.id}>{doc.title}</option>
                    ))}
                </select>
            </div>
        </Tooltip>
      </div>

      {/* Messages Area - Flex grow with scroll */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto p-4 md:p-8 pb-56 space-y-6"
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
                        <span className="truncate">{[isAllDocs ? source.document_title : '', source.location].filter(Boolean).join(' · ') || 'Passage'}</span>
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
                        className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 opacity-60 group-hover:opacity-100 transition-all"
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
      <div className="absolute bottom-0 left-0 right-0 px-4 md:px-6 pb-3 pt-8 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent z-20 pointer-events-none">
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
            accent={isAllDocs ? 'fuchsia' : 'indigo'}
            focusKey={focusKey || undefined}
            placeholder={personaOf(persona)
              ? `Ask ${personaOf(persona)!.name} (${personaOf(persona)!.role.toLowerCase()})…`
              : isAllDocs ? 'Ask your whole knowledge base…' : `Ask about ${selectedDoc?.title ?? 'this document'}…`}
            above={personas.length > 0 ? (
              <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
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

      {openSource && (
        <SourceDialog
          source={openSource}
          onClose={() => setOpenSource(null)}
          onOpenInReader={onOpenInReader ? (source) => { setOpenSource(null); onOpenInReader(source); } : undefined}
        />
      )}
    </div>
  );
};
