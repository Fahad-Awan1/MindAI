
import React, { useState } from 'react';
import { DocumentFile, ExamPaper } from '../types';
import { generateExamPaper } from '../services/geminiService';
import { Tooltip } from './Tooltip';
import { FileSignature, ChevronRight, Loader2, Printer, Download, CheckSquare, RefreshCw, AlertCircle } from 'lucide-react';

interface ExamGeneratorProps {
  documents: DocumentFile[];
}

export const ExamGenerator: React.FC<ExamGeneratorProps> = ({ documents }) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [exam, setExam] = useState<ExamPaper | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [numQuestions, setNumQuestions] = useState(5);
  const [difficulty, setDifficulty] = useState('Medium');
  const [type, setType] = useState('mixed');
  const [showAnswers, setShowAnswers] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleGenerate = async () => {
    const doc = documents.find(d => d.id === selectedDocId);
    if (!doc) return;

    setIsGenerating(true);
    setExam(null);
    setShowAnswers(false);

    try {
      const result = await generateExamPaper(doc, numQuestions, difficulty, type);
      setExam(result);
    } catch (error) {
      console.error("Exam generation failed", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadPDF = () => {
    const element = document.getElementById('exam-content');
    if (!element || !exam) return;

    // Check if html2pdf is available
    if (!(window as any).html2pdf) {
        window.print();
        return;
    }

    setIsDownloading(true);
    
    const opt = {
      margin: [15, 15, 15, 15], // Margin 15mm
      filename: `${exam.title.replace(/\s+/g, '_') || 'Exam_Paper'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
          scale: 2, 
          useCORS: true,
          letterRendering: true,
          scrollY: 0,
          windowWidth: 1200, // Render at desktop width
          onclone: (doc: Document) => {
            // Ensure no-print elements are hidden
            const noPrints = doc.querySelectorAll('.no-print');
            noPrints.forEach((el) => (el as HTMLElement).style.display = 'none');
            
            // Force visible styles
            const content = doc.getElementById('exam-content');
            if (content) {
                content.style.boxShadow = 'none';
                content.style.margin = '0';
                content.style.width = '100%';
                content.style.maxWidth = '100%';
            }
          }
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] } // Key for handling question breaks
    };

    // @ts-ignore
    window.html2pdf().set(opt).from(element).save().then(() => {
        setIsDownloading(false);
    }).catch((err: any) => {
        console.error(err);
        setIsDownloading(false);
        alert("Failed to generate PDF.");
    });
  };

  if (documents.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
           <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
               <AlertCircle className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-semibold text-slate-700">Exam Generator</h3>
          <p className="text-slate-400 mt-2">Upload a document to generate formal question papers.</p>
        </div>
      );
  }

  return (
    <div className="max-w-7xl mx-auto p-8 pb-20 animate-fade-in h-full flex flex-col">
      
      {/* Setup Screen */}
      {!exam && !isGenerating && (
        <div className="flex flex-col items-center text-center mt-10">
             <div className="w-24 h-24 bg-gradient-to-br from-sky-500 to-blue-600 rounded-3xl shadow-2xl shadow-sky-500/30 flex items-center justify-center mb-8 rotate-3 transform transition-transform hover:rotate-6">
                <FileSignature className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-4xl font-display font-bold text-slate-900 mb-3">Exam Paper Generator</h2>
            <p className="text-slate-500 max-w-md text-lg mb-10">Create professional, subjective question papers and marking schemes from your materials. Ready for print.</p>
            
            <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden text-left">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sky-500 to-blue-600"></div>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Source Material</label>
                        <div className="relative mb-6">
                            <select 
                                value={selectedDocId} 
                                onChange={(e) => setSelectedDocId(e.target.value)}
                                className="w-full appearance-none rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-700 font-medium focus:border-sky-500 focus:ring-sky-500 focus:bg-white transition-colors"
                            >
                                {documents.map(doc => (
                                <option key={doc.id} value={doc.id}>{doc.title}</option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                <ChevronRight className="w-5 h-5 rotate-90" />
                            </div>
                        </div>

                        <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Difficulty</label>
                        <div className="flex gap-2 mb-6">
                            {['Easy', 'Medium', 'Hard'].map(d => (
                                <button
                                    key={d}
                                    onClick={() => setDifficulty(d)}
                                    className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${difficulty === d ? 'bg-sky-100 text-sky-700 ring-2 ring-sky-500' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Questions: <span className="text-sky-600">{numQuestions}</span></label>
                        <input 
                            type="range" 
                            min="3" 
                            max="15" 
                            value={numQuestions} 
                            onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-sky-500 mb-6"
                        />

                        <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Type</label>
                        <div className="space-y-2">
                            {[
                                { id: 'short', label: 'Short Answer Only' },
                                { id: 'long', label: 'Essay / Long Answer' },
                                { id: 'mixed', label: 'Mixed Format' }
                            ].map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setType(t.id)}
                                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${type === t.id ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200 hover:border-sky-200 text-slate-600'}`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>
                 </div>

                  <div className="mt-8 pt-8 border-t border-slate-100">
                    <button 
                        onClick={handleGenerate}
                        className="w-full bg-gradient-to-r from-sky-500 to-blue-600 text-white py-4 rounded-xl font-semibold shadow-lg shadow-sky-500/25 hover:shadow-sky-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group"
                    >
                        <span>Generate Question Paper</span>
                        <FileSignature className="w-5 h-5" />
                    </button>
                  </div>
            </div>
        </div>
      )}

      {isGenerating && (
        <div className="flex flex-col items-center justify-center mt-20">
          <div className="relative">
             <div className="absolute inset-0 bg-sky-500 blur-xl opacity-20 animate-pulse"></div>
            <Loader2 className="w-16 h-16 text-sky-500 animate-spin relative z-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mt-6">Drafting Examination...</h3>
          <p className="text-slate-500 mt-2">Formatting questions and calculating marks.</p>
        </div>
      )}

      {exam && (
        <div className="flex-1 flex flex-col items-center w-full">
           {/* Toolbar - Hidden on Print */}
           <div className="no-print w-full max-w-4xl flex justify-between items-center mb-8 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => {setExam(null); setIsGenerating(false);}}
                        className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" /> New Exam
                    </button>
                    <div className="h-6 w-px bg-slate-200"></div>
                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 select-none">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${showAnswers ? 'bg-sky-500 border-sky-500' : 'border-slate-300 bg-white'}`}>
                            {showAnswers && <CheckSquare className="w-3.5 h-3.5 text-white" />}
                        </div>
                        <input type="checkbox" className="hidden" checked={showAnswers} onChange={() => setShowAnswers(!showAnswers)} />
                        Show Solution Key
                    </label>
                </div>
                <button 
                    onClick={handleDownloadPDF}
                    disabled={isDownloading}
                    className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl disabled:opacity-70 disabled:cursor-wait"
                >
                    {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {isDownloading ? 'Generating PDF...' : 'Download PDF'}
                </button>
           </div>

           {/* Exam Paper Preview (This gets downloaded/printed) */}
           <div id="exam-content" className="print-content bg-white w-full max-w-[210mm] min-h-[297mm] p-[20mm] shadow-2xl text-slate-900 mx-auto font-serif relative">
                {/* Paper Texture for Screen Only */}
                <div className="no-print absolute inset-0 bg-[#fcfcfc] pointer-events-none"></div>
                
                <div className="relative z-10">
                    {/* Header */}
                    <div className="border-b-2 border-black pb-6 mb-8 text-center">
                        <h1 className="text-3xl font-bold mb-2 uppercase tracking-wide">{exam.title}</h1>
                        <div className="flex justify-between text-lg italic mt-4 font-semibold">
                            <span>Time Allowed: {exam.durationMinutes} Minutes</span>
                            <span>Maximum Marks: {exam.totalMarks}</span>
                        </div>
                        <div className="flex justify-between text-base mt-4 pt-4 border-t border-slate-200">
                             <span>Name: __________________________</span>
                             <span>Date: __________________________</span>
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="mb-8">
                        <h3 className="font-bold uppercase text-sm mb-2">Instructions:</h3>
                        <ul className="list-disc pl-5 text-sm space-y-1">
                            <li>Answer all questions.</li>
                            <li>Write your answers clearly in the space provided or on a separate sheet.</li>
                            <li>Figures in the margin indicate full marks.</li>
                        </ul>
                    </div>

                    {/* Questions */}
                    <div className="space-y-8">
                        {exam.questions.map((q, idx) => (
                            <div key={idx} className="break-inside-avoid">
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex gap-2 flex-1">
                                        <span className="font-bold">{idx + 1}.</span>
                                        <div>
                                            <p className="text-lg leading-relaxed">{q.question}</p>
                                            {showAnswers && (
                                                <div className="mt-4 p-4 bg-slate-50 border-l-4 border-slate-400 text-sm font-sans text-slate-600 break-inside-avoid">
                                                    <span className="font-bold block mb-1 text-slate-800 uppercase text-xs">Model Answer / Key Points:</span>
                                                    {q.answerKey}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <span className="font-bold text-lg whitespace-nowrap">[{q.marks}]</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="mt-16 text-center border-t border-slate-300 pt-8 text-sm text-slate-500 italic">
                        *** End of Paper ***
                    </div>
                </div>
           </div>
        </div>
      )}
    </div>
  );
};
