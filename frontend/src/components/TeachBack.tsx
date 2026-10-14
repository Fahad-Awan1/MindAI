import React, { useEffect, useState } from 'react';
import { ToolHero } from './ToolHero';
import { ConceptRequest, DocumentFile, StudySet, StudySetSummary, TeachBackData } from '../types';
import { tutorAPI, studySetsAPI, getErrorMessage } from '../services/api';
import { useSelectedDocument } from '../hooks/useSelectedDocument';
import { useInitialStudySet } from '../hooks/useInitialStudySet';
import { SavedSets } from './SavedSets';
import { VoiceInputButton } from './VoiceInputButton';
import {
  AlertCircle, ChevronRight, Loader2, MessageSquareQuote, CheckCircle2, XCircle, CircleDashed,
  Lightbulb, HelpCircle, RotateCcw, Sparkles
} from 'lucide-react';

interface TeachBackProps {
  documents: DocumentFile[];
  initialSetId?: string | null;
  onInitialSetConsumed?: () => void;
  /** Concept to practise (e.g. from the concept graph) */
  initialConcept?: ConceptRequest | null;
  onInitialConceptConsumed?: () => void;
}

const MIN_CHARS = 20;

const scoreTone = (score: number) =>
  score >= 80 ? { ring: '#10b981', label: 'Strong understanding' }
  : score >= 50 ? { ring: '#f59e0b', label: 'Getting there' }
  : { ring: '#f43f5e', label: 'Needs more work' };

/** Circular score meter (value against 100) */
const ScoreRing: React.FC<{ score: number }> = ({ score }) => {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const tone = scoreTone(score);
  return (
    <div className="relative w-28 h-28 flex-shrink-0" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Explanation score">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={tone.ring} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - score / 100)}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-display font-bold text-slate-900">{score}</span>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">/ 100</span>
      </div>
    </div>
  );
};

const FeedbackList: React.FC<{ title: string; items: string[]; icon: React.ElementType; iconClass: string }> = ({ title, items, icon: Icon, iconClass }) => {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{title}</h4>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
            <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconClass}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const TeachBack: React.FC<TeachBackProps> = ({ documents, initialSetId, onInitialSetConsumed, initialConcept, onInitialConceptConsumed }) => {
  const [selectedDocId, setSelectedDocId] = useSelectedDocument(documents, initialConcept?.documentId);
  const [concepts, setConcepts] = useState<string[]>([]);
  const [conceptsLoading, setConceptsLoading] = useState(false);
  const [concept, setConcept] = useState(initialConcept?.concept ?? '');

  useEffect(() => {
    if (initialConcept) onInitialConceptConsumed?.();
  }, []);
  const [explanation, setExplanation] = useState('');
  const [isGrading, setIsGrading] = useState(false);
  const [result, setResult] = useState<StudySet<TeachBackData> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Suggested concepts for the selected document
  useEffect(() => {
    if (!selectedDocId || result) return;
    let cancelled = false;
    setConceptsLoading(true);
    setConcepts([]);
    tutorAPI.getConcepts(selectedDocId)
      .then(list => { if (!cancelled) setConcepts(list); })
      .catch(err => console.error('Failed to load concepts:', err))
      .finally(() => { if (!cancelled) setConceptsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDocId, result]);

  const openResult = (set: StudySet<TeachBackData>) => {
    setResult(set);
    setSelectedDocId(set.document_id);
    setConcept(set.data.concept);
    setExplanation(set.data.explanation);
    setError(null);
  };

  useInitialStudySet<TeachBackData>(initialSetId, openResult, setError, onInitialSetConsumed);

  const handleOpenSaved = async (summary: StudySetSummary) => {
    try {
      openResult(await studySetsAPI.get<TeachBackData>(summary.id));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to open the saved teach-back.'));
    }
  };

  const handleSubmit = async () => {
    if (!selectedDocId || !concept.trim() || explanation.trim().length < MIN_CHARS) return;
    setIsGrading(true);
    setError(null);
    try {
      setResult(await tutorAPI.teachBack(selectedDocId, concept.trim(), explanation.trim()));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to grade your explanation. Please try again.'));
    } finally {
      setIsGrading(false);
    }
  };

  const tryAgain = () => {
    setResult(null);
    setExplanation('');
  };

  const newConcept = () => {
    setResult(null);
    setConcept('');
    setExplanation('');
  };

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
          <AlertCircle className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-semibold text-slate-700">Teach It Back</h3>
        <p className="text-slate-400 mt-2">Upload a document to practise explaining its concepts.</p>
      </div>
    );
  }

  const wordCount = explanation.trim() ? explanation.trim().split(/\s+/).length : 0;

  // Feedback view
  if (result) {
    const fb = result.data.feedback;
    const tone = scoreTone(fb.score);
    return (
      <div className="max-w-4xl mx-auto p-8 pb-20 animate-fade-in">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="min-w-0">
            <p className="text-xs font-bold text-teal-600 uppercase tracking-wider">Teach-back · {result.document_title}</p>
            <h2 className="text-3xl font-display font-bold text-slate-900 truncate">{result.data.concept}</h2>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={tryAgain} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-bold hover:bg-teal-700 transition-colors">
              <RotateCcw className="w-4 h-4" /> Try again
            </button>
            <button onClick={newConcept} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-colors">
              New concept
            </button>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex flex-col sm:flex-row items-center gap-6 mb-6">
          <ScoreRing score={fb.score} />
          <div className="text-center sm:text-left">
            <p className="text-sm font-bold uppercase tracking-wider" style={{ color: tone.ring }}>{tone.label}</p>
            <p className="text-lg text-slate-700 mt-1">{fb.verdict}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-5">
            <FeedbackList title="What you got right" items={fb.strengths} icon={CheckCircle2} iconClass="text-emerald-500" />
            <FeedbackList title="What you missed" items={fb.gaps} icon={CircleDashed} iconClass="text-amber-500" />
            <FeedbackList title="Misconceptions" items={fb.misconceptions} icon={XCircle} iconClass="text-rose-500" />
          </div>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Your explanation</h4>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{result.data.explanation}</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-3xl border border-teal-100 p-6 mb-6">
          <h4 className="flex items-center gap-2 text-sm font-bold text-teal-800 mb-2">
            <Lightbulb className="w-4 h-4" /> A clear way to explain it
          </h4>
          <p className="text-slate-700 leading-relaxed">{fb.improved_explanation}</p>
        </div>

        {fb.follow_up_question && (
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 flex items-start gap-3">
            <HelpCircle className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-slate-800">Test yourself next</h4>
              <p className="text-slate-600 mt-1">{fb.follow_up_question}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-8 pb-20 animate-fade-in">
      <div className="flex flex-col items-center text-center mt-10">
        <ToolHero
          icon={MessageSquareQuote}
          gradient="from-teal-400 to-emerald-600"
          glow="bg-teal-400"
          eyebrow="Learn by teaching"
          tone="text-teal-600"
          title="Teach It Back"
          accent={['Teach']}
          subtitle="The best way to learn is to teach. Explain a concept in your own words and MindAI will grade your understanding against the document."
        />

        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden text-left tool-card spotlight">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-400 to-emerald-600"></div>

          <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Source Material</label>
          <div className="relative mb-6">
            <select
              value={selectedDocId}
              onChange={(e) => { setSelectedDocId(e.target.value); setConcept(''); }}
              className="w-full appearance-none rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-700 font-medium focus:border-teal-500 focus:ring-teal-500 focus:bg-white transition-colors"
            >
              {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <ChevronRight className="w-5 h-5 rotate-90" />
            </div>
          </div>

          <label htmlFor="teach-concept" className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Concept to explain</label>
          <input
            id="teach-concept"
            value={concept}
            onChange={e => setConcept(e.target.value)}
            placeholder="Pick a suggestion or type any concept"
            maxLength={200}
            className="w-full rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-800 font-medium focus:border-teal-500 focus:ring-teal-500 focus:bg-white transition-colors"
          />
          <div className="flex flex-wrap gap-2 mt-3 mb-6 min-h-[2rem]">
            {conceptsLoading ? (
              <span className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Finding key concepts...</span>
            ) : concepts.map(c => (
              <button
                key={c}
                onClick={() => setConcept(c)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${concept === c ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700'}`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mb-3">
            <label htmlFor="teach-explanation" className="text-sm font-bold text-slate-700 uppercase tracking-wide">Your explanation</label>
            <VoiceInputButton onTranscript={text => setExplanation(prev => (prev ? `${prev.trimEnd()} ${text}` : text))} />
          </div>
          <textarea
            id="teach-explanation"
            value={explanation}
            onChange={e => setExplanation(e.target.value)}
            rows={7}
            maxLength={6000}
            placeholder="Explain it as if you were teaching a friend who has never heard of it. Type, or press the mic and say it out loud."
            className="w-full rounded-xl border-slate-200 bg-slate-50 p-4 text-slate-800 leading-relaxed focus:border-teal-500 focus:ring-teal-500 focus:bg-white transition-colors resize-y"
          />
          <p className="text-xs text-slate-400 mt-2">{wordCount} word{wordCount === 1 ? '' : 's'}</p>

          <button
            onClick={handleSubmit}
            disabled={isGrading || !concept.trim() || explanation.trim().length < MIN_CHARS}
            className="mt-6 w-full bg-gradient-to-r from-teal-500 to-emerald-600 text-white py-4 rounded-xl font-semibold shadow-lg shadow-teal-500/25 hover:shadow-teal-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
          >
            {isGrading ? <><Loader2 className="w-5 h-5 animate-spin" /> Grading your explanation...</> : <><Sparkles className="w-5 h-5" /> Grade my explanation</>}
          </button>
          {error && <p className="text-red-500 mt-4 text-sm font-medium bg-red-50 p-2 rounded-lg">{error}</p>}
        </div>

        <SavedSets kind="teach_back" documentId={selectedDocId} onOpen={handleOpenSaved} accent="text-teal-600 hover:bg-teal-50" />
      </div>
    </div>
  );
};
