
import React, { useState } from 'react';
import { AiThinking } from './AiThinking';
import { ToolHero } from './ToolHero';
import { DocumentFile, StudyTask, StudySet, StudySetSummary } from '../types';
import { aiAPI, studySetsAPI, getErrorMessage } from '../services/api';
import { useInitialStudySet } from '../hooks/useInitialStudySet';
import { SavedSets } from './SavedSets';
import { useSelectedDocument } from '../hooks/useSelectedDocument';
import { Tooltip } from './Tooltip';
import { AlertCircle, CalendarClock, ChevronRight, CheckCircle2, Clock } from 'lucide-react';

interface StudyPlannerProps {
  documents: DocumentFile[];
  initialSetId?: string | null;
  onInitialSetConsumed?: () => void;
}

export const StudyPlanner: React.FC<StudyPlannerProps> = ({ documents, initialSetId, onInitialSetConsumed }) => {
  const [selectedDocId, setSelectedDocId] = useSelectedDocument(documents);
  const [activeSet, setActiveSet] = useState<StudySet<StudyTask[]> | null>(null);
  const [plan, setPlan] = useState<StudyTask[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [days, setDays] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const openPlan = (set: StudySet<StudyTask[]>) => {
    setActiveSet(set);
    setPlan(set.data);
    setError(null);
    setSelectedDocId(set.document_id);
  };

  useInitialStudySet<StudyTask[]>(initialSetId, openPlan, setError, onInitialSetConsumed);

  const handleOpenSaved = async (summary: StudySetSummary) => {
    try {
      openPlan(await studySetsAPI.get<StudyTask[]>(summary.id));
    } catch (err) {
      setError(getErrorMessage(err, "Failed to open the saved plan."));
    }
  };

  const handleGenerate = async () => {
    const doc = documents.find(d => d.id === selectedDocId);
    if (!doc) return;

    setIsGenerating(true);
    setError(null);
    setPlan([]);

    try {
      const set = await aiAPI.generateStudyPlan(doc.id, days);
      if (set.data.length === 0) throw new Error("No study plan generated");
      openPlan(set);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err, "Failed to generate study plan. Please try again."));
    } finally {
      setIsGenerating(false);
    }
  };



  if (documents.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
      <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
         <AlertCircle className="w-10 h-10 text-slate-300" />
      </div>
      <h3 className="text-xl font-semibold text-slate-700">Study Planner</h3>
      <p className="text-slate-400 mt-2">Upload a document to create a schedule.</p>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 pb-20 animate-fade-in">
      {!plan.length && !isGenerating && (
        <div className="flex flex-col items-center text-center mt-4 md:mt-10">
             <ToolHero
               icon={CalendarClock}
               gradient="from-violet-500 to-purple-600"
               glow="bg-violet-400"
               eyebrow="Plan ahead"
               tone="text-violet-600"
               title="AI Study Planner"
               accent={['Planner']}
               subtitle="Beat procrastination. Get a personalized study schedule tailored to your document."
             />
            
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden text-left tool-card spotlight">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 to-purple-600"></div>
                 
                 <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Select Source Material</label>
                    <Tooltip content="Choose document to plan for" position="top" className="w-full block">
                        <div className="relative">
                            <select 
                                value={selectedDocId} 
                                onChange={(e) => setSelectedDocId(e.target.value)}
                                className="w-full appearance-none rounded-xl border-slate-200 bg-slate-50 py-4 px-4 text-slate-700 font-medium focus:border-violet-500 focus:ring-violet-500 focus:bg-white transition-colors"
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
                        <span>Duration</span>
                        <span className="text-violet-600">{days} Days</span>
                    </label>
                    <Tooltip content={`Create a ${days}-day plan`} position="top" className="w-full block">
                        <input 
                            type="range" 
                            min="1" 
                            max="14" 
                            value={days} 
                            onChange={(e) => setDays(parseInt(e.target.value))}
                            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-violet-600"
                        />
                    </Tooltip>
                    <div className="flex justify-between text-xs text-slate-400 mt-2 font-medium">
                        <span>1 Day</span>
                        <span>2 Weeks</span>
                    </div>
                 </div>

                  <Tooltip content="Generate Plan" position="bottom" className="w-full">
                    <button 
                        onClick={handleGenerate}
                        className="w-full bg-gradient-to-r from-violet-500 to-purple-600 text-white py-4 rounded-xl font-semibold shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group"
                    >
                        <span>Create Schedule</span>
                        <CalendarClock className="w-5 h-5 group-hover:scale-110 transition-transform duration-500" />
                    </button>
                  </Tooltip>
                  {error && <p className="text-red-500 mt-4 text-sm font-medium bg-red-50 p-2 rounded-lg">{error}</p>}
            </div>

            <SavedSets kind="study_plan" documentId={selectedDocId} onOpen={handleOpenSaved} accent="text-violet-600 hover:bg-violet-50" />
        </div>
      )}

      {isGenerating && (
        <AiThinking title="Planning Schedule..." subtitle="Organizing topics into manageable tasks." color="#8b5cf6" steps={['Reading your document', 'Splitting it into topics', 'Scheduling your days']} />
      )}

      {plan.length > 0 && (
        <div id="study-plan-content" className="print-content">
            <div className="flex flex-wrap justify-between items-end gap-3 mb-8 no-print">
                <div className="min-w-0">
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-900 break-anywhere">{activeSet?.title || `Your ${plan.length}-Day Plan`}</h2>
                    <p className="text-slate-500">Follow this schedule to master the material.</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={() => {setPlan([]); setActiveSet(null); setIsGenerating(false);}} className="text-sm font-bold text-violet-600 hover:text-violet-800 transition-colors self-center">
                        Create New Plan
                    </button>
                </div>
            </div>

            {/* Print Header */}
            <div className="hidden print-content mb-8 border-b-2 border-slate-800 pb-4">
                 <h1 className="text-3xl font-serif font-bold">Study Schedule</h1>
                 <p className="text-lg text-slate-600 mt-2">Duration: {plan.length} Days</p>
            </div>
            
            <div className="space-y-6 relative print-content">
                <div className="absolute left-8 top-8 bottom-8 w-0.5 bg-slate-200 hidden md:block no-print"></div>
                
                {plan.map((day, idx) => (
                    <div key={idx} className="break-inside-avoid relative flex flex-col md:flex-row gap-6 group animate-slide-up" style={{animationDelay: `${idx * 100}ms`}}>
                         <Tooltip content={`Day ${day.day} Task`}>
                            <div className="no-print flex-shrink-0 w-16 h-16 rounded-2xl bg-white border-2 border-violet-100 text-violet-600 flex flex-col items-center justify-center shadow-sm relative z-10 group-hover:border-violet-500 group-hover:scale-110 transition-all duration-300 cursor-help">
                                <span className="text-xs font-bold uppercase text-slate-400">Day</span>
                                <span className="text-2xl font-display font-bold">{day.day}</span>
                            </div>
                         </Tooltip>
                         
                         {/* For print, we use a cleaner look without hover shadows and with borders */}
                         <div className="flex-1 min-w-0 bg-white rounded-3xl p-4 md:p-6 shadow-sm border border-slate-100 group-hover:shadow-md transition-shadow print-content border-l-4 border-l-violet-500 md:border-l-slate-100"
                              style={{ breakInside: 'avoid' }}>
                             <div className="flex justify-between items-start gap-3 mb-4">
                                 <h3 className="text-lg md:text-xl font-bold text-slate-800 min-w-0 break-anywhere">Day {day.day}: {day.topic}</h3>
                                 <div className="flex flex-shrink-0 whitespace-nowrap items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                                     <Clock className="w-3.5 h-3.5" />
                                     {day.estimated_minutes} min
                                 </div>
                             </div>
                             
                             <ul className="space-y-3">
                                 {day.tasks.map((task, tIdx) => (
                                     <li key={tIdx} className="flex items-start gap-3 text-slate-600">
                                         <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity no-print" />
                                         {/* Use bullet point for print since checkcircle might be hidden or look odd */}
                                         <span className="hidden print-content text-slate-800 font-bold mr-2">•</span>
                                         <span className="group-hover:text-slate-900 transition-colors">{task}</span>
                                     </li>
                                 ))}
                             </ul>
                         </div>
                    </div>
                ))}
            </div>
        </div>
      )}
    </div>
  );
};
