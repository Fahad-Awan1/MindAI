
import React, { useState } from 'react';
import { DocumentFile, QuizQuestion } from '../types';
import { generateQuiz } from '../services/geminiService';
import { Tooltip } from './Tooltip';
import { AlertCircle, CheckCircle, XCircle, RefreshCw, ChevronRight, GraduationCap, Loader2, Award, Trophy, Settings, BookOpen, Lightbulb, Printer, Download } from 'lucide-react';

interface QuizGeneratorProps {
  documents: DocumentFile[];
}

export const QuizGenerator: React.FC<QuizGeneratorProps> = ({ documents }) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [userAnswers, setUserAnswers] = useState<number[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(5);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleGenerate = async () => {
    const doc = documents.find(d => d.id === selectedDocId);
    if (!doc) return;

    setIsGenerating(true);
    setError(null);
    setQuestions([]);
    setUserAnswers([]);
    setShowResults(false);

    try {
      const generatedQuestions = await generateQuiz(doc, questionCount);
      if (generatedQuestions.length === 0) throw new Error("No questions generated");
      setQuestions(generatedQuestions);
      setUserAnswers(new Array(generatedQuestions.length).fill(-1));
    } catch (err) {
      setError("Failed to generate quiz. Please try a different document or try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnswer = (questionIdx: number, optionIdx: number) => {
    if (showResults) return;
    const newAnswers = [...userAnswers];
    newAnswers[questionIdx] = optionIdx;
    setUserAnswers(newAnswers);
  };

  const calculateScore = () => {
    return questions.reduce((acc, q, idx) => acc + (userAnswers[idx] === q.correctAnswerIndex ? 1 : 0), 0);
  };

  const handleDownloadPDF = () => {
      const element = document.getElementById('quiz-content-wrapper');
      if (!element) return;

       if (!(window as any).html2pdf) {
          window.print();
          return;
      }

      setIsDownloading(true);
      
      const opt = {
        margin: [10, 10, 10, 10],
        filename: 'practice_quiz.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, 
            useCORS: true,
            letterRendering: true, 
            scrollY: 0,
            windowWidth: 1024,
            onclone: (doc: Document) => {
                const noPrints = doc.querySelectorAll('.no-print');
                noPrints.forEach((el) => (el as HTMLElement).style.display = 'none');
                
                const printHeaders = doc.querySelectorAll('.print-content.hidden');
                printHeaders.forEach((el) => (el as HTMLElement).classList.remove('hidden'));
                
                // Remove shadows from questions for cleaner print
                const cards = doc.querySelectorAll('.bg-white.rounded-3xl');
                cards.forEach((el) => {
                    (el as HTMLElement).style.boxShadow = 'none';
                    (el as HTMLElement).style.border = '1px solid #e2e8f0';
                });
            }
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      // @ts-ignore
      window.html2pdf().set(opt).from(element).save().then(() => {
          setIsDownloading(false);
      }).catch(() => {
          setIsDownloading(false);
          alert("Failed to download PDF.");
      });
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
    <div className="max-w-5xl mx-auto p-8 pb-20 animate-fade-in">
      {!questions.length && !isGenerating && (
        <div className="flex flex-col items-center text-center mt-10">
             <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-primary-600 rounded-3xl shadow-2xl shadow-primary-500/30 flex items-center justify-center mb-8 rotate-3 transform transition-transform hover:rotate-6">
                <GraduationCap className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-4xl font-display font-bold text-slate-900 mb-3">Knowledge Check</h2>
            <p className="text-slate-500 max-w-md text-lg mb-10">Challenge yourself and reinforce your learning by generating a custom AI quiz from your notes.</p>
            
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden text-left">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-primary-500"></div>
                 
                 <div className="mb-6">
                    <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Select Source Material</label>
                    <Tooltip content="Choose a document to generate a quiz from" position="top" className="w-full block">
                        <div className="relative">
                            <select 
                                value={selectedDocId} 
                                onChange={(e) => setSelectedDocId(e.target.value)}
                                className="w-full appearance-none rounded-xl border-slate-200 bg-slate-50 py-4 px-4 text-slate-700 font-medium focus:border-primary-500 focus:ring-primary-500 focus:bg-white transition-colors"
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
                        <span>Question Count</span>
                        <span className="text-primary-600">{questionCount} Questions</span>
                    </label>
                    <Tooltip content={`Generate ${questionCount} questions`} position="top" className="w-full block">
                        <input 
                            type="range" 
                            min="3" 
                            max="15" 
                            value={questionCount} 
                            onChange={(e) => setQuestionCount(parseInt(e.target.value))}
                            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary-600"
                        />
                    </Tooltip>
                    <div className="flex justify-between text-xs text-slate-400 mt-2 font-medium">
                        <span>3</span>
                        <span>15</span>
                    </div>
                 </div>

                  <Tooltip content="Generate a new quiz" position="bottom" className="w-full">
                    <button 
                        onClick={handleGenerate}
                        className="w-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white py-4 rounded-xl font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group"
                    >
                        <span>Start Quiz</span>
                        <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </Tooltip>
                   {error && <p className="text-red-500 mt-4 text-sm font-medium bg-red-50 p-2 rounded-lg">{error}</p>}
            </div>
        </div>
      )}

      {/* Loading State */}
      {isGenerating && (
        <div className="flex flex-col items-center justify-center mt-20">
          <div className="relative">
            <div className="absolute inset-0 bg-primary-500 blur-xl opacity-20 animate-pulse"></div>
            <Loader2 className="w-16 h-16 text-primary-600 animate-spin relative z-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mt-6">Crafting Questions...</h3>
          <p className="text-slate-500 mt-2">Our AI is reading your document to test your knowledge.</p>
        </div>
      )}

      {/* Quiz Interface */}
      {questions.length > 0 && (
        <div id="quiz-content-wrapper" className="print-content space-y-8 max-w-3xl mx-auto">
          {/* Sticky Header */}
          <div className="no-print glass-card p-4 rounded-2xl shadow-sm border border-white sticky top-4 z-20 flex justify-between items-center">
            <div className="flex items-center gap-3">
                <Tooltip content="Your progress">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-600">
                        {userAnswers.filter(a => a !== -1).length}
                        <span className="text-slate-400 text-xs font-normal ml-0.5">/{questions.length}</span>
                    </div>
                </Tooltip>
                <div>
                    <h3 className="font-bold text-slate-800 leading-tight">Quiz in Progress</h3>
                    <div className="w-32 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                        <div 
                            className="h-full bg-primary-500 transition-all duration-500"
                            style={{ width: `${(userAnswers.filter(a => a !== -1).length / questions.length) * 100}%` }}
                        ></div>
                    </div>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                <Tooltip content="Download as PDF">
                    <button
                        onClick={handleDownloadPDF}
                        disabled={isDownloading}
                        className="p-2.5 bg-white text-slate-600 hover:text-primary-600 rounded-xl border border-slate-200 transition-colors disabled:opacity-50"
                    >
                        {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                    </button>
                </Tooltip>

                {showResults ? (
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <p className="text-xs font-bold text-slate-400 uppercase">Final Score</p>
                        <p className="text-xl font-black text-primary-600">{calculateScore()} / {questions.length}</p>
                    </div>
                    <Trophy className="w-8 h-8 text-amber-400" />
                </div>
                ) : (
                <Tooltip content={userAnswers.includes(-1) ? "Answer all questions to submit" : "Submit your answers"}>
                        <button 
                            onClick={() => setShowResults(true)}
                            disabled={userAnswers.includes(-1)}
                            className="bg-primary-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/20 hover:shadow-primary-500/40"
                        >
                            Submit
                        </button>
                </Tooltip>
                )}
            </div>
            
            {showResults && (
              <Tooltip content="Start a new quiz">
                <button
                    onClick={() => {setQuestions([]); setIsGenerating(false);}}
                    className="flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-primary-600 bg-slate-100 hover:bg-primary-50 px-4 py-2 rounded-xl transition-colors"
                >
                    <RefreshCw className="w-4 h-4" /> Restart
                </button>
              </Tooltip>
            )}
          </div>

          {/* Results Banner */}
          {showResults && (
             <div className="no-print bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl p-8 text-white shadow-xl animate-scale-in text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
                <Award className="w-16 h-16 mx-auto mb-4 text-emerald-200" />
                <h3 className="text-3xl font-bold mb-2">
                    {calculateScore() === questions.length ? "Perfect Score!" : calculateScore() > questions.length / 2 ? "Great Job!" : "Keep Studying!"}
                </h3>
                <p className="text-emerald-100 text-lg">You answered {calculateScore()} out of {questions.length} questions correctly.</p>
             </div>
          )}

          {/* Print Header (Only Visible on Print/PDF) */}
          <div className="hidden print-content mb-8 border-b-2 border-slate-800 pb-4">
             <h1 className="text-2xl font-serif font-bold">Quiz: Practice Assessment</h1>
             <p className="text-sm text-slate-600 mt-2">Attempt all questions. Select the best option.</p>
          </div>

          {/* Questions List */}
          {questions.map((q, qIdx) => (
            <div key={qIdx} className="break-inside-avoid bg-white rounded-3xl p-8 shadow-sm border border-slate-100 animate-slide-up relative overflow-hidden" style={{animationDelay: `${qIdx * 100}ms`}}>
               <div className="no-print absolute top-0 left-0 w-1.5 h-full bg-slate-100">
                    {showResults && userAnswers[qIdx] === q.correctAnswerIndex && <div className="absolute top-0 left-0 w-full h-full bg-emerald-500"></div>}
                    {showResults && userAnswers[qIdx] !== q.correctAnswerIndex && <div className="absolute top-0 left-0 w-full h-full bg-red-500"></div>}
               </div>
               
              <div className="flex gap-4 mb-6">
                 <span className="text-3xl font-black text-slate-200 font-display print-content text-slate-800">{(qIdx + 1).toString().padStart(2, '0')}</span>
                 <h4 className="text-lg font-semibold text-slate-800 pt-1">{q.question}</h4>
              </div>
              
              <div className="space-y-3 pl-10">
                {q.options.map((opt, oIdx) => {
                  let itemClass = "w-full text-left p-4 rounded-xl border-2 transition-all duration-200 flex justify-between items-center font-medium relative overflow-hidden ";
                  
                  if (showResults) {
                    if (oIdx === q.correctAnswerIndex) {
                      itemClass += "bg-emerald-50 border-emerald-200 text-emerald-800 shadow-sm z-10";
                    } else if (userAnswers[qIdx] === oIdx && userAnswers[qIdx] !== q.correctAnswerIndex) {
                      itemClass += "bg-red-50 border-red-200 text-red-800 z-10";
                    } else {
                      itemClass += "bg-white border-slate-100 text-slate-400 opacity-60";
                    }
                  } else {
                    if (userAnswers[qIdx] === oIdx) {
                      itemClass += "bg-primary-50 border-primary-500 text-primary-700 shadow-sm scale-[1.01]";
                    } else {
                      itemClass += "bg-white border-slate-100 hover:border-primary-200 hover:bg-slate-50 text-slate-600";
                    }
                  }

                  return (
                    <button
                      key={oIdx}
                      onClick={() => handleAnswer(qIdx, oIdx)}
                      disabled={showResults}
                      className={itemClass}
                    >
                      <span className="relative z-10">{opt}</span>
                      {showResults && oIdx === q.correctAnswerIndex && <CheckCircle className="w-5 h-5 text-emerald-600 no-print" />}
                      {showResults && userAnswers[qIdx] === oIdx && userAnswers[qIdx] !== q.correctAnswerIndex && <XCircle className="w-5 h-5 text-red-600 no-print" />}
                    </button>
                  );
                })}
              </div>
              {showResults && (
                <div className={`break-inside-avoid mt-6 ml-10 p-6 rounded-2xl text-sm border animate-fade-in relative overflow-hidden ${
                    userAnswers[qIdx] === q.correctAnswerIndex 
                    ? 'bg-emerald-50/50 border-emerald-100' 
                    : 'bg-indigo-50/50 border-indigo-100'
                }`}>
                  {/* Decoration */}
                  <div className={`no-print absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl opacity-20 -translate-y-1/2 translate-x-1/2 ${
                      userAnswers[qIdx] === q.correctAnswerIndex ? 'bg-emerald-400' : 'bg-indigo-400'
                  }`}></div>

                  <div className="flex items-start gap-3 relative z-10">
                      <div className={`no-print w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm border border-white ${
                          userAnswers[qIdx] === q.correctAnswerIndex ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600'
                      }`}>
                          {userAnswers[qIdx] === q.correctAnswerIndex ? <CheckCircle className="w-4 h-4" /> : <Lightbulb className="w-4 h-4" />}
                      </div>
                      <div>
                          <h5 className={`font-bold uppercase text-xs tracking-wider mb-1 ${
                              userAnswers[qIdx] === q.correctAnswerIndex ? 'text-emerald-700' : 'text-indigo-700'
                          }`}>
                              {userAnswers[qIdx] === q.correctAnswerIndex ? 'Correct Analysis' : 'Study Insight'}
                          </h5>
                          <p className="text-slate-700 leading-relaxed text-[15px]">
                              {q.explanation}
                          </p>
                           {userAnswers[qIdx] !== q.correctAnswerIndex && (
                              <div className="no-print mt-3 flex items-center gap-2 text-indigo-600 text-xs font-bold cursor-help hover:text-indigo-700 transition-colors">
                                  <BookOpen className="w-3.5 h-3.5" />
                                  <span>Ref: Document Context</span>
                              </div>
                          )}
                      </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
