import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { DocumentFile, Persona, RoomDetail, RoomMessage, Source, UserBrief } from '../types';
import { roomsAPI, studyGroupAPI, studySetsAPI, challengesAPI, Challenge, getErrorMessage } from '../services/api';
import { ChallengeModal, Leaderboard } from './quiz/ChallengeModal';
import { useAuth, initials } from '../auth/AuthContext';
import { RoomSocketEvent, useRoomSocket } from '../hooks/useRoomSocket';
import { MarkdownMessage } from './MarkdownMessage';
import { SourceDialog } from './SourceDialog';
import { QuizBattle, QuizState } from './QuizBattle';
import { ChatComposer } from './chat/ChatComposer';
import { MentionCandidate, MentionText, mentionedHandles } from './chat/mentions';
import {
  ArrowLeft, ArrowDown, Bot, Copy, Check, Users, FileText, Plus, X, Swords, Settings, LogOut,
  Trash2, RefreshCw, Pencil, Trophy, WifiOff, Loader2, Reply, AtSign, Sparkles, MessageCircle
} from 'lucide-react';
import { isNative, publicOrigin } from '../services/platform';
import { firstName } from '../services/names';

interface RoomViewProps {
  roomId: string;
  myDocuments: DocumentFile[];
  onBack: () => void;
  onOpenInReader: (source: Source) => void;
}

interface AiStream {
  streamId: string;
  text: string;
  sources: Source[];
  persona: string | null;
}

const TYPING_SHOWN_MS = 3500;
const TYPING_SEND_EVERY_MS = 2500;

const Avatar: React.FC<{ user: UserBrief; size?: string; online?: boolean }> = ({ user, size = 'w-9 h-9 text-xs', online }) => (
  <span className="relative inline-flex flex-shrink-0 self-start">
    <span className={`${size} rounded-full flex items-center justify-center text-white font-bold`} style={{ background: user.avatar_color }}>
      {initials(user.name)}
    </span>
    {online !== undefined && (
      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
    )}
  </span>
);

const AiAvatar: React.FC<{ persona?: Persona }> = ({ persona }) => (
  persona
    ? <span className="w-9 h-9 rounded-full text-white font-bold text-xs flex items-center justify-center flex-shrink-0" style={{ background: persona.color }}>{persona.name[0]}</span>
    : <span className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-primary-600 text-white flex items-center justify-center flex-shrink-0"><Bot className="w-5 h-5" /></span>
);

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayLabel = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

// Consecutive messages from one person within this window are grouped under one header
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const AI_HANDLES = ['mindai', 'maya', 'leo', 'zoe', 'omar'];

/** A short @handle for each member: their first name, or their full name without spaces if that's ambiguous. */
const memberHandles = (members: UserBrief[]): Map<string, string> => {
  const first = (name: string) => firstName(name).replace(/[^\w-]/g, '') || 'user';
  const counts = new Map<string, number>();
  members.forEach(m => counts.set(first(m.name).toLowerCase(), (counts.get(first(m.name).toLowerCase()) ?? 0) + 1));
  const result = new Map<string, string>();
  members.forEach(m => {
    const f = first(m.name);
    const clash = (counts.get(f.toLowerCase()) ?? 0) > 1 || AI_HANDLES.includes(f.toLowerCase());
    result.set(m.id, clash ? (m.name.replace(/[^\w.-]/g, '') || f) : f);
  });
  return result;
};

export const RoomView: React.FC<RoomViewProps> = ({ roomId, myDocuments, onBack, onOpenInReader }) => {
  const { user } = useAuth();
  const me: UserBrief = { id: user!.id, name: user!.name, avatar_color: user!.avatar_color };

  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [aiStream, setAiStream] = useState<AiStream | null>(null);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [input, setInput] = useState('');
  // Who answers the next message: 'mindai', an AI classmate's id, or nobody
  const [askTarget, setAskTarget] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [removedReason, setRemovedReason] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [shareId, setShareId] = useState('');
  const [quizCount, setQuizCount] = useState(5);
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);
  useBackHandler(() => {
    if (showPanel) setShowPanel(false);
    else if (showSettings) setShowSettings(false);
    else onBack();
  });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [challenges, setChallenges] = useState<Record<string, Challenge>>({});
  const [playChallenge, setPlayChallenge] = useState<string | null>(null);
  const [myQuizzes, setMyQuizzes] = useState<{ id: string; title: string }[]>([]);
  const [challengeSet, setChallengeSet] = useState('');
  const [challengeTime, setChallengeTime] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Latest handle lookups for the socket handler (which is memoised)
  const myHandleRef = useRef('');
  const handlesRef = useRef<string[]>([]);
  const nearBottom = useRef(true);
  const lastTypingSent = useRef(0);
  // Opened on localhost: invite links must use this computer's network address instead
  // (in the phone app, links use MindAI's public address instead of the app's own https://localhost)
  const [shareOrigin, setShareOrigin] = useState(publicOrigin() || window.location.origin);

  useEffect(() => {
    if (isNative) return;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
    roomsAPI.networkAddresses()
      .then(addresses => {
        if (addresses[0]) setShareOrigin(`${window.location.protocol}//${addresses[0]}:${window.location.port || 80}`);
      })
      .catch(() => {});
  }, []);

  const isOwner = detail?.my_role === 'owner';
  const myDocIds = useMemo(() => new Set(myDocuments.map(d => d.id)), [myDocuments]);

  const refreshDetail = useCallback(() => {
    roomsAPI.get(roomId).then(setDetail).catch(err => {
      if (err?.response?.status === 404) setRemovedReason('This room is no longer available.');
    });
  }, [roomId]);

  const refreshMessages = useCallback(() => {
    roomsAPI.messages(roomId).then(list => {
      setMessages(list);
      setHasOlder(list.length >= 50);
    }).catch(() => {});
  }, [roomId]);

  useEffect(() => {
    refreshDetail();
    refreshMessages();
  }, [refreshDetail, refreshMessages]);

  useEffect(() => {
    studyGroupAPI.personas().then(setPersonas).catch(() => {});
    studySetsAPI.list({ kind: 'quiz' }).then(list => setMyQuizzes(list.map(s => ({ id: s.id, title: s.title })))).catch(() => {});
  }, []);

  const refreshChallenges = useCallback(() => {
    challengesAPI.list(roomId).then(list => setChallenges(Object.fromEntries(list.map(c => [c.id, c])))).catch(() => {});
  }, [roomId]);

  useEffect(() => { refreshChallenges(); }, [refreshChallenges]);

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(current => (current === text ? null : current)), 5000);
  };

  const addMessage = (message: RoomMessage) =>
    setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message]));

  const handleEvent = useCallback((event: RoomSocketEvent) => {
    switch (event.type) {
      case 'hello':
        setOnline(new Set(event.online));
        // (Re)connected: catch up on anything missed while offline
        refreshMessages();
        refreshDetail();
        break;
      case 'presence':
        setOnline(new Set(event.online));
        break;
      case 'message':
        addMessage(event.message);
        if (event.message.data?.challenge_id) refreshChallenges();
        if (event.message.user && event.message.user.id !== me.id) {
          if (!nearBottom.current) setUnseen(n => n + 1);
          const mine = myHandleRef.current.toLowerCase();
          if (mine && mentionedHandles(event.message.text, handlesRef.current).has(mine)) {
            showToast(`${event.message.user.name} mentioned you`);
          }
        }
        setTyping(prev => {
          const next = { ...prev };
          if (event.message.user) delete next[event.message.user.id];
          return next;
        });
        break;
      case 'typing':
        setTyping(prev => ({ ...prev, [event.user.id]: { name: event.user.name, until: Date.now() + TYPING_SHOWN_MS } }));
        break;
      case 'ai_start':
        setAiStream({ streamId: event.stream_id, text: '', sources: event.sources || [], persona: event.persona ?? null });
        break;
      case 'ai_delta':
        setAiStream(prev => (prev && prev.streamId === event.stream_id ? { ...prev, text: prev.text + event.text } : prev));
        break;
      case 'ai_done':
        setAiStream(prev => (prev && prev.streamId === event.stream_id ? null : prev));
        addMessage(event.message);
        break;
      case 'room_updated':
        refreshDetail();
        break;
      case 'challenge_update':
        setChallenges(prev => prev[event.challenge_id] ? { ...prev, [event.challenge_id]: { ...prev[event.challenge_id], leaderboard: event.leaderboard } } : prev);
        break;
      case 'quiz_preparing':
        setQuiz({ phase: 'preparing', startedBy: event.started_by, count: event.count });
        break;
      case 'quiz_question':
        setQuiz(prev => ({
          phase: 'question',
          question: event,
          receivedAt: Date.now(),
          myAnswer: prev && prev.phase === 'question' && prev.question.index === event.index ? prev.myAnswer : null,
          answered: event.answered,
        }));
        break;
      case 'quiz_answered':
        setQuiz(prev => (prev && prev.phase === 'question' && prev.question.index === event.index ? { ...prev, answered: event.answered } : prev));
        break;
      case 'quiz_reveal':
        setQuiz(prev => {
          const question = prev && (prev.phase === 'question' || prev.phase === 'reveal') ? prev.question : null;
          if (!question) return prev;
          const mine = event.results[me.id];
          return { phase: 'reveal', question, reveal: event, myAnswer: mine ? mine.option : (prev && prev.phase === 'question' ? prev.myAnswer : null) };
        });
        break;
      case 'quiz_end':
        setQuiz({ phase: 'end', leaderboard: event.leaderboard });
        if (event.message) addMessage(event.message);
        refreshDetail();
        break;
      case 'quiz_cancelled':
        setQuiz(null);
        showToast('The quiz battle was cancelled.');
        refreshDetail();
        break;
      case 'quiz_error':
        setQuiz(prev => (prev && prev.phase === 'preparing' ? null : prev));
        showToast(event.detail);
        break;
      case 'error':
        showToast(event.detail);
        break;
    }
  }, [refreshDetail, refreshMessages, refreshChallenges, me.id]);

  const { status, send } = useRoomSocket(roomId, handleEvent, reason => setRemovedReason(reason));

  // Expire stale typing indicators
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTyping(prev => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Follow new messages when already at the bottom
  useEffect(() => {
    if (nearBottom.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, aiStream?.text]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setShowJump(!nearBottom.current);
    if (nearBottom.current) setUnseen(0);
  };

  const jumpToLatest = () => {
    nearBottom.current = true;
    setUnseen(0);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  const loadOlder = async () => {
    if (!messages.length) return;
    setLoadingOlder(true);
    try {
      const older = await roomsAPI.messages(roomId, messages[0].created_at);
      setHasOlder(older.length >= 50);
      setMessages(prev => [...older.filter(o => !prev.some(p => p.id === o.id)), ...prev]);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSend = (text: string) => {
    if (!text) return;
    const persona = askTarget && askTarget !== 'mindai' ? askTarget : undefined;
    if (!send({ type: 'message', text, ask_ai: askTarget === 'mindai', persona })) {
      showToast('Reconnecting... your message was not sent.');
      return;
    }
    nearBottom.current = true;
    setInput('');
    setAskTarget(null);
  };

  const handleInput = (value: string) => {
    setInput(value);
    if (value && Date.now() - lastTypingSent.current > TYPING_SEND_EVERY_MS) {
      lastTypingSent.current = Date.now();
      send({ type: 'typing' });
    }
  };

  const copyInvite = async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(roomsAPI.inviteLink(detail.invite_code, shareOrigin));
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      showToast(`Invite link: ${roomsAPI.inviteLink(detail.invite_code, shareOrigin)}`);
    }
  };

  const runAction = async (action: () => Promise<unknown>, fallback: string) => {
    try {
      await action();
    } catch (err) {
      showToast(getErrorMessage(err, fallback));
    }
  };

  const shareDocument = () => shareId && runAction(async () => {
    setDetail(await roomsAPI.shareDocument(roomId, shareId));
    setShareId('');
  }, 'Could not share the document.');

  if (removedReason) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Users className="w-12 h-12 text-slate-300 mb-4" />
        <p className="text-lg font-semibold text-slate-700">{removedReason}</p>
        <button onClick={onBack} className="mt-4 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-bold">Back to rooms</button>
      </div>
    );
  }

  const typingNames = Object.entries(typing).filter(([id]) => id !== me.id).map(([, v]) => v.name);
  const unsharedDocs = myDocuments.filter(d => !detail?.documents.some(s => s.document_id === d.id));
  const members = (detail?.members ?? []).map(m => ({ ...m, online: online.has(m.id) }));
  const onlineCount = members.filter(m => m.online).length;

  // Everyone who can be @mentioned: the AI moderator, the AI classmates and the room's members
  const handles = memberHandles(detail?.members ?? []);
  const myHandle = handles.get(me.id) ?? '';
  const mentionCandidates: MentionCandidate[] = [
    { handle: 'MindAI', label: 'MindAI', detail: 'Moderator · answers from shared docs', color: '#6366f1', kind: 'ai', badge: 'AI' },
    ...personas.map(p => ({ handle: p.name, label: p.name, detail: p.role, color: p.color, kind: 'persona' as const })),
    ...members
      .filter(m => m.id !== me.id)
      .sort((a, b) => Number(b.online) - Number(a.online))
      .map(m => ({ handle: handles.get(m.id) ?? m.name, label: m.name, detail: m.online ? 'Online' : 'Offline', color: m.avatar_color, kind: 'user' as const, online: m.online, badge: initials(m.name) })),
  ];
  const allCandidates = myHandle
    ? [...mentionCandidates, { handle: myHandle, label: me.name, color: me.avatar_color, kind: 'user' as const }]
    : mentionCandidates;
  myHandleRef.current = myHandle;
  handlesRef.current = allCandidates.map(c => c.handle);

  const mentionsMe = (text: string) => !!myHandle && mentionedHandles(text, [myHandle]).size > 0;

  const replyTo = (handle: string) => {
    setInput(prev => `${prev.trim() ? `${prev.trimEnd()} ` : ''}@${handle} `);
    setFocusKey(k => k + 1);
  };

  const copyText = async (m: RoomMessage) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopiedId(m.id);
      window.setTimeout(() => setCopiedId(current => (current === m.id ? null : current)), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const messageActions = (m: RoomMessage, handle: string | null, mine: boolean) => (
    <div onClick={e => e.stopPropagation()} className={`absolute -top-3 ${mine ? 'left-2' : 'right-2'} flex items-center gap-0.5 p-0.5 rounded-lg bg-white border border-slate-200 shadow-md ${activeMsgId === m.id ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'} group-hover/msg:opacity-100 group-hover/msg:translate-y-0 transition-all duration-300 ease-out-expo z-10`}>
      {handle && (
        <button onClick={() => { replyTo(handle); setActiveMsgId(null); }} className="p-2 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" aria-label={`Reply to ${handle}`} title={`Reply to @${handle}`}>
          <Reply className="w-3.5 h-3.5" />
        </button>
      )}
      <button onClick={() => copyText(m)} className="p-2 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" aria-label="Copy message" title="Copy">
        {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  const renderMessage = (m: RoomMessage, index: number) => {
    const prev = index > 0 ? messages[index - 1] : null;
    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
    const divider = newDay && (
      <div key={`day-${m.id}`} className="flex items-center gap-3 py-2">
        <span className="flex-1 h-px bg-gradient-to-r from-transparent to-slate-200" />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-slate-400">{dayLabel(m.created_at)}</span>
        <span className="flex-1 h-px bg-gradient-to-l from-transparent to-slate-200" />
      </div>
    );
    return (
      <React.Fragment key={m.id}>
        {divider}
        {renderBody(m, !newDay && !!prev && prev.kind === 'user' && m.kind === 'user' && prev.user?.id === m.user?.id && m.created_at - prev.created_at < GROUP_WINDOW_MS)}
      </React.Fragment>
    );
  };

  const renderBody = (m: RoomMessage, continued: boolean) => {
    if (m.kind === 'system') {
      return (
        <div className="flex justify-center msg-in">
          <span className="text-xs text-slate-500 bg-white/80 backdrop-blur border border-slate-100 rounded-full px-3.5 py-1 shadow-sm">{m.text}</span>
        </div>
      );
    }
    if (m.kind === 'quiz' && m.data?.challenge_id) {
      const c = challenges[m.data.challenge_id];
      return (
        <div className="flex justify-center msg-in">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-md flex-shrink-0"><Trophy className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Quiz challenge</p>
                <p className="font-bold text-slate-900 truncate">{m.data.title || 'Quiz'}</p>
                <p className="text-xs text-slate-500">{m.data.questions} questions · {m.text.split(' posted')[0]}</p>
              </div>
              <button onClick={() => setPlayChallenge(m.data!.challenge_id!)} className="btn-shine px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold shadow-md">
                {c?.my_attempts ? 'Play again' : 'Play'}
              </button>
            </div>
            {c && c.leaderboard.length > 0 && <div className="mt-3"><Leaderboard rows={c.leaderboard} meId={me.id} limit={3} /></div>}
          </div>
        </div>
      );
    }
    if (m.kind === 'quiz') {
      const board = m.data?.leaderboard ?? [];
      return (
        <div className="flex justify-center msg-in">
          <div className="w-full max-w-md bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-2xl p-4 shadow-sm">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-800 mb-2"><Trophy className="w-4 h-4" /> {m.text}</p>
            <ol className="space-y-1">
              {board.slice(0, 3).map((row, i) => (
                <li key={row.user.id} className="flex items-center gap-2 text-sm">
                  <span className="w-4 font-bold text-amber-500">{i + 1}</span>
                  <span className="flex-1 truncate text-slate-700">{row.user.name}</span>
                  <span className="font-bold tabular-nums text-slate-900">{row.score}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      );
    }
    if (m.kind === 'ai') {
      const persona = personas.find(p => p.id === m.data?.persona);
      const color = persona?.color ?? '#6366f1';
      return (
        <div className="flex gap-3 msg-in pt-1">
          <AiAvatar persona={persona} />
          <div className="min-w-0 max-w-[85%] relative group/msg">
            {messageActions(m, persona?.name ?? 'MindAI', false)}
            <p className="text-xs font-bold mb-1 flex items-center gap-1.5" style={{ color }}>
              {persona ? `${persona.name} · ${persona.role}` : 'MindAI'}
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded bg-violet-100 text-violet-700">AI</span>
              <span className="font-normal text-slate-400">{time(m.created_at)}</span>
            </p>
            <div className="bg-white/95 backdrop-blur border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm hover:shadow-md transition-shadow duration-300" style={{ borderLeft: `3px solid ${color}` }}>
              <MarkdownMessage text={m.text} sources={m.sources} onCite={setOpenSource} />
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1.5">
                  {m.sources.map(s => (
                    <button key={s.n} onClick={() => setOpenSource(s)} data-cursor="Source" className="inline-flex items-center gap-1 max-w-[14rem] px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 hover:border-indigo-300 hover:-translate-y-0.5 transition-all duration-300">
                      <span className="font-bold text-indigo-600">{s.n}</span>
                      <span className="truncate">{[s.document_title, s.location].filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    const mine = m.user?.id === me.id;
    const forMe = !mine && mentionsMe(m.text);
    const handle = m.user ? handles.get(m.user.id) ?? null : null;
    return (
      <div className={`msg-in flex gap-3 ${mine ? 'flex-row-reverse' : ''} ${continued ? '-mt-2.5' : 'pt-1'}`}>
        {m.user && (continued ? <span className="w-9 flex-shrink-0" /> : <Avatar user={m.user} online={mine ? undefined : online.has(m.user.id)} />)}
        <div className={`min-w-0 max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
          {!continued && (
            <p className={`text-xs font-bold text-slate-600 mb-1 flex items-center gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
              <span>{mine ? 'You' : m.user?.name}</span>
              <span className="font-normal text-slate-400">{time(m.created_at)}</span>
            </p>
          )}
          <div className="relative group/msg max-w-full min-w-0" onClick={() => setActiveMsgId(id => (id === m.id ? null : m.id))}>
            {messageActions(m, mine ? null : handle, mine)}
            <p
              title={time(m.created_at)}
              className={`px-4 py-2.5 rounded-2xl whitespace-pre-wrap break-anywhere text-[15px] leading-relaxed transition-shadow duration-300
                ${mine
                  ? `bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 ${continued ? 'rounded-tr-md' : 'rounded-tr-sm'}`
                  : `bg-white border text-slate-800 shadow-sm hover:shadow-md ${continued ? 'rounded-tl-md' : 'rounded-tl-sm'} ${forMe ? 'border-amber-300 ring-4 ring-amber-100' : 'border-slate-100'}`}`}
            >
              <MentionText text={m.text} candidates={allCandidates} myHandle={myHandle} dark={mine} />
            </p>
            {forMe && !continued && (
              <span className="absolute -top-2 -right-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[9px] font-bold uppercase tracking-wider shadow animate-pop">
                <AtSign className="w-2.5 h-2.5" /> you
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const sidePanel = (
    <div className="space-y-6">
      {/* Invite */}
      {detail && (
        <section>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Invite classmates</h3>
          <button onClick={copyInvite} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm font-semibold hover:bg-indigo-100">
            <span className="truncate">Code: <span className="font-mono tracking-wider">{detail.invite_code}</span></span>
            {inviteCopied ? <Check className="w-4 h-4 flex-shrink-0" /> : <Copy className="w-4 h-4 flex-shrink-0" />}
          </button>
          <p className="text-[11px] text-slate-400 mt-1.5 break-all">{inviteCopied ? 'Invite link copied!' : roomsAPI.inviteLink(detail.invite_code, shareOrigin)}</p>
        </section>
      )}

      {/* Members */}
      <section>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Members · {onlineCount} online</h3>
        <ul className="space-y-1">
          {members.sort((a, b) => Number(b.online) - Number(a.online)).map(m => (
            <li key={m.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 group transition-colors">
              <Avatar user={m} size="w-8 h-8 text-[11px]" online={m.online} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-800 truncate">{m.name}{m.id === me.id && ' (you)'}</span>
                <span className="block text-[11px] text-slate-400">@{handles.get(m.id)} · {m.role === 'owner' ? 'Owner' : m.online ? 'Online' : 'Offline'}</span>
              </span>
              {m.id !== me.id && (
                <button
                  onClick={() => { replyTo(handles.get(m.id) ?? m.name); setShowPanel(false); }}
                  className="hover-reveal p-2 rounded-md text-slate-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  aria-label={`Mention ${m.name}`}
                  title={`Mention @${handles.get(m.id)}`}
                >
                  <AtSign className="w-4 h-4" />
                </button>
              )}
              {isOwner && m.id !== me.id && (
                <button
                  onClick={() => window.confirm(`Remove ${m.name} from the room?`) && runAction(() => roomsAPI.removeMember(roomId, m.id), 'Could not remove the member.')}
                  className="hover-reveal p-2 rounded-md text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Remove ${m.name}`}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Shared documents */}
      <section>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Shared documents</h3>
        {detail && detail.documents.length === 0 && (
          <p className="text-xs text-slate-400 mb-2">Share a document so MindAI can answer questions and run quiz battles.</p>
        )}
        <ul className="space-y-1.5 mb-3">
          {detail?.documents.map(d => (
            <li key={d.id} className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 group">
              <FileText className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-700 truncate">{d.title}</span>
                <span className="block text-[11px] text-slate-400">Shared by {d.mine ? 'you' : d.shared_by.name}</span>
              </span>
              {(d.mine || isOwner) && (
                <button
                  onClick={() => window.confirm(`Stop sharing "${d.title}" with the room?`) && runAction(async () => setDetail(await roomsAPI.unshareDocument(roomId, d.id)), 'Could not remove the document.')}
                  className="hover-reveal p-2 -m-1 rounded-md text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Stop sharing ${d.title}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {unsharedDocs.length > 0 && (
          <div className="flex gap-2">
            <select value={shareId} onChange={e => setShareId(e.target.value)} className="flex-1 min-w-0 rounded-lg border-slate-200 text-sm py-2" aria-label="Document to share">
              <option value="">Share one of your documents...</option>
              {unsharedDocs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            <button onClick={shareDocument} disabled={!shareId} className="px-3 rounded-lg bg-slate-900 text-white disabled:opacity-40" aria-label="Share document">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      {/* Async quiz challenge */}
      <section className="p-4 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100">
        <h3 className="flex items-center gap-2 text-sm font-bold text-amber-800 mb-1"><Trophy className="w-4 h-4" /> Challenge the room</h3>
        <p className="text-xs text-amber-700/70 mb-3">Share one of your quizzes - everyone plays in their own time and climbs the leaderboard.</p>
        {myQuizzes.length ? (
          <div className="space-y-2">
            <select value={challengeSet} onChange={e => setChallengeSet(e.target.value)} className="w-full rounded-lg border-amber-200 text-sm py-2" aria-label="Quiz to share">
              <option value="">Choose a quiz…</option>
              {myQuizzes.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}
            </select>
            <div className="flex gap-2">
              <select value={challengeTime} onChange={e => setChallengeTime(Number(e.target.value))} className="rounded-lg border-amber-200 text-sm py-2" aria-label="Time limit">
                <option value={0}>No time limit</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option><option value={900}>15 minutes</option>
              </select>
              <button onClick={() => challengeSet && runAction(async () => { await challengesAPI.create(roomId, challengeSet, challengeTime || null); setChallengeSet(''); refreshChallenges(); }, 'Could not post the challenge.')}
                disabled={!challengeSet} className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold disabled:opacity-40 hover:bg-amber-600">Post</button>
            </div>
          </div>
        ) : <p className="text-xs text-amber-700/70">Generate a quiz first, then share it here.</p>}
      </section>

      {/* Quiz battle */}
      <section className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100">
        <h3 className="flex items-center gap-2 text-sm font-bold text-indigo-800 mb-1"><Swords className="w-4 h-4" /> Quiz battle</h3>
        <p className="text-xs text-indigo-700/70 mb-3">Everyone online answers live. Faster correct answers score more.</p>
        <div className="flex gap-2">
          <select value={quizCount} onChange={e => setQuizCount(Number(e.target.value))} className="rounded-lg border-indigo-200 text-sm py-2" aria-label="Number of questions">
            {[3, 5, 10].map(n => <option key={n} value={n}>{n} questions</option>)}
          </select>
          <button
            onClick={() => send({ type: 'quiz_start', count: quizCount }) || showToast('Reconnecting... try again in a moment.')}
            disabled={!detail?.documents.length || !!quiz || detail?.quiz_active || status !== 'open'}
            className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-indigo-700"
          >
            Start battle
          </button>
        </div>
      </section>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-50/60 relative overflow-hidden">
      <div className="absolute inset-0 dot-grid opacity-40 pointer-events-none [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      <div className="mesh-blob w-[30rem] h-[30rem] -top-56 left-1/4 bg-indigo-200/50" />
      {/* Header */}
      <div className="relative z-20 flex items-center gap-3 px-4 md:px-6 py-3 bg-white/75 backdrop-blur-xl border-b border-slate-200/70 flex-shrink-0 animate-slide-up">
        <button onClick={onBack} className="p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors" aria-label="Back to rooms"><ArrowLeft className="w-5 h-5" /></button>
        <span className="hidden sm:flex w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white items-center justify-center font-display font-bold shadow-md shadow-indigo-500/25 flex-shrink-0">
          {(detail?.name ?? '?').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          {renaming !== null ? (
            <form onSubmit={e => { e.preventDefault(); runAction(async () => { setDetail(await roomsAPI.rename(roomId, renaming)); setRenaming(null); }, 'Could not rename the room.'); }} className="flex gap-2">
              <input autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} maxLength={80} className="flex-1 rounded-lg border-slate-200 py-1.5 text-sm" aria-label="Room name" />
              <button type="submit" className="px-3 rounded-lg bg-slate-900 text-white text-sm font-bold">Save</button>
              <button type="button" onClick={() => setRenaming(null)} className="px-2 text-slate-400"><X className="w-4 h-4" /></button>
            </form>
          ) : (
            <>
              <h2 className="font-bold text-slate-900 truncate">{detail?.name ?? 'Loading...'}</h2>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                {status === 'open'
                  ? <><span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping" /><span className="relative w-1.5 h-1.5 rounded-full bg-emerald-500" /></span> {onlineCount} online · {members.length} member{members.length === 1 ? '' : 's'}</>
                  : <><WifiOff className="w-3 h-3" /> {status === 'connecting' ? 'Connecting...' : 'Reconnecting...'}</>}
              </p>
            </>
          )}
        </div>
        {/* Who's here */}
        <div className="hidden md:flex -space-x-2 mr-1">
          {members.filter(m => m.online).slice(0, 5).map(m => (
            <span key={m.id} className="ring-2 ring-white rounded-full" title={m.name}><Avatar user={m} size="w-8 h-8 text-[10px]" /></span>
          ))}
          {onlineCount > 5 && <span className="w-8 h-8 rounded-full bg-slate-100 ring-2 ring-white text-[10px] font-bold text-slate-500 flex items-center justify-center">+{onlineCount - 5}</span>}
        </div>
        <button onClick={() => setShowPanel(v => !v)} className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Room details"><Users className="w-5 h-5" /></button>
        <div className="relative">
          <button onClick={() => setShowSettings(v => !v)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Room settings" aria-expanded={showSettings}>
            <Settings className="w-5 h-5" />
          </button>
          {showSettings && detail && <div className="fixed inset-0 z-20" onClick={() => setShowSettings(false)} aria-hidden="true" />}
          {showSettings && detail && (
            <div className="absolute right-0 top-11 z-30 w-56 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 text-sm dialog-panel" onMouseLeave={() => setShowSettings(false)}>
              {isOwner ? (
                <>
                  <button onClick={() => { setRenaming(detail.name); setShowSettings(false); }} className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 text-slate-700"><Pencil className="w-4 h-4" /> Rename room</button>
                  <button onClick={() => { setShowSettings(false); if (window.confirm('Reset the invite link? The old link will stop working.')) runAction(async () => setDetail(await roomsAPI.resetInvite(roomId)), 'Could not reset the invite.'); }} className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 text-slate-700"><RefreshCw className="w-4 h-4" /> Reset invite link</button>
                  <button onClick={() => { setShowSettings(false); if (window.confirm(`Delete "${detail.name}" for everyone? This can't be undone.`)) runAction(async () => { await roomsAPI.remove(roomId); onBack(); }, 'Could not delete the room.'); }} className="w-full flex items-center gap-2 px-4 py-2 hover:bg-rose-50 text-rose-600"><Trash2 className="w-4 h-4" /> Delete room</button>
                </>
              ) : (
                <button onClick={() => { setShowSettings(false); if (window.confirm(`Leave "${detail.name}"? Documents you shared will be removed from the room.`)) runAction(async () => { await roomsAPI.leave(roomId); onBack(); }, 'Could not leave the room.'); }} className="w-full flex items-center gap-2 px-4 py-2 hover:bg-rose-50 text-rose-600"><LogOut className="w-4 h-4" /> Leave room</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="relative flex-1 flex min-h-0">
        {/* Chat */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4">
            {messages.length === 0 && detail && (
              <div className="max-w-md mx-auto text-center py-10 animate-rise">
                <div className="relative w-16 h-16 mx-auto mb-5">
                  <span className="absolute inset-0 rounded-2xl bg-indigo-400/30 blur-xl animate-pulse-slow" />
                  <span className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg animate-float"><MessageCircle className="w-8 h-8" /></span>
                </div>
                <h3 className="text-xl font-display font-bold text-slate-900">Welcome to {detail.name}</h3>
                <p className="text-sm text-slate-500 mt-2">Say hi, share a document, then type <span className="font-semibold text-indigo-600">@</span> to mention a classmate or ask an AI.</p>
                <div className="flex flex-wrap justify-center gap-2 mt-5">
                  {['Hi everyone! 👋', '@MindAI summarise the shared documents', '@Leo what are the weak points here?'].map(s => (
                    <button key={s} onClick={() => { setInput(s); setFocusKey(k => k + 1); }} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-700 hover:-translate-y-0.5 transition-all duration-300 shadow-sm">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {hasOlder && messages.length >= 50 && (
              <div className="flex justify-center">
                <button onClick={loadOlder} disabled={loadingOlder} className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1">
                  {loadingOlder && <Loader2 className="w-3 h-3 animate-spin" />} Load earlier messages
                </button>
              </div>
            )}
            {messages.map(renderMessage)}
            {aiStream && (() => {
              const persona = personas.find(p => p.id === aiStream.persona);
              const color = persona?.color ?? '#6366f1';
              return (
                <div className="flex gap-3 msg-in pt-1">
                  <AiAvatar persona={persona} />
                  <div className="min-w-0 max-w-[85%] bg-white/95 border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm" style={{ borderLeft: `3px solid ${color}` }}>
                    {aiStream.text
                      ? <div className="streaming-cursor"><MarkdownMessage text={aiStream.text} sources={aiStream.sources} onCite={setOpenSource} /></div>
                      : <span className="text-sm text-slate-400 flex items-center gap-2.5"><span className="typing-dots" style={{ color }}><span></span><span></span><span></span></span> {persona?.name ?? 'MindAI'} is thinking...</span>}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Jump to latest */}
          {showJump && (
            <button
              onClick={jumpToLatest}
              className="absolute bottom-40 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 pl-3 pr-3.5 py-2 rounded-full bg-slate-900/90 backdrop-blur text-white text-xs font-bold shadow-xl animate-pop"
            >
              <ArrowDown className="w-3.5 h-3.5" /> {unseen > 0 ? `${unseen} new message${unseen === 1 ? '' : 's'}` : 'Latest'}
            </button>
          )}

          {/* Composer */}
          <div className="px-4 md:px-8 pb-4 pt-1 flex-shrink-0">
            <div className="h-6 flex items-center">
              {typingNames.length > 0 && (
                <p className="text-xs text-slate-500 flex items-center gap-2 animate-fade-in">
                  <span className="typing-dots text-indigo-400"><span></span><span></span><span></span></span>
                  <span><span className="font-semibold">{typingNames.slice(0, 3).join(', ')}</span> {typingNames.length === 1 ? 'is' : 'are'} typing</span>
                </p>
              )}
            </div>
            <ChatComposer
              value={input}
              onChange={handleInput}
              onSubmit={handleSend}
              mentions={mentionCandidates}
              focusKey={focusKey || undefined}
              placeholder={askTarget
                ? `Ask ${askTarget === 'mindai' ? 'MindAI' : personas.find(p => p.id === askTarget)?.name ?? 'the AI'} something...`
                : 'Message the room · type @ to mention someone'}
              above={
                <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 mr-1 flex items-center gap-1 flex-shrink-0"><Sparkles className="w-3 h-3" /> Ask</span>
                  {[{ id: 'mindai', name: 'MindAI', color: '#6366f1' }, ...personas].map(p => {
                    const on = askTarget === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setAskTarget(on ? null : p.id)}
                        aria-pressed={on}
                        className={`flex-shrink-0 flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-xs font-semibold border transition-all duration-300 ${on ? 'text-white border-transparent shadow-md' : 'bg-white/80 text-slate-600 border-slate-200 hover:border-slate-300 hover:-translate-y-0.5'}`}
                        style={on ? { background: p.color } : undefined}
                      >
                        <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: on ? 'rgba(255,255,255,0.25)' : p.color }}>
                          {p.id === 'mindai' ? <Bot className="w-3 h-3" /> : p.name[0]}
                        </span>
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              }
            />
          </div>
        </div>

        {/* Details panel (a sheet with a backdrop on smaller screens) */}
        {showPanel && <div className="lg:hidden fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in" onClick={() => setShowPanel(false)} aria-hidden="true" />}
        <aside className={`${showPanel ? 'fixed inset-y-0 right-0 z-40 w-[min(20rem,88vw)] shadow-2xl' : 'hidden'} lg:static lg:block lg:w-80 lg:shadow-none flex-shrink-0 bg-white border-l border-slate-200 overflow-y-auto p-5`}>
          <div className="lg:hidden flex justify-end mb-2">
            <button onClick={() => setShowPanel(false)} className="p-2.5 -m-1 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
          {sidePanel}
        </aside>
      </div>

      {toast && (
        <div className="fixed top-20 inset-x-0 z-50 flex justify-center px-4 pointer-events-none" role="status">
          <div className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-900/95 backdrop-blur text-white text-sm font-medium shadow-2xl dialog-panel max-w-[90vw]">
            {toast.includes('mentioned you') && <AtSign className="w-4 h-4 text-amber-300" />}
            {toast}
          </div>
        </div>
      )}

      {quiz && (
        <QuizBattle
          state={quiz}
          me={me}
          canCancel={isOwner || (quiz.phase === 'preparing' && quiz.startedBy.id === me.id)}
          onAnswer={(index, option) => {
            send({ type: 'quiz_answer', index, option });
            setQuiz(prev => (prev && prev.phase === 'question' && prev.question.index === index ? { ...prev, myAnswer: option } : prev));
          }}
          onCancel={() => send({ type: 'quiz_cancel' })}
          onClose={() => setQuiz(null)}
        />
      )}

      {playChallenge && <ChallengeModal challengeId={playChallenge} meId={me.id} onClose={() => { setPlayChallenge(null); refreshChallenges(); }} />}

      {openSource && (
        <SourceDialog
          source={openSource}
          onClose={() => setOpenSource(null)}
          onOpenInReader={myDocIds.has(openSource.document_id) ? (s) => { setOpenSource(null); onOpenInReader(s); } : undefined}
        />
      )}
    </div>
  );
};
