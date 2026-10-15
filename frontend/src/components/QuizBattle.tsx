import React, { useEffect, useState } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { LeaderboardRow, UserBrief } from '../types';
import { initials } from '../auth/AuthContext';
import { Loader2, Swords, Trophy, Check, X, Timer, Medal } from 'lucide-react';

export interface QuizQuestionEvent {
  index: number;
  total: number;
  question: string;
  options: string[];
  topic?: string | null;
  time_limit: number;
  remaining: number;
  answered: number;
  players: number;
}

export interface QuizRevealEvent {
  index: number;
  total: number;
  correct_index: number;
  explanation: string;
  counts: number[];
  results: Record<string, { option: number; correct: boolean; points: number }>;
  leaderboard: LeaderboardRow[];
}

export type QuizState =
  | { phase: 'preparing'; startedBy: UserBrief; count: number }
  | { phase: 'question'; question: QuizQuestionEvent; receivedAt: number; myAnswer: number | null; answered: number }
  | { phase: 'reveal'; question: QuizQuestionEvent; reveal: QuizRevealEvent; myAnswer: number | null }
  | { phase: 'end'; leaderboard: LeaderboardRow[] };

interface QuizBattleProps {
  state: QuizState;
  me: UserBrief;
  canCancel: boolean;
  onAnswer: (index: number, option: number) => void;
  onCancel: () => void;
  onClose: () => void;
}

const LETTERS = 'ABCDEFGH';

const Avatar: React.FC<{ user: UserBrief; size?: string }> = ({ user, size = 'w-8 h-8 text-xs' }) => (
  <span className={`${size} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`} style={{ background: user.avatar_color }}>
    {initials(user.name)}
  </span>
);

const Leaderboard: React.FC<{ rows: LeaderboardRow[]; me: UserBrief; limit?: number }> = ({ rows, me, limit = 5 }) => (
  <ol className="space-y-1.5">
    {rows.slice(0, limit).map((row, i) => (
      <li key={row.user.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${row.user.id === me.id ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50'}`}>
        <span className="w-5 text-sm font-bold text-slate-400 tabular-nums">{i + 1}</span>
        <Avatar user={row.user} size="w-7 h-7 text-[10px]" />
        <span className="flex-1 truncate text-sm font-semibold text-slate-800">{row.user.name}{row.user.id === me.id && ' (you)'}</span>
        <span className="text-xs text-slate-400">{row.correct} correct</span>
        <span className="text-sm font-bold text-slate-900 tabular-nums w-14 text-right">{row.score}</span>
      </li>
    ))}
  </ol>
);

/** Full-screen live quiz battle shown to everyone in the room. */
export const QuizBattle: React.FC<QuizBattleProps> = ({ state, me, canCancel, onAnswer, onCancel, onClose }) => {
  const [now, setNow] = useState(Date.now());
  // Cancelling ends the battle for everyone, so it takes a second tap within a few seconds
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    if (!confirmCancel) return;
    const timer = window.setTimeout(() => setConfirmCancel(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmCancel]);
  useBackHandler(onClose);

  // Tick the countdown while a question is open
  useEffect(() => {
    if (state.phase !== 'question') return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [state.phase]);

  const header = (
    <div className="flex items-center justify-between gap-3 mb-6">
      <div className="flex items-center gap-2 text-indigo-600">
        <Swords className="w-5 h-5" />
        <span className="font-bold uppercase tracking-wider text-xs">Quiz battle</span>
      </div>
      <div className="flex items-center gap-1">
        {state.phase !== 'end' && canCancel && (
          <button onClick={() => (confirmCancel ? onCancel() : setConfirmCancel(true))}
            className={`px-2 py-2 text-xs font-bold hover:text-rose-600 ${confirmCancel ? 'text-rose-600' : 'text-slate-400'}`}>
            {confirmCancel ? 'Tap again to end it for everyone' : 'Cancel battle'}
          </button>
        )}
        {state.phase !== 'end' && (
          <button onClick={onClose} className="px-2 py-2 text-xs font-bold text-slate-400 hover:text-slate-700" title="Hide - it opens again with the next question">Hide</button>
        )}
      </div>
    </div>
  );

  let body: React.ReactNode = null;

  if (state.phase === 'preparing') {
    body = (
      <div className="text-center py-10">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto mb-4" />
        <p className="text-xl font-bold text-slate-900">{state.startedBy.name} started a {state.count}-question battle</p>
        <p className="text-slate-500 mt-1">Writing questions from the room's shared documents...</p>
      </div>
    );
  }

  if (state.phase === 'question' || state.phase === 'reveal') {
    const q = state.question;
    const remaining = state.phase === 'question'
      ? Math.max(0, q.remaining - (now - state.receivedAt) / 1000)
      : 0;
    const reveal = state.phase === 'reveal' ? state.reveal : null;
    const myResult = reveal?.results[me.id];

    body = (
      <>
        <div className="flex items-center justify-between text-sm mb-3">
          <span className="font-bold text-slate-500">Question {q.index + 1} of {q.total}</span>
          {state.phase === 'question' ? (
            <span className={`flex items-center gap-1.5 font-bold tabular-nums ${remaining < 5 ? 'text-rose-600' : 'text-slate-700'}`}>
              <Timer className="w-4 h-4" /> {Math.ceil(remaining)}s
            </span>
          ) : (
            <span className={`font-bold ${myResult?.correct ? 'text-emerald-600' : 'text-rose-600'}`}>
              {myResult ? (myResult.correct ? `Correct! +${myResult.points}` : 'Not this time') : 'No answer'}
            </span>
          )}
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-6" role="progressbar" aria-valuemin={0} aria-valuemax={q.time_limit} aria-valuenow={Math.round(remaining)}>
          <div className={`h-full rounded-full ${remaining < 5 ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${(remaining / q.time_limit) * 100}%` }} />
        </div>

        {q.topic && <p className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1">{q.topic}</p>}
        <h2 className="text-xl md:text-2xl font-display font-bold text-slate-900 mb-6">{q.question}</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {q.options.map((option, i) => {
            const chosen = state.myAnswer === i;
            let style = 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50';
            if (reveal) {
              style = i === reveal.correct_index
                ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                : chosen ? 'bg-rose-50 border-rose-300 text-rose-900' : 'bg-white border-slate-100 opacity-60';
            } else if (chosen) {
              style = 'bg-indigo-600 border-indigo-600 text-white';
            } else if (state.myAnswer !== null) {
              style = 'bg-white border-slate-100 opacity-60';
            }
            return (
              <button
                key={i}
                onClick={() => onAnswer(q.index, i)}
                disabled={state.phase !== 'question' || state.myAnswer !== null || remaining <= 0}
                className={`flex items-center gap-3 text-left p-4 rounded-2xl border-2 font-semibold transition-all disabled:cursor-default ${style}`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${chosen && !reveal ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
                  {LETTERS[i]}
                </span>
                <span className="flex-1 min-w-0 break-anywhere">{option}</span>
                {reveal && i === reveal.correct_index && <Check className="w-5 h-5 text-emerald-600" />}
                {reveal && chosen && i !== reveal.correct_index && <X className="w-5 h-5 text-rose-600" />}
                {reveal && <span className="text-xs font-bold text-slate-400 tabular-nums">{reveal.counts[i]}</span>}
              </button>
            );
          })}
        </div>

        {state.phase === 'question' && (
          <p className="text-sm text-slate-500 mt-5 text-center">
            {state.myAnswer !== null ? 'Answer locked in! ' : ''}{state.answered} of {Math.max(q.players, state.answered)} answered
          </p>
        )}

        {reveal && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {reveal.explanation && (
              <p className="text-sm text-slate-600 bg-slate-50 rounded-2xl p-4 leading-relaxed">{reveal.explanation}</p>
            )}
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Leaderboard</p>
              <Leaderboard rows={reveal.leaderboard} me={me} limit={4} />
            </div>
          </div>
        )}
      </>
    );
  }

  if (state.phase === 'end') {
    const podium = state.leaderboard.slice(0, 3);
    body = (
      <div className="text-center">
        <Trophy className="w-14 h-14 text-amber-400 mx-auto mb-3" />
        <h2 className="text-3xl font-display font-bold text-slate-900 mb-1">
          {podium[0] && podium[0].score > 0 ? `${podium[0].user.name} wins!` : 'Battle over'}
        </h2>
        <p className="text-slate-500 mb-6">Final standings</p>
        <div className="flex items-end justify-center gap-3 mb-6">
          {[1, 0, 2].map(pos => podium[pos] && (
            <div key={podium[pos].user.id} className="flex flex-col items-center gap-2 w-20 sm:w-24 min-w-0">
              <Avatar user={podium[pos].user} size="w-12 h-12 text-sm" />
              <span className="text-sm font-bold text-slate-800 truncate max-w-full">{podium[pos].user.name}</span>
              <div className={`w-full rounded-t-xl flex flex-col items-center justify-start pt-2 text-white font-bold
                ${pos === 0 ? 'h-28 bg-amber-400' : pos === 1 ? 'h-20 bg-slate-400' : 'h-14 bg-orange-400'}`}>
                <Medal className="w-5 h-5" />
                <span className="text-xs mt-1 tabular-nums">{podium[pos].score}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="text-left mb-6"><Leaderboard rows={state.leaderboard} me={me} limit={10} /></div>
        <button onClick={onClose} className="px-6 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800">Back to the room</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Quiz battle">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" />
      <div className="relative w-full max-w-2xl max-h-[92dvh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-6 md:p-8 dialog-panel">
        {header}
        {body}
      </div>
    </div>
  );
};
