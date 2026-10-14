import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, AtSign, Square } from 'lucide-react';
import { VoiceInputButton } from '../VoiceInputButton';
import { MentionCandidate, MentionMenu, activeMentionQuery } from './mentions';

type Accent = 'indigo' | 'fuchsia' | 'violet';

const ACCENTS: Record<Accent, { ring: string; send: string }> = {
  indigo: { ring: 'from-indigo-400 via-violet-400 to-sky-400', send: 'from-indigo-600 to-violet-600 shadow-indigo-500/30' },
  fuchsia: { ring: 'from-fuchsia-400 via-purple-400 to-pink-400', send: 'from-fuchsia-600 to-purple-700 shadow-fuchsia-500/30' },
  violet: { ring: 'from-violet-400 via-fuchsia-400 to-indigo-400', send: 'from-violet-600 to-indigo-600 shadow-violet-500/30' },
};

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the trimmed text when the user sends */
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** An answer is streaming: show a stop button instead of send */
  busy?: boolean;
  onStop?: () => void;
  maxLength?: number;
  /** People/AIs that can be @mentioned (enables the mention picker) */
  mentions?: MentionCandidate[];
  /** Extra controls on the left inside the box (e.g. an "ask" picker) */
  leading?: React.ReactNode;
  /** Row above the box (e.g. quick prompts) */
  above?: React.ReactNode;
  accent?: Accent;
  voice?: boolean;
  size?: 'md' | 'sm';
  autoFocus?: boolean;
  /** Focus the box and move the caret to the end when this changes */
  focusKey?: unknown;
}

/**
 * Shared message box for every chat: grows with its content, Enter sends (Shift+Enter for a new line),
 * animated focus ring, voice dictation, stop button while streaming, and an @mention picker.
 */
export const ChatComposer: React.FC<ChatComposerProps> = ({
  value, onChange, onSubmit, placeholder, disabled, busy, onStop, maxLength = 4000, mentions, leading, above,
  accent = 'indigo', voice = true, size = 'md', autoFocus, focusKey,
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const colors = ACCENTS[accent];

  // Grow with the content up to a limit
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (focusKey === undefined) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusKey]);

  const matches = useMemo(() => {
    if (!mention || !mentions) return [];
    const q = mention.query.toLowerCase();
    return mentions
      .filter(c => !q || c.handle.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
      .sort((a, b) => Number(b.handle.toLowerCase().startsWith(q)) - Number(a.handle.toLowerCase().startsWith(q)))
      .slice(0, 8);
  }, [mention, mentions]);

  const updateMention = (text: string, caret: number) => {
    if (!mentions?.length) return;
    const found = activeMentionQuery(text, caret);
    setMention(found);
    if (found?.query !== mention?.query) setActive(0);
  };

  const insertMention = (c: MentionCandidate) => {
    const el = ref.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, mention.start)}@${c.handle} ${value.slice(caret)}`;
    const pos = mention.start + c.handle.length + 2;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const openMentionMenu = () => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const needsSpace = caret > 0 && !/\s/.test(value[caret - 1]);
    const next = `${value.slice(0, caret)}${needsSpace ? ' ' : ''}@${value.slice(caret)}`;
    const pos = caret + (needsSpace ? 2 : 1);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      updateMention(next, pos);
    });
  };

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || busy) return;
    setMention(null);
    onSubmit(text);
  };

  // Phones and tablets: Enter makes a new line (their keyboards have no Shift+Enter) and the button sends
  const touchKeyboard = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(matches[active]); return; }
    }
    if (mention && e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !touchKeyboard) {
      e.preventDefault();
      submit();
    }
  };

  const nearLimit = value.length > maxLength * 0.85;
  const small = size === 'sm';

  return (
    <div className="relative">
      {above}
      <form onSubmit={e => { e.preventDefault(); submit(); }} className="relative group/composer">
        {mention && mentions && (
          <MentionMenu items={matches} active={active} onPick={insertMention} onHover={setActive} />
        )}
        {/* Animated gradient ring on focus */}
        <div className={`absolute -inset-[2px] rounded-[1.15rem] bg-gradient-to-r ${colors.ring} bg-[length:200%_100%] animate-gradient-x opacity-0 group-focus-within/composer:opacity-100 blur-[1.5px] transition-opacity duration-500`} />
        <div className={`relative flex items-end gap-1.5 bg-white rounded-2xl border border-slate-200 shadow-lg shadow-slate-900/5 transition-all duration-500 group-focus-within/composer:border-transparent group-focus-within/composer:shadow-xl ${small ? 'p-1 pl-3' : 'p-1.5 pl-4'}`}>
          {leading && <div className="flex items-center self-center flex-shrink-0">{leading}</div>}
          <textarea
            ref={ref}
            rows={1}
            value={value}
            autoFocus={autoFocus}
            onChange={e => { onChange(e.target.value); updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
            onKeyDown={onKeyDown}
            onClick={e => updateMention(value, e.currentTarget.selectionStart ?? value.length)}
            onBlur={() => window.setTimeout(() => setMention(null), 120)}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={maxLength}
            aria-label="Message"
            enterKeyHint={touchKeyboard ? 'enter' : 'send'}
            data-lenis-prevent
            className={`flex-1 min-w-0 resize-none bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-slate-800 placeholder-slate-400 leading-6 max-h-[200px] ${small ? 'text-sm py-2' : 'text-[15px] py-2.5'} disabled:opacity-60`}
          />
          <div className="flex items-center gap-1 self-end pb-0.5">
            {nearLimit && <span className={`text-[10px] font-semibold tabular-nums mr-1 ${value.length >= maxLength ? 'text-rose-500' : 'text-slate-400'}`}>{value.length}/{maxLength}</span>}
            {mentions && mentions.length > 0 && (
              <button
                type="button"
                onClick={openMentionMenu}
                disabled={disabled}
                className="h-9 w-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40"
                aria-label="Mention someone"
                title="Mention someone (@)"
              >
                <AtSign className="w-[18px] h-[18px]" />
              </button>
            )}
            {voice && (
              <VoiceInputButton disabled={disabled || busy} onTranscript={text => onChange(value ? `${value.trimEnd()} ${text}` : text)} />
            )}
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                className={`${small ? 'h-9 w-9' : 'h-10 w-10 md:h-11 md:w-11'} rounded-xl flex items-center justify-center text-white bg-slate-800 hover:bg-slate-900 shadow-md transition-colors`}
                aria-label="Stop generating"
                title="Stop"
              >
                <span className="relative flex items-center justify-center">
                  <span className="absolute w-7 h-7 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <Square className="w-3.5 h-3.5 fill-current" />
                </span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={disabled || !value.trim()}
                className={`${small ? 'h-9 w-9' : 'h-10 w-10 md:h-11 md:w-11'} rounded-xl flex items-center justify-center text-white bg-gradient-to-br ${colors.send} shadow-md disabled:opacity-40 disabled:shadow-none transition-all duration-500 ease-out-expo enabled:hover:-translate-y-0.5 enabled:hover:shadow-lg group/send`}
                aria-label="Send message"
                title="Send (Enter)"
              >
                <ArrowUp className={`${small ? 'w-4 h-4' : 'w-5 h-5'} stroke-[2.5px] transition-transform duration-500 ease-out-expo group-hover/send:-translate-y-0.5`} />
              </button>
            )}
          </div>
        </div>
      </form>
      <p className="hidden md:block mt-1.5 text-[10.5px] text-slate-400 text-center">
        <kbd className="font-sans font-semibold">Enter</kbd> to send · <kbd className="font-sans font-semibold">Shift + Enter</kbd> for a new line{mentions?.length ? ' · @ to mention' : ''}
      </p>
    </div>
  );
};
