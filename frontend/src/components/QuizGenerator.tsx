import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { ToolHero } from './ToolHero';
import { SavedSets } from './SavedSets';
import { SourceDialog } from './SourceDialog';
import { TutorDrawer } from './TutorDrawer';
import { AiThinking } from './AiThinking';
import { DocumentFile, Source, StudySet, StudySetSummary } from '../types';
import { assessmentAPI, studySetsAPI, getErrorMessage } from '../services/api';
import { useSelectedDocument } from '../hooks/useSelectedDocument';
import { useInitialStudySet } from '../hooks/useInitialStudySet';
import { normalizeQuiz, reshuffleOptions, seededShuffle } from '../assessment/schema';
import { gradeLocally, answerText } from '../assessment/grading';
import { AnswerValue, AttemptResult, GenerationEvent, ItemResult, Question, ResponseItem } from '../assessment/types';
import { QuizSetup } from './quiz/QuizSetup';
import { PlayConfig, QuizEditor } from './quiz/QuizEditor';
import { QuizPlayer } from './quiz/QuizPlayer';
import { QuizResults } from './quiz/QuizResults';
import { QuestionBankPanel } from './quiz/QuestionBankPanel';
import { GraduationCap } from 'lucide-react';

interface QuizGeneratorProps {
  documents: DocumentFile[];
  initialSetId?: string | null;
  onInitialSetConsumed?: () => void;
  onOpenInReader?: (source: Source) => void;
}

type Stage = 'setup' | 'ready' | 'playing' | 'grading' | 'results';

/** The student's answer as text, for the tutor. */
const describeAnswer = (q: Question, answer: AnswerValue): string => {
  if (answer === null || answer === undefined) return '(no answer)';
  switch (q.type) {
    case 'multi_select':
      return (answer as number[]).map(i => q.options?.[i]).filter(Boolean).join('; ') || '(none selected)';
    case 'fill_blank':
      return (answer as string[]).join('; ');
    case 'matching':
      return (answer as number[]).map((ri, li) => `${q.left?.[li]} → ${ri >= 0 ? q.right?.[ri] : '?'}`).join('; ');
    case 'ordering':
      return (answer as number[]).map(i => q.items?.[i]).join(' → ');
    default:
      return String(answer);
  }
};

export const QuizGenerator: React.FC<QuizGeneratorProps> = ({ documents, initialSetId, onInitialSetConsumed, onOpenInReader }) => {
  const [selectedDocId, setSelectedDocId] = useSelectedDocument(documents);
  const [stage, setStage] = useState<Stage>('setup');
  const [activeSet, setActiveSet] = useState<StudySet<unknown> | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [playQuestions, setPlayQuestions] = useState<Question[]>([]);
  const [config, setConfig] = useState<PlayConfig>({ mode: 'practice', timeLimit: null, shuffle: false, lives: 3 });
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [attempt, setAttempt] = useState<AttemptResult | null>(null);
  const [fallback, setFallback] = useState<ItemResult[] | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [tutor, setTutor] = useState<{ q: Question; answer: AnswerValue } | null>(null);
  const [playKey, setPlayKey] = useState(0);

  const openSet = (set: StudySet<unknown>) => {
    setActiveSet(set);
    setQuestions(normalizeQuiz(set.data));
    setSelectedDocId(set.document_id);
    setError(null);
    setStage('ready');
  };

  useInitialStudySet<unknown>(initialSetId, openSet, setError, onInitialSetConsumed);

  const handleOpenSaved = async (summary: StudySetSummary) => {
    try {
      openSet(await studySetsAPI.get<unknown>(summary.id));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to open the saved quiz.'));
    }
  };

  const play = (list: Question[], cfg: PlayConfig) => {
    const seed = `${Date.now()}`;
    const ordered = cfg.shuffle ? seededShuffle(list, seed).map(q => reshuffleOptions(q, seed)) : list;
    setPlayQuestions(ordered);
    setConfig(cfg);
    setAttempt(null);
    setFallback(null);
    setSaveWarning(null);
    setPlayKey(k => k + 1);
    setStage('playing');
  };

  const handleFinish = async (items: ResponseItem[], duration: number, instant: Record<string, ItemResult>) => {
    if (!activeSet) return;
    setResponses(items);
    setDurationMs(duration);
    setStage('grading');
    try {
      const result = await assessmentAPI.submitAttempt(activeSet.id, config.mode, items, duration);
      setAttempt(result);
      setActiveSet(prev => prev && {
        ...prev,
        attempts: prev.attempts + 1,
        best_score_pct: Math.max(prev.best_score_pct ?? 0, result.score_pct),
        last_score_pct: result.score_pct,
      });
    } catch (err) {
      // Show results graded on this device, and say the attempt wasn't saved
      const byId = new Map(playQuestions.map(q => [q.id, q]));
      setFallback(items.map(item => {
        if (instant[item.qid]) return instant[item.qid];
        const q = byId.get(item.qid)!;
        const g = gradeLocally(q, item.answer);
        return { qid: item.qid, score: g.score, correct: g.correct, feedback: g.needsAi ? 'Could not be marked without the server.' : '', expected: answerText(q) };
      }));
      setSaveWarning(getErrorMessage(err, "Your score couldn't be saved to your progress."));
    }
    setStage('results');
  };

  const retake = (how: 'shuffle' | 'wrong') => {
    if (how === 'shuffle') return play(questions, { ...config, mode: config.mode === 'review' ? 'practice' : config.mode, shuffle: true });
    const results = attempt?.results || fallback || [];
    const wrong = new Set(results.filter(r => !r.correct).map(r => r.qid));
    play(questions.filter(q => wrong.has(q.id)), { mode: 'review', timeLimit: null, shuffle: true, lives: 3 });
  };

  // Stop generating fresh questions if the user leaves the quiz screen
  const variantAbort = useRef<AbortController | null>(null);
  useEffect(() => () => variantAbort.current?.abort(), []);

  const variant = async (qids: string[]) => {
    if (!activeSet) return;
    let created: StudySet<unknown> | null = null;
    const controller = new AbortController();
    variantAbort.current = controller;
    try {
      await assessmentAPI.streamVariant(activeSet.id, qids, (event: GenerationEvent) => {
        if (event.type === 'done') created = event.set;
      }, controller.signal);
      if (created) openSet(created);
    } catch (err) {
      if (controller.signal.aborted) return;
      setSaveWarning(getErrorMessage(err, 'Could not create fresh questions.'));
    } finally {
      if (variantAbort.current === controller) variantAbort.current = null;
    }
  };

  const toFlashcards = async (qids: string[]) => {
    if (!activeSet) return '';
    try {
      const deck = await assessmentAPI.toFlashcards(activeSet.id, qids);
      return `Added to the flashcard deck “${deck.title}” (${deck.item_count} cards). They'll show up in your daily review.`;
    } catch (err) {
      return getErrorMessage(err, 'Could not create flashcards.');
    }
  };

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
          <AlertCircle className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-semibold text-slate-700">Knowledge Check</h3>
        <p className="text-slate-400 mt-2">Upload a document to start generating quizzes.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-5 md:p-8 pb-20">
      {stage === 'setup' && (
        <div className="flex flex-col items-center text-center mt-4">
          <ToolHero
            icon={GraduationCap}
            gradient="from-indigo-500 to-primary-600"
            glow="bg-indigo-400"
            eyebrow="Test yourself"
            tone="text-indigo-600"
            title="Knowledge Check"
            accent={['Check']}
            subtitle="Eight question types, difficulty and thinking-level control, questions from the whole document - every one cited to its source."
          />
          <QuizSetup documents={documents} primaryDocId={selectedDocId} onPrimaryDocChange={setSelectedDocId} onReady={openSet} />
          {error && <p className="mt-4 text-sm text-rose-600 bg-rose-50 rounded-xl p-3">{error}</p>}
          <QuestionBankPanel documentId={selectedDocId} onOpen={openSet} />
          <SavedSets kind="quiz" documentId={selectedDocId} onOpen={handleOpenSaved} accent="text-primary-600 hover:bg-primary-50" />
        </div>
      )}

      {stage !== 'setup' && stage !== 'playing' && (
        <button onClick={() => { setStage('setup'); setActiveSet(null); }} className="no-print mb-4 flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> New quiz
        </button>
      )}

      {stage === 'ready' && activeSet && (
        <QuizEditor
          set={activeSet}
          questions={questions}
          onQuestionsChange={(qs, set) => { setQuestions(qs); if (set) setActiveSet(set); }}
          onStart={cfg => play(questions, cfg)}
          onOpenSource={setSource}
        />
      )}

      {stage === 'playing' && activeSet && (
        <QuizPlayer
          key={playKey}
          setId={activeSet.id}
          title={activeSet.title}
          questions={playQuestions}
          config={config}
          onFinish={handleFinish}
          onExit={() => setStage('ready')}
          onOpenSource={setSource}
        />
      )}

      {stage === 'grading' && (
        <AiThinking title="Marking your answers…" subtitle="Checking every answer and working out where you stand." color="#7c3aed"
          steps={['Checking your answers', 'Marking written answers', 'Building your report']} />
      )}

      {stage === 'results' && activeSet && (
        <QuizResults
          title={activeSet.title}
          mode={config.mode}
          questions={playQuestions}
          responses={responses}
          result={attempt}
          fallback={fallback}
          saveWarning={saveWarning}
          durationMs={durationMs}
          onRetake={retake}
          onVariant={variant}
          onToFlashcards={toFlashcards}
          onNewQuiz={() => { setStage('setup'); setActiveSet(null); }}
          onExplain={(q, answer) => setTutor({ q, answer })}
          onOpenSource={setSource}
        />
      )}

      {tutor && activeSet && (
        <TutorDrawer
          documentId={tutor.q.source?.document_id || activeSet.document_id}
          question={tutor.q}
          chosenIndex={typeof tutor.answer === 'number' ? tutor.answer : -1}
          studentAnswer={describeAnswer(tutor.q, tutor.answer)}
          onClose={() => setTutor(null)}
        />
      )}
      {source && (
        <SourceDialog source={source} onClose={() => setSource(null)}
          onOpenInReader={onOpenInReader ? s => { setSource(null); onOpenInReader(s); } : undefined} />
      )}
    </div>
  );
};
