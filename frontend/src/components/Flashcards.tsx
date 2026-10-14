
import React, { useEffect, useState } from 'react';
import { AiThinking } from './AiThinking';
import { ToolHero } from './ToolHero';
import { CardSchedule, DocumentFile, DueQueue, Flashcard, ReviewRating, StudySet, StudySetSummary } from '../types';
import { aiAPI, reviewAPI, studySetsAPI, getErrorMessage } from '../services/api';
import { useSelectedDocument } from '../hooks/useSelectedDocument';
import { useInitialStudySet } from '../hooks/useInitialStudySet';
import { Tooltip } from './Tooltip';
import { SavedSets } from './SavedSets';
import { CountUp } from '../motion';
import { Confetti } from './Confetti';
import { AlertCircle, Zap, RotateCw, ArrowLeft, ArrowRight, Loader2, Layers, ChevronRight, Trophy, RotateCcw, CalendarCheck, PartyPopper } from 'lucide-react';

interface FlashcardsProps {
  documents: DocumentFile[];
  initialSetId?: string | null;
  onInitialSetConsumed?: () => void;
  /** Start the cross-deck daily review as soon as the screen opens */
  startReview?: boolean;
  onStartReviewConsumed?: () => void;
}

/** A card in the current session, with where it came from and its review schedule */
interface SessionCard {
  setId: string;
  cardIndex: number;
  card: Flashcard;
  schedule?: CardSchedule;
  source?: string;
}

interface SessionSummary {
  known: number;
  total: number;
  saved: boolean;
  /** Earliest next review among the cards just rated, for the summary message */
  nextDueAt: number | null;
}

const RATING_BUTTONS: { rating: ReviewRating; label: string; className: string }[] = [
  { rating: 'again', label: 'Again', className: 'bg-white border-2 border-rose-100 text-rose-600 hover:bg-rose-50 hover:border-rose-200' },
  { rating: 'hard', label: 'Hard', className: 'bg-white border-2 border-amber-100 text-amber-700 hover:bg-amber-50 hover:border-amber-200' },
  { rating: 'good', label: 'Good', className: 'bg-emerald-500 border-2 border-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/25' },
  { rating: 'easy', label: 'Easy', className: 'bg-white border-2 border-sky-100 text-sky-700 hover:bg-sky-50 hover:border-sky-200' },
];

/** Human-friendly interval for the rating buttons, e.g. "10m", "3d", "2mo" */
const formatInterval = (days: number) => {
  if (days <= 0) return '10m';
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
};

const formatDue = (ms: number) => {
  const diffDays = (ms - Date.now()) / (24 * 60 * 60 * 1000);
  if (diffDays <= 0) return 'now';
  if (diffDays < 1) return 'later today';
  if (diffDays < 2) return 'tomorrow';
  return `in ${formatInterval(diffDays)}`;
};

export const Flashcards: React.FC<FlashcardsProps> = ({ documents, initialSetId, onInitialSetConsumed, startReview, onStartReviewConsumed }) => {
  const [selectedDocId, setSelectedDocId] = useSelectedDocument(documents);
  const [activeSet, setActiveSet] = useState<StudySet<Flashcard[]> | null>(null);
  const [isDailyReview, setIsDailyReview] = useState(false);
  // Cards in the current session (a deck, its missed cards, or today's review queue)
  const [sessionCards, setSessionCards] = useState<SessionCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [ratings, setRatings] = useState<Record<number, ReviewRating>>({});
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [cardCount, setCardCount] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [dueQueue, setDueQueue] = useState<DueQueue | null>(null);

  const inSession = sessionCards.length > 0;

  const refreshDueQueue = () => {
    reviewAPI.getDue()
      .then(setDueQueue)
      .catch(err => console.error('Failed to load review queue:', err));
  };

  // Load today's review queue whenever the setup screen is visible
  useEffect(() => {
    if (!inSession && !isGenerating) refreshDueQueue();
  }, [inSession, isGenerating]);

  const startSession = (cards: SessionCard[]) => {
    setSessionCards(cards);
    setCurrentIndex(0);
    setIsFlipped(false);
    setRatings({});
    setSummary(null);
  };

  const openDeck = async (set: StudySet<Flashcard[]>) => {
    setActiveSet(set);
    setIsDailyReview(false);
    setError(null);
    setSelectedDocId(set.document_id);
    let schedule: CardSchedule[] = [];
    try {
      schedule = await studySetsAPI.getSchedule(set.id);
    } catch (err) {
      console.error('Failed to load deck schedule:', err);
    }
    startSession(set.data.map((card, i) => ({ setId: set.id, cardIndex: i, card, schedule: schedule[i] })));
  };

  useInitialStudySet<Flashcard[]>(initialSetId, set => { openDeck(set); }, setError, onInitialSetConsumed);

  const startDailyReview = async () => {
    setIsLoadingSession(true);
    setError(null);
    try {
      const queue = await reviewAPI.getDue();
      setDueQueue(queue);
      if (queue.cards.length === 0) return;
      setActiveSet(null);
      setIsDailyReview(true);
      startSession(queue.cards.map(c => ({
        setId: c.study_set_id,
        cardIndex: c.card_index,
        card: { front: c.front, back: c.back },
        schedule: c.schedule,
        source: `${c.study_set_title} · ${c.document_title}`,
      })));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load your review queue.'));
    } finally {
      setIsLoadingSession(false);
    }
  };

  // Dashboard "Start review" lands here
  useEffect(() => {
    if (startReview) {
      startDailyReview();
      onStartReviewConsumed?.();
    }
  }, [startReview]);

  const handleOpenSaved = async (summarySet: StudySetSummary) => {
    try {
      await openDeck(await studySetsAPI.get<Flashcard[]>(summarySet.id));
    } catch (err) {
      setError(getErrorMessage(err, "Failed to open the saved deck."));
    }
  };

  const handleGenerate = async () => {
    const doc = documents.find(d => d.id === selectedDocId);
    if (!doc) return;

    setIsGenerating(true);
    setError(null);
    setSessionCards([]);

    try {
      const set = await aiAPI.generateFlashcards(doc.id, cardCount);
      if (set.data.length === 0) throw new Error("No flashcards generated");
      await openDeck(set);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err, "Failed to generate flashcards. Please try again."));
    } finally {
      setIsGenerating(false);
    }
  };

  /** Send ratings to the server (grouped by deck) so schedules and progress update. */
  const saveRatings = async (sessionRatings: Record<number, ReviewRating>): Promise<{ saved: boolean; nextDueAt: number | null }> => {
    const byDeck = new Map<string, { card_index: number; rating: ReviewRating }[]>();
    Object.entries(sessionRatings).forEach(([position, rating]) => {
      const card = sessionCards[Number(position)];
      if (!card) return;
      if (!byDeck.has(card.setId)) byDeck.set(card.setId, []);
      byDeck.get(card.setId)!.push({ card_index: card.cardIndex, rating });
    });
    if (byDeck.size === 0) return { saved: false, nextDueAt: null };

    try {
      const results = await Promise.all(
        Array.from(byDeck.entries()).map(([setId, deckRatings]) => studySetsAPI.submitReviews(setId, deckRatings))
      );
      // Refresh schedules shown on the cards of this session
      const schedules = new Map<string, CardSchedule[]>();
      Array.from(byDeck.keys()).forEach((setId, i) => schedules.set(setId, results[i].schedule));
      setSessionCards(prev => prev.map(c => ({ ...c, schedule: schedules.get(c.setId)?.[c.cardIndex] ?? c.schedule })));

      const ratedDue = Array.from(byDeck.entries()).flatMap(([setId, deckRatings]) =>
        deckRatings.map(r => schedules.get(setId)?.[r.card_index]?.due_at ?? null)
      ).filter((d): d is number => d !== null && d > Date.now() + 15 * 60 * 1000);
      return { saved: true, nextDueAt: ratedDue.length ? Math.min(...ratedDue) : null };
    } catch (err) {
      console.error('Failed to save reviews:', err);
      return { saved: false, nextDueAt: null };
    }
  };

  const finishSession = async (sessionRatings: Record<number, ReviewRating>) => {
    setIsSaving(true);
    const values = Object.values(sessionRatings);
    const { saved, nextDueAt } = await saveRatings(sessionRatings);
    setIsSaving(false);
    setSummary({ known: values.filter(r => r !== 'again').length, total: values.length, saved, nextDueAt });
  };

  const rateCard = (rating: ReviewRating) => {
    const updated = { ...ratings, [currentIndex]: rating };
    setRatings(updated);
    if (Object.keys(updated).length === sessionCards.length) {
      finishSession(updated);
    } else {
      // Move to the next unrated card
      const next = sessionCards.findIndex((_, i) => i > currentIndex && updated[i] === undefined);
      const target = next !== -1 ? next : sessionCards.findIndex((_, i) => updated[i] === undefined);
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex(target), 300); // wait for flip back
    }
  };

  const reviewMissed = () => {
    const missed = sessionCards.filter((_, i) => ratings[i] === 'again');
    if (missed.length) startSession(missed);
  };

  const exitDeck = () => {
    // Keep partial progress if the student rated some cards before leaving
    if (!summary && Object.keys(ratings).length > 0) saveRatings(ratings);
    setSessionCards([]);
    setActiveSet(null);
    setIsDailyReview(false);
    setSummary(null);
    setRatings({});
    setIsGenerating(false);
  };

  const nextCard = () => {
    if (currentIndex < sessionCards.length - 1) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex(c => c + 1), 300); // wait for flip back
    }
  };

  const prevCard = () => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex(c => c - 1), 300);
    }
  };

  const current = sessionCards[currentIndex];

  const scheduleBadge = (schedule?: CardSchedule) => {
    if (!schedule) return null;
    if (schedule.is_new) return { text: 'New', className: 'bg-sky-50 text-sky-600' };
    if (schedule.due_at !== null && schedule.due_at <= Date.now()) return { text: 'Due', className: 'bg-rose-50 text-rose-600' };
    return { text: `Next review ${formatDue(schedule.due_at ?? Date.now())}`, className: 'bg-slate-100 text-slate-500' };
  };

  if (documents.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
      <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
             <AlertCircle className="w-10 h-10 text-slate-300" />
        </div>
      <h3 className="text-xl font-semibold text-slate-700">Flashcards</h3>
      <p className="text-slate-400 mt-2">Upload a document to create a study deck.</p>
    </div>
  );

  const reviewCount = dueQueue ? dueQueue.cards.length : 0;

  return (
    <div className="max-w-5xl mx-auto p-8 h-full flex flex-col animate-fade-in">

      {!inSession && !isGenerating && (
        <div className="flex flex-col items-center text-center mt-10">
             <ToolHero
               icon={Zap}
               gradient="from-amber-400 to-orange-500"
               glow="bg-amber-400"
               eyebrow="Spaced repetition"
               tone="text-amber-600"
               title="Flashcards"
               accent={['Flashcards']}
               subtitle="Master concepts through spaced repetition. MindAI schedules each card for review right before you'd forget it."
             />

            {/* Daily review across all decks */}
            <div className="w-full max-w-md mb-6 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-3xl shadow-xl p-6 text-left relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-500 rounded-full blur-3xl opacity-20"></div>
              <div className="relative z-10 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  {reviewCount > 0 ? <CalendarCheck className="w-6 h-6 text-amber-300" /> : <PartyPopper className="w-6 h-6 text-emerald-300" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Daily review</p>
                  {dueQueue === null ? (
                    <p className="font-semibold text-slate-300">Checking your schedule...</p>
                  ) : reviewCount > 0 ? (
                    <p className="font-semibold">
                      {dueQueue.due_count} due{dueQueue.new_count > 0 && ` · ${Math.min(dueQueue.new_count, reviewCount - dueQueue.due_count)} new`}
                    </p>
                  ) : (
                    <p className="font-semibold">All caught up! Nothing to review right now.</p>
                  )}
                </div>
                {reviewCount > 0 && (
                  <button
                    onClick={startDailyReview}
                    disabled={isLoadingSession}
                    className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm transition-colors disabled:opacity-60 flex items-center gap-2"
                  >
                    {isLoadingSession && <Loader2 className="w-4 h-4 animate-spin" />}
                    Start
                  </button>
                )}
              </div>
            </div>

            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden text-left tool-card spotlight">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-400 to-orange-500"></div>

                 <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Select Source Material</label>
                    <Tooltip content="Choose a document source" position="top" className="w-full block">
                        <div className="relative">
                            <select
                                value={selectedDocId}
                                onChange={(e) => setSelectedDocId(e.target.value)}
                                className="w-full appearance-none rounded-xl border-slate-200 bg-slate-50 py-4 px-4 text-slate-700 font-medium focus:border-amber-500 focus:ring-amber-500 focus:bg-white transition-colors"
                            >
                                {documents.map(doc => (
                                <option key={doc.id} value={doc.id}>{doc.title}</option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                <ChevronRight className="w-5 h-5 rotate-90" />
                            </div>
                        </div>
                    </Tooltip>
                 </div>

                 <div className="mb-8">
                    <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide flex justify-between">
                        <span>Deck Size</span>
                        <span className="text-amber-600">{cardCount} Cards</span>
                    </label>
                    <Tooltip content={`Generate ${cardCount} flashcards`} position="top" className="w-full block">
                        <input
                            type="range"
                            min="5"
                            max="30"
                            value={cardCount}
                            onChange={(e) => setCardCount(parseInt(e.target.value))}
                            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                    </Tooltip>
                    <div className="flex justify-between text-xs text-slate-400 mt-2 font-medium">
                        <span>5</span>
                        <span>30</span>
                    </div>
                 </div>

                  <Tooltip content="Generate Flashcards" position="bottom" className="w-full">
                    <button
                        onClick={handleGenerate}
                        className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white py-4 rounded-xl font-semibold shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group"
                    >
                        <span>Generate Deck</span>
                        <Layers className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
                    </button>
                  </Tooltip>
                  {error && <p className="text-red-500 mt-4 text-sm font-medium bg-red-50 p-2 rounded-lg">{error}</p>}
            </div>

            <SavedSets kind="flashcards" documentId={selectedDocId} onOpen={handleOpenSaved} accent="text-amber-600 hover:bg-amber-50" />
        </div>
      )}

      {isGenerating && (
        <AiThinking title="Generating Deck..." subtitle="Identifying key concepts and definitions." color="#f59e0b" steps={['Reading your document', 'Picking key terms', 'Writing the cards']} />
      )}

      {/* Saving the final ratings */}
      {isSaving && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
        </div>
      )}

      {/* Session complete */}
      {summary && !isSaving && (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[500px] animate-scale-in">
          <div className="relative overflow-hidden w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-10 text-center">
            {summary.known / summary.total >= 0.6 && <Confetti />}
            <div className="relative w-20 h-20 mx-auto mb-6">
              <span className="absolute inset-0 rounded-3xl bg-amber-400/50 animate-ping"></span>
              <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30 animate-pop">
                <Trophy className="w-10 h-10 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-display font-bold text-slate-900 mb-2">
              {isDailyReview ? 'Review complete' : 'Session complete'}
            </h2>
            <p className="text-slate-500 mb-6">
              You remembered <CountUp value={summary.known} className="font-bold text-slate-900" /> of {summary.total} cards
              ({Math.round(100 * summary.known / summary.total)}%).
            </p>
            <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden mb-4" role="img" aria-label={`${summary.known} of ${summary.total} remembered`}>
              <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full origin-left animate-[barX_1.4s_cubic-bezier(0.16,1,0.3,1)_0.3s_backwards]" style={{ width: `${100 * summary.known / summary.total}%` }}></div>
            </div>
            {summary.saved ? (
              summary.nextDueAt && (
                <p className="text-sm text-slate-500 mb-8">Your next scheduled review is <span className="font-semibold text-slate-700">{formatDue(summary.nextDueAt)}</span>.</p>
              )
            ) : (
              <p className="text-xs text-slate-400 mb-8">This session couldn't be saved to your progress.</p>
            )}
            <div className="space-y-3">
              {summary.known < summary.total && (
                <button onClick={reviewMissed} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white py-3 rounded-xl font-semibold shadow-lg shadow-amber-500/25 hover:scale-[1.02] transition-all flex items-center justify-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Practice {summary.total - summary.known} missed card{summary.total - summary.known === 1 ? '' : 's'}
                </button>
              )}
              {activeSet && (
                <button onClick={() => openDeck(activeSet)} className="w-full bg-slate-100 text-slate-700 py-3 rounded-xl font-semibold hover:bg-slate-200 transition-colors">
                  Study the whole deck again
                </button>
              )}
              <button onClick={exitDeck} className="w-full text-sm font-bold text-slate-400 hover:text-slate-700 py-2 transition-colors">
                {isDailyReview ? 'Done' : 'Exit deck'}
              </button>
            </div>
          </div>
        </div>
      )}

      {inSession && !summary && !isSaving && current && (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[600px]">
          {/* Header Controls */}
          <div className="w-full max-w-2xl flex justify-between items-center mb-3">
            <div className="flex items-center gap-3">
                <div className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 font-bold text-sm">
                    {isDailyReview ? 'Daily review' : 'Card'} {currentIndex + 1} / {sessionCards.length}
                </div>
                <Tooltip content={`${Object.keys(ratings).length} of ${sessionCards.length} rated`}>
                  <div className="h-2 w-24 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700 ease-out-expo" style={{width: `${(Object.keys(ratings).length / sessionCards.length) * 100}%`}}></div>
                  </div>
                </Tooltip>
                {(() => {
                  const badge = ratings[currentIndex]
                    ? { text: `Rated ${ratings[currentIndex]}`, className: ratings[currentIndex] === 'again' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600' }
                    : scheduleBadge(current.schedule);
                  return badge && <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${badge.className}`}>{badge.text}</span>;
                })()}
            </div>
            <button onClick={exitDeck} className="text-sm font-bold text-slate-400 hover:text-slate-700 transition-colors">
              {isDailyReview ? 'End review' : 'Exit Deck'}
            </button>
          </div>
          <p className="w-full max-w-2xl text-xs text-slate-400 mb-6 truncate">
            {current.source || activeSet?.title}
          </p>

          {/* Card Container */}
          <div
            key={currentIndex}
            className="relative h-96 w-full max-w-2xl cursor-pointer perspective-1000 group card-deal isolate"
            onClick={() => setIsFlipped(!isFlipped)}
            data-cursor={isFlipped ? 'Flip back' : 'Flip'}
          >
             <div className="absolute inset-x-6 -bottom-3 h-full rounded-3xl bg-amber-100/70 border border-amber-200/60 -z-10 rotate-[-1.5deg]"></div>
             <div className="absolute inset-x-12 -bottom-6 h-full rounded-3xl bg-amber-50 border border-amber-100 -z-20 rotate-[1.5deg]"></div>
             <div className={`relative w-full h-full transition-transform duration-[900ms] ease-out-expo transform-style-3d ${isFlipped ? 'rotate-y-180 group-hover:[transform:rotateY(180deg)_rotateX(-4deg)]' : 'group-hover:[transform:rotateX(4deg)]'}`}>
                {/* Front */}
                <div className="absolute w-full h-full bg-[#fffdf8] rounded-3xl shadow-xl border border-stone-200 p-10 flex flex-col items-center justify-center text-center backface-hidden">
                    {/* Paper Texture Effect */}
                    <div className="absolute inset-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/cardboard-flat.png')] rounded-3xl"></div>

                   <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center mb-6">
                        <span className="font-bold text-lg">Q</span>
                   </div>
                   <p className="text-2xl md:text-3xl text-slate-800 font-display font-bold leading-snug">{current.card.front}</p>
                   <p className="absolute bottom-8 text-xs font-bold text-slate-300 uppercase tracking-widest">Click to flip</p>
                </div>

                {/* Back */}
                <div className="absolute w-full h-full bg-slate-900 rounded-3xl shadow-2xl border border-slate-800 p-10 flex flex-col items-center justify-center text-center backface-hidden rotate-y-180 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600 rounded-full blur-[80px] opacity-20"></div>
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-amber-500 rounded-full blur-[80px] opacity-20"></div>

                   <div className="relative z-10 w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-6 border border-emerald-500/30">
                        <span className="font-bold text-lg">A</span>
                   </div>
                   <p className="relative z-10 text-xl md:text-2xl text-slate-100 font-medium leading-relaxed">{current.card.back}</p>
                </div>
             </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6 mt-10">
             <Tooltip content="Previous card">
                <button
                onClick={(e) => {e.stopPropagation(); prevCard();}}
                disabled={currentIndex === 0}
                className="p-4 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:scale-110 disabled:opacity-30 disabled:hover:scale-100 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                <ArrowLeft className="w-6 h-6" />
                </button>
             </Tooltip>

             <Tooltip content="Flip card">
                <button
                onClick={(e) => {e.stopPropagation(); setIsFlipped(!isFlipped);}}
                className="p-6 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/40 hover:shadow-amber-500/60 hover:scale-105 active:scale-95 transition-all"
                >
                <RotateCw className={`w-8 h-8 ${isFlipped ? 'rotate-180' : ''} transition-transform duration-500`} />
                </button>
             </Tooltip>

            <Tooltip content="Next card">
                <button
                onClick={(e) => {e.stopPropagation(); nextCard();}}
                disabled={currentIndex === sessionCards.length - 1}
                className="p-4 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:scale-110 disabled:opacity-30 disabled:hover:scale-100 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                <ArrowRight className="w-6 h-6" />
                </button>
            </Tooltip>
          </div>

          {/* Spaced-repetition rating: shown once the answer has been revealed */}
          <div className={`grid grid-cols-4 gap-3 w-full max-w-xl mt-8 transition-all duration-500 ease-out-expo ${isFlipped ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            {RATING_BUTTONS.map(({ rating, label, className }) => (
              <button
                key={rating}
                onClick={() => rateCard(rating)}
                className={`flex flex-col items-center py-2.5 rounded-xl font-bold transition-all duration-300 hover:-translate-y-1 hover:shadow-md ${className}`}
              >
                <span>{label}</span>
                {current.schedule && (
                  <span className="text-[11px] font-semibold opacity-75">{formatInterval(current.schedule.next_intervals[rating])}</span>
                )}
              </button>
            ))}
          </div>
          {!isFlipped && (
            <p className="text-xs text-slate-400 mt-4">Flip the card, then rate how well you remembered it.</p>
          )}
        </div>
      )}
      <style>{`
        .perspective-1000 { perspective: 1000px; }
        .transform-style-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
        .rotate-y-180 { transform: rotateY(180deg); }
      `}</style>
    </div>
  );
};
