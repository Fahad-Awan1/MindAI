
import React, { useState } from 'react';
import { DocumentFile, StudyTask } from '../types';
import { generateStudyPlan } from '../services/geminiService';
import { Tooltip } from './Tooltip';
import { AlertCircle, CalendarClock, ChevronRight, Loader2, CheckCircle2, Clock, Printer, Download } from 'lucide-react';

interface StudyPlannerProps {
  documents: DocumentFile[];
}

export const StudyPlanner: React.FC<StudyPlannerProps> = ({ documents }) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [plan, setPlan] = useState<StudyTask[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [days, setDays] = useState(5);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleGenerate = async () => {
    const doc = documents.find(d => d.id === selectedDocId);
    if (!doc) return;
    
    setIsGenerating(true);
    setPlan([]);
    
    try {
      const generatedPlan = await generateStudyPlan(doc, days);
      setPlan(generatedPlan);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadPDF = () => {
      const element = document.getElementById('study-plan-content');
      if (!element) return;

      if (!(window as any).html2pdf) {
          window.print();
          return;
      }

      setIsDownloading(true);

      const opt = {
        margin: [10, 10, 10, 10], // mm
        filename: 'Study_Plan.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, // Higher scale for better text resolution
            useCORS: true, 
            letterRendering: true, // Improves font rendering
            scrollY: 0,
            windowWidth: 1024, // Force a desktop width for better layout calculation
            onclone: (doc: Document) => {
                const noPrints = doc.querySelectorAll('.no-print');
                noPrints.forEach((el) => (el as HTMLElement).style.display = 'none');
                
                const printHeaders = doc.querySelectorAll('.print-content.hidden');
                printHeaders.forEach((el) => (el as HTMLElement).classList.remove('hidden'));
                
                // Force background colors to print
                const elements = doc.querySelectorAll('*');
                elements.forEach((el) => {
                    (el as HTMLElement).style.printColorAdjust = 'exact';
                    // Remove transform/animations that confuse html2canvas
                    (el as HTMLElement).style.animation = 'none';
                    (el as HTMLElement).style.transition = 'none';
                });
            }
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      // @ts-ignore
      window.html2pdf().set(opt).from(element).save().then(() => {
          setIsDownloading(false);
      }).catch((err: any) => {
          console.error(err);
          setIsDownloading(false);
          alert("Failed to download PDF.");
      });
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
    <div className="max-w-5xl mx-auto p-8 pb-20 animate-fade-in">
      {!plan.length && !isGenerating && (
        <div className="flex flex-col items-center text-center mt-10">
             <div className="w-24 h-24 bg-gradient-to-br from-violet-500 to-purple-600 rounded-3xl shadow-2xl shadow-violet-500/30 flex items-center justify-center mb-8 rotate-3 transform transition-transform hover:rotate-6">
                <CalendarClock className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-4xl font-display font-bold text-slate-900 mb-3">AI Study Planner</h2>
            <p className="text-slate-500 max-w-md text-lg mb-10">Beat procrastination. Get a personalized study schedule tailored to your document.</p>
            
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden text-left">
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
            </div>
        </div>
      )}

      {isGenerating && (
        <div className="flex flex-col items-center justify-center mt-20">
          <div className="relative">
             <div className="absolute inset-0 bg-violet-500 blur-xl opacity-20 animate-pulse"></div>
            <Loader2 className="w-16 h-16 text-violet-500 animate-spin relative z-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mt-6">Planning Schedule...</h3>
          <p className="text-slate-500 mt-2">Organizing topics into manageable tasks.</p>
        </div>
      )}

      {plan.length > 0 && (
        <div id="study-plan-content" className="print-content">
            <div className="flex justify-between items-end mb-8 no-print">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900">Your {days}-Day Plan</h2>
                    <p className="text-slate-500">Follow this schedule to master the material.</p>
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={handleDownloadPDF}
                        disabled={isDownloading}
                        className="flex items-center gap-2 bg-slate-100 text-slate-700 px-4 py-2 rounded-lg font-bold hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        Download PDF
                    </button>
                    <button onClick={() => {setPlan([]); setIsGenerating(false);}} className="text-sm font-bold text-violet-600 hover:text-violet-800 transition-colors self-center">
                        Create New Plan
                    </button>
                </div>
            </div>

            {/* Print Header */}
            <div className="hidden print-content mb-8 border-b-2 border-slate-800 pb-4">
                 <h1 className="text-3xl font-serif font-bold">Study Schedule</h1>
                 <p className="text-lg text-slate-600 mt-2">Duration: {days} Days</p>
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
                         <div className="flex-1 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 group-hover:shadow-md transition-shadow print-content border-l-4 border-l-violet-500 md:border-l-slate-100"
                              style={{ breakInside: 'avoid' }}>
                             <div className="flex justify-between items-start mb-4">
                                 <h3 className="text-xl font-bold text-slate-800">Day {day.day}: {day.topic}</h3>
                                 <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                                     <Clock className="w-3.5 h-3.5" />
                                     {day.estimatedMinutes} min
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
