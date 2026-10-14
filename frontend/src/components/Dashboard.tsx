
import React, { useEffect, useState } from 'react';
import { DocumentFile, AppView, Progress, StudySetKind, StudySetSummary } from '../types';
import { progressAPI, bankAPI, getErrorMessage } from '../services/api';
import { useAuth } from '../auth/AuthContext';
import { Tooltip } from './Tooltip';
import { ActivityChart, AccuracyTrend, MasteryList } from './ProgressCharts';
import { RevealText, Reveal, CountUp, Marquee, Magnetic, RollText, useTilt } from '../motion';
import {
  FileText, BrainCircuit, Zap, GraduationCap, Plus, Clock, Sparkles, ChevronRight, ArrowUpRight,
  Flame, Target, Layers, MessageSquareQuote, Headphones, MessagesSquare, Library, CalendarClock, FileSignature, Network, Loader2, BarChart3, CalendarCheck,
  Users, BookOpen, Share2, MessageSquareText, Award
} from 'lucide-react';

interface DashboardProps {
  documents: DocumentFile[];
  onChangeView: (view: AppView) => void;
  onOpenSet: (set: StudySetSummary) => void;
  onStartReview: () => void;
}

const KIND_META: Record<StudySetKind, { label: string; icon: React.ElementType; tone: string }> = {
  quiz: { label: 'Quiz', icon: GraduationCap, tone: 'bg-indigo-50 text-indigo-600' },
  flashcards: { label: 'Flashcards', icon: Zap, tone: 'bg-amber-50 text-amber-600' },
  study_plan: { label: 'Study plan', icon: CalendarClock, tone: 'bg-violet-50 text-violet-600' },
  exam: { label: 'Exam', icon: FileSignature, tone: 'bg-sky-50 text-sky-600' },
  mind_map: { label: 'Mind map', icon: Network, tone: 'bg-pink-50 text-pink-600' },
  teach_back: { label: 'Teach-back', icon: MessageSquareQuote, tone: 'bg-teal-50 text-teal-600' },
  audio_overview: { label: 'Audio overview', icon: Headphones, tone: 'bg-rose-50 text-rose-600' },
  study_group: { label: 'Study group', icon: MessagesSquare, tone: 'bg-violet-50 text-violet-600' },
};

const cardClass = "bg-white/90 backdrop-blur rounded-[1.75rem] shadow-[0_2px_15px_-3px_rgba(0,0,0,0.06),0_10px_20px_-2px_rgba(0,0,0,0.03)] border border-slate-100";

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 5) return 'Burning the midnight oil';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const TICKER = [
  { icon: MessageSquareText, text: 'Ask anything, get cited answers' },
  { icon: Layers, text: 'Review before you forget' },
  { icon: Users, text: 'Study live with classmates' },
  { icon: Headphones, text: 'Listen to your notes' },
  { icon: Share2, text: 'Connect ideas across documents' },
  { icon: BookOpen, text: 'Highlight to learn' },
];

interface StatTileProps {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  value: React.ReactNode;
  detail: string;
  delay?: number;
}

const StatTile: React.FC<StatTileProps> = ({ icon: Icon, iconClass, label, value, detail, delay = 0 }) => (
  <Reveal delay={delay} className="h-full">
    <div className={`${cardClass} spotlight lift p-6 flex items-center gap-5 h-full group`}>
      <div className={`w-14 h-14 rounded-2xl text-white flex items-center justify-center shadow-lg flex-shrink-0 transition-transform duration-700 ease-out-expo group-hover:rotate-[-8deg] group-hover:scale-110 ${iconClass}`}>
        <Icon className="w-7 h-7" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.14em]">{label}</p>
        <p className="text-3xl font-display font-bold text-slate-900 leading-tight tabular-nums">{value}</p>
        <p className="text-xs text-slate-500 truncate">{detail}</p>
      </div>
    </div>
  </Reveal>
);

interface ActionCardProps {
  index: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  onClick: () => void;
  featured?: boolean;
  accent: string;
  cursor: string;
}

const ActionCard: React.FC<ActionCardProps> = ({ index, icon: Icon, title, subtitle, onClick, featured, accent, cursor }) => {
  const tilt = useTilt(7);
  return (
    <button
      onClick={onClick}
      {...tilt}
      data-cursor={cursor}
      className={`roll-host tilt spotlight w-full p-6 rounded-[1.75rem] flex flex-col items-start gap-8 text-left group relative overflow-hidden transition-shadow duration-500
        ${featured
          ? 'bg-gradient-to-br from-primary-600 via-violet-600 to-indigo-700 text-white shadow-xl shadow-primary-600/25 hover:shadow-2xl hover:shadow-primary-600/40 spotlight-dark'
          : 'bg-white border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-900/5'}`}
    >
      {featured && <div className="absolute -top-16 -right-16 w-48 h-48 bg-white/10 rounded-full transition-transform duration-1000 ease-out-expo group-hover:scale-150" />}
      <div className="w-full flex items-start justify-between">
        <div className={`p-3 rounded-2xl transition-transform duration-700 ease-out-expo group-hover:scale-110 group-hover:-rotate-6 ${featured ? 'bg-white/20 backdrop-blur-sm' : accent}`}>
          <Icon className="w-6 h-6" />
        </div>
        <span className={`font-display text-sm font-semibold tabular-nums ${featured ? 'text-white/60' : 'text-slate-300'}`}>{index}</span>
      </div>
      <div className="w-full flex items-end justify-between gap-3">
        <div>
          <span className={`block font-bold text-lg ${featured ? '' : 'text-slate-900'}`}><RollText text={title} /></span>
          <span className={`text-sm ${featured ? 'text-primary-100' : 'text-slate-500'}`}>{subtitle}</span>
        </div>
        <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ease-out-expo group-hover:rotate-45
          ${featured ? 'bg-white text-primary-700' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-900 group-hover:text-white'}`}>
          <ArrowUpRight className="w-4 h-4" />
        </span>
      </div>
    </button>
  );
};

/** Level, XP and badges, plus the "Daily 5" instant review built from the question bank. */
const MotivationRow: React.FC<{ progress: Progress; onOpenSet: (set: StudySetSummary) => void }> = ({ progress, onOpenSet }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const badges = progress.badges || [];
  const earned = badges.filter(b => b.earned).length;

  const daily = async () => {
    setBusy(true);
    setNote(null);
    try {
      let set;
      try {
        set = await bankAPI.quiz('due', 5);
      } catch {
        set = await bankAPI.quiz('random', 5);
      }
      onOpenSet(set);
    } catch (err) {
      setNote(getErrorMessage(err, 'Generate a quiz first - its questions fill your bank.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-10">
      <Reveal className="lg:col-span-3">
        <div className={`${cardClass} spotlight p-6 h-full`}>
          <div className="flex items-center gap-5">
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#ede9fe" strokeWidth="8" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="url(#lvl)" strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={213.6} strokeDashoffset={213.6 * (1 - (progress.level_progress_pct ?? 0) / 100)} style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1)' }} />
                <defs><linearGradient id="lvl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#f59e0b" /></linearGradient></defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Level</span>
                <span className="text-2xl font-display font-bold text-slate-900 leading-none">{progress.level ?? 1}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.14em]">Experience</p>
              <p className="text-2xl font-display font-bold text-slate-900"><CountUp value={progress.xp ?? 0} /> XP</p>
              <p className="text-xs text-slate-500">{Math.max(0, (progress.next_level_xp ?? 100) - (progress.xp ?? 0))} XP to level {(progress.level ?? 1) + 1} · {earned}/{badges.length} badges</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {badges.map(b => (
              <Tooltip key={b.id} content={`${b.description}${b.earned ? ' ✓' : ''}`}>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all duration-500 ${b.earned
                  ? 'bg-gradient-to-r from-amber-100 to-orange-100 text-amber-800 ring-1 ring-amber-200 shadow-sm hover:-translate-y-0.5'
                  : 'bg-slate-50 text-slate-300 ring-1 ring-slate-100'}`}>
                  <Award className="w-3.5 h-3.5" /> {b.title}
                </span>
              </Tooltip>
            ))}
          </div>
        </div>
      </Reveal>
      <Reveal delay={120} className="lg:col-span-2">
        <div className="relative overflow-hidden h-full rounded-[1.75rem] p-6 text-white bg-gradient-to-br from-violet-600 via-indigo-600 to-sky-600 shadow-xl shadow-indigo-500/25 stack">
          <div className="mesh-blob w-56 h-56 -top-20 -right-16 bg-fuchsia-400/40" />
          <p className="page-eyebrow text-white/80">Daily 5</p>
          <h3 className="text-2xl font-display font-bold mt-1">Five-question warm-up</h3>
          <p className="text-sm text-white/80 mt-1">
            {(progress.bank_due ?? 0) > 0 ? `${progress.bank_due} question${progress.bank_due === 1 ? ' is' : 's are'} due for re-testing.` : (progress.bank_total ?? 0) > 0 ? 'Nothing due - get a quick random mix from your bank.' : 'Generate a quiz to start your question bank.'}
          </p>
          <button onClick={daily} disabled={busy || !(progress.bank_total ?? 0)} data-cursor="Go"
            className="mt-5 flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-indigo-700 font-bold shadow-lg hover:-translate-y-0.5 transition-transform disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Start Daily 5
          </button>
          {note && <p className="mt-3 text-xs text-white/90">{note}</p>}
        </div>
      </Reveal>
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ documents, onChangeView, onOpenSet, onStartReview }) => {
  const { user } = useAuth();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);

  // Reload whenever the dashboard is shown or the document list changes
  useEffect(() => {
    let cancelled = false;
    setProgressError(null);
    progressAPI.get()
      .then(p => { if (!cancelled) setProgress(p); })
      .catch(err => { if (!cancelled) setProgressError(getErrorMessage(err, 'Failed to load your progress.')); });
    return () => { cancelled = true; };
  }, [documents.length]);

  const totals = progress?.totals;
  const streak = progress?.current_streak_days ?? 0;
  const firstName = user?.name.split(' ')[0] ?? 'Student';

  const streakMessage = !progress
    ? `You have ${documents.length} documents ready for study.`
    : streak === 0
      ? "Start a quiz, review some flashcards or ask the AI tutor a question to begin a study streak."
      : progress.studied_today
        ? `You're on a ${streak}-day streak. Great work today — keep it going tomorrow!`
        : `You're on a ${streak}-day streak. Study today to keep it alive!`;

  const loader = <span className="inline-block w-16 h-7 rounded-lg shimmer align-middle" />;

  return (
    <div className="p-5 md:p-8 w-full max-w-7xl mx-auto pb-20">
      {/* Hero Section */}
      <div className="relative bg-[#0b0a1a] rounded-[2.5rem] mb-10 text-white overflow-hidden shadow-2xl shadow-violet-950/30 grain">
        <div className="mesh-bg">
          <div className="mesh-blob w-[520px] h-[520px] -top-60 -right-32 bg-violet-600/50" />
          <div className="mesh-blob w-[420px] h-[420px] -bottom-56 -left-24 bg-indigo-600/40" style={{ animationDelay: '-8s' }} />
          <div className="mesh-blob w-[260px] h-[260px] top-10 left-1/2 bg-fuchsia-500/20" style={{ animationDelay: '-14s' }} />
        </div>
        <div className="absolute inset-0 dot-grid opacity-[0.1]" />

        <div className="relative z-10 p-8 md:p-12 flex flex-col lg:flex-row justify-between lg:items-end gap-8">
          <div className="max-w-2xl">
            <Reveal className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-xs font-medium mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              AI study companion online
            </Reveal>
            <RevealText
              as="h2"
              text={`${greeting()}, ${firstName}.`}
              accent={[firstName]}
              accentClassName="font-elegant italic font-normal text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-fuchsia-200 to-amber-200"
              delay={100}
              className="text-[2.6rem] md:text-6xl font-display font-bold mb-5 tracking-tight leading-[1.02]"
            />
            <Reveal delay={350}>
              <p className="text-slate-300 max-w-xl text-lg leading-relaxed">{streakMessage}</p>
            </Reveal>
          </div>
          <Reveal delay={450} className="flex flex-col items-start lg:items-end gap-4">
            {streak > 0 && (
              <Tooltip content={`Longest streak: ${progress?.longest_streak_days} days`} position="left">
                <div className="flex items-center gap-3 bg-white/10 border border-white/10 backdrop-blur rounded-2xl px-4 py-2.5">
                  <Flame className={`w-6 h-6 ${progress?.studied_today ? 'text-orange-400 animate-bounce-slight' : 'text-slate-400'}`} />
                  <span className="text-3xl font-display font-bold"><CountUp value={streak} /></span>
                  <span className="text-sm text-slate-300">day streak</span>
                </div>
              </Tooltip>
            )}
            <Magnetic>
              <button
                onClick={() => onChangeView(AppView.CHAT)}
                data-cursor="Let's go"
                className="roll-host btn-fill group text-slate-900 hover:text-white bg-white px-7 py-4 rounded-full font-bold flex items-center gap-3 shadow-xl shadow-black/20 transition-colors duration-500"
              >
                <RollText text="Start AI Chat" />
                <span className="w-7 h-7 rounded-full bg-slate-900 text-white group-hover:bg-white group-hover:text-primary-700 flex items-center justify-center transition-all duration-500 group-hover:rotate-[-45deg]">
                  <ChevronRight className="w-4 h-4" />
                </span>
              </button>
            </Magnetic>
          </Reveal>
        </div>

        <div className="relative z-10 border-t border-white/[0.08]">
          <Marquee duration={45} className="py-4">
            {TICKER.map(({ icon: Icon, text }) => (
              <span key={text} className="flex items-center gap-3 px-7 text-white/60 text-sm font-medium whitespace-nowrap">
                <Icon className="w-4 h-4 text-violet-300" />
                {text}
                <span className="ml-7 w-1.5 h-1.5 rotate-45 bg-amber-300/70" />
              </span>
            ))}
          </Marquee>
        </div>
      </div>

      {progressError && (
        <p className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm animate-slide-up">{progressError}</p>
      )}

      {/* Spaced-repetition reminder */}
      {progress && (progress.cards_due_now > 0 || progress.cards_new > 0) && (
        <Reveal className="mb-10">
          <div className="relative overflow-hidden flex flex-col sm:flex-row sm:items-center gap-4 p-5 rounded-[1.75rem] bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border border-amber-100">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/30 flex-shrink-0 animate-float">
              <CalendarCheck className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-900">
                {progress.cards_due_now > 0
                  ? `${progress.cards_due_now} flashcard${progress.cards_due_now === 1 ? ' is' : 's are'} due for review`
                  : 'No reviews due — learn some new cards'}
              </p>
              <p className="text-sm text-slate-600">
                {progress.cards_new > 0 && `${progress.cards_new} new card${progress.cards_new === 1 ? '' : 's'} waiting. `}
                Reviewing right before you forget is the fastest way to remember for good.
              </p>
            </div>
            <button
              onClick={onStartReview}
              data-cursor="Review"
              className="roll-host btn-fill px-5 py-3 rounded-full bg-slate-900 text-white font-bold transition-colors flex items-center gap-2 self-start sm:self-auto"
            >
              <RollText text="Start review" /> <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </Reveal>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-10">
        <StatTile
          icon={Flame}
          iconClass="bg-gradient-to-br from-orange-400 to-rose-500 shadow-orange-500/30"
          label="Study streak"
          value={progress ? <><CountUp value={streak} /> {streak === 1 ? 'day' : 'days'}</> : loader}
          detail={progress ? `Longest: ${progress.longest_streak_days} days` : 'Loading...'}
        />
        <StatTile
          delay={80}
          icon={Target}
          iconClass="bg-gradient-to-br from-emerald-400 to-teal-500 shadow-emerald-500/30"
          label="Quiz accuracy"
          value={!totals ? loader : totals.avg_quiz_accuracy_pct != null ? <CountUp value={totals.avg_quiz_accuracy_pct} suffix="%" /> : '–'}
          detail={totals ? `${totals.quizzes_taken} quiz${totals.quizzes_taken === 1 ? '' : 'zes'} taken` : 'Loading...'}
        />
        <StatTile
          delay={160}
          icon={Layers}
          iconClass="bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/30"
          label="Cards reviewed"
          value={totals ? <CountUp value={totals.cards_reviewed} /> : loader}
          detail={totals && totals.cards_reviewed > 0
            ? `${Math.round(100 * totals.cards_known / totals.cards_reviewed)}% marked "Got it"`
            : 'Review a flashcard deck'}
        />
        <Tooltip content="Open your documents" className="w-full block">
          <button onClick={() => onChangeView(AppView.DOCUMENTS)} className="w-full h-full text-left" data-cursor="Library">
            <StatTile
              delay={240}
              icon={Library}
              iconClass="bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/30"
              label="Study sets saved"
              value={totals ? <CountUp value={totals.study_sets} /> : loader}
              detail={`From ${documents.length} document${documents.length === 1 ? '' : 's'}`}
            />
          </button>
        </Tooltip>
      </div>

      {progress && <MotivationRow progress={progress} onOpenSet={onOpenSet} />}

      {/* Quick Actions */}
      <div className="mb-12">
        <div className="flex items-end justify-between mb-6">
          <div>
            <Reveal><span className="page-eyebrow text-primary-600">Jump back in</span></Reveal>
            <RevealText as="h3" text="Quick actions" accent={['actions']} className="text-3xl font-display font-bold text-slate-900 mt-2 tracking-tight" />
          </div>
          <Reveal delay={200}><Sparkles className="w-6 h-6 text-primary-400 animate-spin-slow" /></Reveal>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <Reveal delay={0}><ActionCard index="01" featured icon={Plus} title="Upload file" subtitle="Add to your knowledge base" onClick={() => onChangeView(AppView.DOCUMENTS)} accent="" cursor="Upload" /></Reveal>
          <Reveal delay={90}><ActionCard index="02" icon={GraduationCap} title="Practice quiz" subtitle="Test your knowledge" onClick={() => onChangeView(AppView.QUIZ)} accent="bg-indigo-100 text-indigo-600" cursor="Quiz me" /></Reveal>
          <Reveal delay={180}><ActionCard index="03" icon={Zap} title="Flashcards" subtitle="Memorize concepts" onClick={() => onChangeView(AppView.FLASHCARDS)} accent="bg-amber-100 text-amber-600" cursor="Review" /></Reveal>
          <Reveal delay={270}><ActionCard index="04" icon={BrainCircuit} title="AI tutor" subtitle="Ask anything" onClick={() => onChangeView(AppView.CHAT)} accent="bg-emerald-100 text-emerald-600" cursor="Ask" /></Reveal>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-10">
        <Reveal>
          <div className={`${cardClass} spotlight p-6 h-full`}>
            <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-slate-400" /> Study activity
            </h3>
            <p className="text-xs text-slate-400 mb-4">Quizzes, flashcards, tutoring and chat · last 14 days</p>
            {progress ? <ActivityChart days={progress.daily_activity} /> : <div className="h-40 rounded-2xl shimmer" />}
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className={`${cardClass} spotlight p-6 h-full`}>
            <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Target className="w-5 h-5 text-slate-400" /> Quiz accuracy
            </h3>
            <p className="text-xs text-slate-400 mb-4">Score on each of your recent quiz attempts</p>
            {progress ? <AccuracyTrend points={progress.quiz_trend} /> : <div className="h-40 rounded-2xl shimmer" />}
          </div>
        </Reveal>
      </div>

      {/* Mastery + recent sets */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-12">
        <Reveal className="lg:col-span-3">
          <div className={`${cardClass} spotlight p-6 h-full`}>
            <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-slate-400" /> Mastery by document
            </h3>
            <p className="text-xs text-slate-400 mb-5">Based on your last 3 quiz, exam and teach-back scores (70%) and flashcard reviews (30%)</p>
            {progress ? <MasteryList items={progress.mastery} /> : <Loader2 className="w-6 h-6 text-slate-300 animate-spin mx-auto" />}
          </div>
        </Reveal>
        <Reveal delay={120} className="lg:col-span-2">
          <div className={`${cardClass} spotlight p-6 h-full`}>
            <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Library className="w-5 h-5 text-slate-400" /> Recent study sets
            </h3>
            {progress && progress.recent_sets.filter(set => set.kind !== 'study_group').length > 0 ? (
              <ul className="space-y-1 stagger">
                {progress.recent_sets.filter(set => set.kind !== 'study_group').map(set => {
                  const meta = KIND_META[set.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={set.id}>
                      <button
                        onClick={() => onOpenSet(set)}
                        data-cursor="Open"
                        className="w-full flex items-center gap-3 p-2.5 -mx-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left group"
                      >
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-500 ease-out-expo group-hover:scale-110 ${meta.tone}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-800 truncate text-sm">{set.title}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {meta.label} · {set.document_title}
                            {set.kind === 'quiz' && set.best_score_pct !== null && ` · best ${set.best_score_pct}%`}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-1 transition-all duration-300" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 py-6 text-center">
                {progress ? 'Generate a quiz, deck, plan, exam or mind map — it will be saved here.' : 'Loading...'}
              </p>
            )}
          </div>
        </Reveal>
      </div>

      {/* Recent Documents */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <Reveal><span className="page-eyebrow text-slate-500 flex items-center gap-2"><Clock className="w-3.5 h-3.5" /> Library</span></Reveal>
          <RevealText as="h3" text="Recent documents" accent={['documents']} className="text-3xl font-display font-bold text-slate-900 mt-2 tracking-tight" />
        </div>
        <Reveal delay={150}>
          <button onClick={() => onChangeView(AppView.DOCUMENTS)} className="roll-host text-sm font-bold text-primary-600 hover:text-primary-700 flex items-center gap-1">
            <RollText text="View all" /> <ArrowUpRight className="w-4 h-4" />
          </button>
        </Reveal>
      </div>
      <Reveal>
        <div className={`${cardClass} overflow-hidden`}>
          {documents.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/60 border-b border-slate-100">
                <tr>
                  <th className="px-6 md:px-8 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-[0.14em]">Name</th>
                  <th className="px-6 md:px-8 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-[0.14em]">Type</th>
                  <th className="hidden sm:table-cell px-6 md:px-8 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-[0.14em]">Date Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 stagger">
                {documents.slice(0, 5).map(doc => (
                  <tr key={doc.id} className="hover:bg-primary-50/40 transition-colors duration-300 group">
                    <td className="px-6 md:px-8 py-4">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-primary-100 text-slate-400 group-hover:text-primary-600 flex items-center justify-center transition-colors duration-300 flex-shrink-0">
                          <FileText className="w-4 h-4" />
                        </span>
                        <span className="font-semibold text-slate-900 group-hover:text-primary-700 transition-colors truncate">{doc.title}</span>
                      </div>
                    </td>
                    <td className="px-6 md:px-8 py-4">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 uppercase tracking-wide">
                        {doc.type}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-6 md:px-8 py-4 text-slate-500 text-sm font-medium">{new Date(doc.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center">
              <FileText className="w-12 h-12 mb-4 text-slate-200 animate-float" />
              <p className="font-medium">No documents found.</p>
              <p className="text-sm mt-1">Start by uploading one!</p>
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
};
