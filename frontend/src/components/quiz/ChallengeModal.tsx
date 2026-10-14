import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Medal, Trophy, X, XCircle } from 'lucide-react';
import { Challenge, ChallengeRow, challengesAPI, getErrorMessage } from '../../services/api';
import { ItemResult, Question, ResponseItem } from '../../assessment/types';
import { QuizPlayer } from './QuizPlayer';
import { formatDuration } from './bits';
import { initials } from '../../auth/AuthContext';
import { Confetti } from '../Confetti';

interface ChallengeModalProps {
  challengeId: string;
  meId: string;
  onClose: () => void;
}

export const Leaderboard: React.FC<{ rows: ChallengeRow[]; meId?: string; limit?: number }> = ({ rows, meId, limit = 10 }) => (
  <ol className="space-y-1.5">
    {rows.slice(0, limit).map((row, i) => (
      <li key={row.user.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${row.user.id === meId ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-50'}`}>
        <span className={`w-6 text-center font-display font-bold ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-400' : 'text-slate-300'}`}>
          {i < 3 ? <Medal className="w-4 h-4 inline" /> : i + 1}
        </span>
        <span className="w-7 h-7 rounded-full text-white text-[10px] font-bold flex items-center justify-center" style={{ background: row.user.avatar_color }}>{initials(row.user.name)}</span>
        <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 truncate">{row.user.name}</span>
        <span className="text-xs text-slate-400 tabular-nums">{formatDuration(row.duration_ms)}</span>
        <span className="text-sm font-bold text-slate-900 tabular-nums">{row.pct}%</span>
      </li>
    ))}
  </ol>
);

/** Play a room challenge in test mode, then see your score and the leaderboard. */
export const ChallengeModal: React.FC<ChallengeModalProps> = ({ challengeId, meId, onClose }) => {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [stage, setStage] = useState<'intro' | 'playing' | 'grading' | 'done'>('intro');
  const [result, setResult] = useState<{ results: ItemResult[]; score_pct: number; leaderboard: ChallengeRow[]; questions: Question[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    challengesAPI.get(challengeId).then(setChallenge).catch(err => setError(getErrorMessage(err, 'Could not load the challenge.')));
  }, [challengeId]);

  const finish = async (responses: ResponseItem[], durationMs: number) => {
    setStage('grading');
    try {
      setResult(await challengesAPI.submit(challengeId, responses, durationMs));
      setStage('done');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not submit your answers.'));
      setStage('intro');
    }
  };

  const rank = result ? result.leaderboard.findIndex(r => r.user.id === meId) + 1 : 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-50/95 backdrop-blur-xl overflow-y-auto dialog-backdrop" role="dialog" aria-modal="true" aria-label="Quiz challenge" data-lenis-prevent>
      <button onClick={onClose} className="fixed top-4 right-4 z-[60] p-2 rounded-full bg-white shadow-md text-slate-500 hover:text-slate-800" aria-label="Close"><X className="w-5 h-5" /></button>
      <div className="max-w-5xl mx-auto p-5 md:p-8">
        {!challenge && !error && <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>}
        {error && <p className="max-w-md mx-auto mt-16 text-center text-rose-600 bg-rose-50 rounded-xl p-4">{error}</p>}

        {challenge && stage === 'intro' && (
          <div className="max-w-lg mx-auto mt-10 bg-white rounded-3xl shadow-2xl border border-slate-100 p-8 text-center dialog-panel">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg animate-float"><Trophy className="w-8 h-8" /></div>
            <p className="page-eyebrow text-amber-600 mt-5">Room challenge</p>
            <h2 className="text-2xl font-display font-bold text-slate-900 mt-1">{challenge.title}</h2>
            <p className="text-slate-500 mt-2">{challenge.count} questions{challenge.time_limit_s ? ` · ${Math.round(challenge.time_limit_s / 60)} minute limit` : ''} · set by {challenge.created_by.name}</p>
            {challenge.my_attempts > 0 && <p className="text-xs text-slate-400 mt-1">You've played this {challenge.my_attempts} time{challenge.my_attempts === 1 ? '' : 's'} - your best score counts.</p>}
            {challenge.leaderboard.length > 0 && <div className="mt-6 text-left"><Leaderboard rows={challenge.leaderboard} meId={meId} limit={5} /></div>}
            <button onClick={() => setStage('playing')} className="btn-shine mt-6 w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-lg shadow-orange-500/30">Start the challenge</button>
          </div>
        )}

        {challenge?.questions && stage === 'playing' && (
          <QuizPlayer
            setId=""
            title={challenge.title}
            questions={challenge.questions}
            config={{ mode: 'test', timeLimit: challenge.time_limit_s, shuffle: false, lives: 3 }}
            onFinish={finish}
            onExit={() => setStage('intro')}
          />
        )}

        {stage === 'grading' && <div className="flex flex-col items-center py-24 gap-3"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /><p className="text-slate-500">Marking…</p></div>}

        {result && stage === 'done' && (
          <div className="max-w-2xl mx-auto mt-6 space-y-5">
            <div className="relative overflow-hidden bg-[#0b0a1a] text-white rounded-[2rem] p-8 text-center shadow-2xl stack dialog-panel">
              {rank === 1 && <Confetti />}
              <p className="page-eyebrow text-amber-300">{rank === 1 ? 'You lead the room!' : `You're #${rank}`}</p>
              <p className="text-6xl font-display font-bold mt-2">{result.score_pct}%</p>
            </div>
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-500" /> Leaderboard</h3>
              <Leaderboard rows={result.leaderboard} meId={meId} />
            </div>
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
              <h3 className="font-bold text-slate-800 mb-3">Your answers</h3>
              <ul className="space-y-2">
                {result.results.map((r, i) => {
                  const q = result.questions.find(x => x.id === r.qid);
                  return (
                    <li key={r.qid} className="flex items-start gap-3 text-sm">
                      {r.correct ? <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-rose-500 flex-shrink-0" />}
                      <span className="flex-1"><span className="font-semibold text-slate-800">{i + 1}. {q?.question}</span>
                        {!r.correct && <span className="block text-slate-500">Answer: {r.expected}</span>}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <button onClick={onClose} className="w-full py-3 rounded-2xl bg-slate-900 text-white font-bold btn-fill">Back to the room</button>
          </div>
        )}
      </div>
    </div>
  );
};
