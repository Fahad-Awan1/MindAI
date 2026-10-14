import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, FileSignature } from 'lucide-react';
import { ToolHero } from './ToolHero';
import { SavedSets } from './SavedSets';
import { TutorDrawer } from './TutorDrawer';
import { DocumentFile, StudySet, StudySetSummary } from '../types';
import { examsAPI, studySetsAPI, getErrorMessage } from '../services/api';
import { useInitialStudySet } from '../hooks/useInitialStudySet';
import { useSelectedDocument } from '../hooks/useSelectedDocument';
import { normalizeExam } from '../assessment/schema';
import { ExamAttempt, ExamPaperV2, ExamReport as Report, MarkingEvent, Question, QuestionMark } from '../assessment/types';
import { ExamSetup } from './exam/ExamSetup';
import { ExamPaper } from './exam/ExamPaper';
import { ExamRoom } from './exam/ExamRoom';
import { ExamReport } from './exam/ExamReport';

interface ExamGeneratorProps {
  documents: DocumentFile[];
  initialSetId?: string | null;
  onInitialSetConsumed?: () => void;
}

type Stage = 'setup' | 'paper' | 'room' | 'report';

export const ExamGenerator: React.FC<ExamGeneratorProps> = ({ documents, initialSetId, onInitialSetConsumed }) => {
  const [selectedDocId, setSelectedDocId] = useSelectedDocument(documents);
  const [stage, setStage] = useState<Stage>('setup');
  const [activeSet, setActiveSet] = useState<StudySet<unknown> | null>(null);
  const [exam, setExam] = useState<ExamPaperV2 | null>(null);
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [marking, setMarking] = useState<Record<string, QuestionMark>>({});
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [liveReport, setLiveReport] = useState<Report | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tutor, setTutor] = useState<{ q: Question; answer: string } | null>(null);

  const openSet = (set: StudySet<unknown>) => {
    setActiveSet(set);
    setExam(normalizeExam(set.data));
    setSelectedDocId(set.document_id);
    setAttempt(null);
    setError(null);
    setStage('paper');
  };

  useInitialStudySet<unknown>(initialSetId, openSet, setError, onInitialSetConsumed);

  const reloadPaper = async (setId: string) => {
    const fresh = await studySetsAPI.get<unknown>(setId);
    setActiveSet(fresh);
    setExam(normalizeExam(fresh.data));
  };

  const handleOpenSaved = async (summary: StudySetSummary) => {
    try {
      openSet(await studySetsAPI.get<unknown>(summary.id));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to open the saved exam.'));
    }
  };

  const startExam = async () => {
    if (!activeSet) return;
    setStarting(true);
    setError(null);
    try {
      const started = await examsAPI.start(activeSet.id);
      // While sitting, the paper is re-fetched without the answer key
      await reloadPaper(activeSet.id);
      setAttempt(started);
      setStage('room');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start the exam.'));
    } finally {
      setStarting(false);
    }
  };

  const submit = async (submitted: Record<string, string | number>) => {
    if (!attempt || !activeSet) return;
    setAnswers(submitted);
    setMarking({});
    setMarkingIds(new Set());
    setLiveReport(null);
    setStage('report');
    try {
      let finalAttempt: ExamAttempt | null = null;
      await examsAPI.submitStream(attempt.id, submitted, (event: MarkingEvent) => {
        if (event.type === 'grading') setMarkingIds(prev => new Set(prev).add(event.qid));
        else if (event.type === 'graded') { setWaiting(0); setMarking(prev => ({ ...prev, [event.qid]: event.result })); }
        else if (event.type === 'waiting') setWaiting(event.seconds);
        else if (event.type === 'summary') setLiveReport(event.report);
        else if (event.type === 'done') finalAttempt = event.attempt;
      });
      if (finalAttempt) setAttempt(finalAttempt);
      await reloadPaper(activeSet.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Marking failed - your answers are saved. Open the exam again to resubmit.'));
    }
  };

  const openAttempt = async (summary: ExamAttempt) => {
    try {
      const full = await examsAPI.get(summary.id);
      setAttempt(full);
      setAnswers(full.answers || {});
      setMarking({});
      setLiveReport(null);
      setStage('report');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not open that attempt.'));
    }
  };

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
          <AlertCircle className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-semibold text-slate-700">Exam Paper Generator</h3>
        <p className="text-slate-400 mt-2">Upload a document to create an exam.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-5 md:p-8 pb-20">
      {stage === 'setup' && (
        <div className="flex flex-col items-center text-center mt-4">
          <ToolHero
            icon={FileSignature}
            gradient="from-sky-500 to-blue-600"
            glow="bg-sky-400"
            eyebrow="Formal assessment"
            tone="text-sky-600"
            title="Exam Paper Generator"
            accent={['Paper']}
            subtitle="Design the paper section by section, sit it against the clock, and get it marked against a mark scheme and your notes."
          />
          <ExamSetup documents={documents} primaryDocId={selectedDocId} onPrimaryDocChange={setSelectedDocId} onReady={openSet} />
          {error && <p className="mt-4 text-sm text-rose-600 bg-rose-50 rounded-xl p-3">{error}</p>}
          <SavedSets kind="exam" documentId={selectedDocId} onOpen={handleOpenSaved} accent="text-sky-600 hover:bg-sky-50" />
        </div>
      )}

      {(stage === 'paper' || stage === 'report') && (
        <button onClick={() => (stage === 'report' ? setStage('paper') : (setStage('setup'), setActiveSet(null)))}
          className="no-print mb-4 flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> {stage === 'report' ? 'Back to the paper' : 'New exam'}
        </button>
      )}
      {error && stage !== 'setup' && <p className="mb-4 text-sm text-rose-600 bg-rose-50 rounded-xl p-3 no-print">{error}</p>}

      {stage === 'paper' && activeSet && exam && (
        <ExamPaper key={activeSet.id} setId={activeSet.id} exam={exam} onStart={startExam} onOpenAttempt={openAttempt} starting={starting}
          onSetChange={set => { setActiveSet(set); setExam(normalizeExam(set.data)); }} />
      )}

      {stage === 'room' && exam && attempt && <ExamRoom exam={exam} attempt={attempt} onSubmit={submit} />}

      {stage === 'report' && exam && (
        <ExamReport
          exam={exam}
          attempt={attempt?.status === 'graded' ? attempt : null}
          marking={marking}
          markingIds={markingIds}
          liveReport={liveReport}
          waiting={waiting}
          answers={answers}
          onAttemptChange={setAttempt}
          onRetry={startExam}
          onDiscuss={(q, answer) => setTutor({ q, answer })}
        />
      )}

      {tutor && activeSet && (
        <TutorDrawer documentId={tutor.q.source?.document_id || activeSet.document_id} question={tutor.q} studentAnswer={tutor.answer} onClose={() => setTutor(null)} />
      )}
    </div>
  );
};
