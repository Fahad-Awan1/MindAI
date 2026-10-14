import React, { useEffect, useRef, useState } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { getErrorMessage, ChatHistoryItem, StreamOptions } from '../services/api';
import { MarkdownMessage } from './MarkdownMessage';
import { SpeakButton } from './SpeakButton';
import { LogoMark } from './Logo';
import { ChatComposer } from './chat/ChatComposer';
import { X } from 'lucide-react';

interface TutorMessage {
  role: 'user' | 'model';
  text: string;
  isError?: boolean;
}

export interface TutorChatProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  /** Shown above the conversation (e.g. the question or highlighted passage) */
  context: React.ReactNode;
  /** Stream an answer. `followUp` is undefined for the first, automatic answer. */
  request: (history: ChatHistoryItem[], followUp: string | undefined, options: StreamOptions) => Promise<unknown>;
  placeholder?: string;
  onClose: () => void;
}

/** Slide-over panel with a streaming tutor conversation (first answer is requested on open). */
export const TutorChat: React.FC<TutorChatProps> = ({ title, subtitle, icon, context, request, placeholder, onClose }) => {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = async (followUp: string | undefined, previous: TutorMessage[]) => {
    const history: ChatHistoryItem[] = previous.filter(m => !m.isError).map(m => ({ role: m.role, text: m.text }));
    const base = followUp ? [...previous, { role: 'user' as const, text: followUp }] : previous;
    setMessages([...base, { role: 'model', text: '' }]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let received = '';
    try {
      await request(history, followUp, {
        signal: controller.signal,
        onDelta: piece => {
          if (abortRef.current !== controller) return;
          received += piece;
          setMessages(prev => prev.map((m, i) => (i === prev.length - 1 ? { ...m, text: m.text + piece } : m)));
        },
      });
    } catch (err) {
      // A newer request replaced this one (e.g. effect re-run): leave its state alone
      if (abortRef.current !== controller) return;
      if ((err as Error)?.name !== 'AbortError') {
        const text = getErrorMessage(err, 'The tutor is unavailable right now. Please try again.');
        setMessages(prev => received
          ? [...prev, { role: 'model', text, isError: true }]
          : prev.map((m, i) => (i === prev.length - 1 ? { role: 'model', text, isError: true } : m)));
      } else if (!received) {
        setMessages(prev => prev.slice(0, -1));
      }
    } finally {
      if (abortRef.current === controller) {
        setIsStreaming(false);
        abortRef.current = null;
      }
    }
  };

  // First answer as soon as the panel opens
  useEffect(() => {
    ask(undefined, []);
    return () => {
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Android back / Escape closes it
  useBackHandler(onClose);

  const handleSend = (raw: string) => {
    const text = raw.trim();
    if (!text || isStreaming) return;
    setInput('');
    ask(text, messages);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end no-print" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dialog-backdrop" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-slate-50 shadow-2xl flex flex-col drawer-in">
        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-white/80 backdrop-blur-xl border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-primary-600 text-white flex items-center justify-center shadow-md">
              {icon}
            </div>
            <div>
              <h2 className="font-bold text-slate-900 leading-tight">{title}</h2>
              <p className="text-xs text-slate-400">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {context}

          {messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="flex justify-end msg-in">
                <p className="max-w-[85%] bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm whitespace-pre-wrap shadow-md shadow-indigo-500/20 leading-relaxed">{m.text}</p>
              </div>
            ) : (
              <div key={i} className="flex gap-3 group msg-in">
                <LogoMark size={32} className="flex-shrink-0 drop-shadow" />
                <div className={`flex-1 min-w-0 rounded-2xl rounded-tl-sm px-4 py-3 border shadow-sm ${m.isError ? 'bg-red-50 border-red-100 text-red-700 text-sm' : 'bg-white border-slate-100'}`}>
                  {m.text ? (
                    m.isError ? m.text : (
                      <>
                        <div className={isStreaming && i === messages.length - 1 ? 'streaming-cursor' : ''}>
                          <MarkdownMessage text={m.text} />
                        </div>
                        {!(isStreaming && i === messages.length - 1) && (
                          <div className="flex justify-end mt-1"><SpeakButton text={m.text} /></div>
                        )}
                      </>
                    )
                  ) : (
                    <div className="flex items-center gap-2.5 py-1 text-xs font-semibold text-slate-400">
                      <span className="typing-dots text-indigo-400"><span></span><span></span><span></span></span>
                      Thinking…
                    </div>
                  )}
                </div>
              </div>
            )
          ))}
          <div ref={endRef} />
        </div>

        <div className="px-4 pt-3 pb-3 bg-gradient-to-t from-white to-slate-50 border-t border-slate-100">
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            busy={isStreaming}
            onStop={() => abortRef.current?.abort()}
            placeholder={placeholder ?? 'Ask a follow-up question...'}
            size="sm"
            autoFocus
          />
        </div>
      </div>
    </div>
  );
};
