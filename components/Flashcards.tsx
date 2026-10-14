
import React, { useState } from 'react';
import { DocumentFile, Flashcard } from '../types';
import { generateFlashcards } from '../services/geminiService';
import { Tooltip } from './Tooltip';
import { AlertCircle, Zap, RotateCw, ArrowLeft, ArrowRight, Loader2, Layers, ChevronRight } from 'lucide-react';

interface FlashcardsProps {
  documents: DocumentFile[];
}

export const Flashcards: React.FC<FlashcardsProps> = ({ documents }) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [cardCount, setCardCount] = useState(10);

  const handleGenerate = async () => {
    const doc = documents.find(d => d.id === selectedDocId);
    if (!doc) return;
    
    setIsGenerating(true);
    setFlashcards([]);
    setCurrentIndex(0);
    setIsFlipped(false);

    try {
      const cards = await generateFlashcards(doc, cardCount);
      setFlashcards(cards);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const nextCard = () => {
    if (currentIndex < flashcards.length - 1) {
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

  if (documents.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
      <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
             <AlertCircle className="w-10 h-10 text-slate-300" />
        </div>
      <h3 className="text-xl font-semibold text-slate-700">Flashcards</h3>
      <p className="text-slate-400 mt-2">Upload a document to create a study deck.</p>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto p-8 h-full flex flex-col animate-fade-in">
      
      {!flashcards.length && !isGenerating && (
        <div className="flex flex-col items-center text-center mt-10">
             <div className="w-24 h-24 bg-gradient-to-br from-amber-400 to-orange-500 rounded-3xl shadow-2xl shadow-amber-500/30 flex items-center justify-center mb-8 rotate-3 transform transition-transform hover:rotate-6">
                <Zap className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-4xl font-display font-bold text-slate-900 mb-3">Flashcards</h2>
            <p className="text-slate-500 max-w-md text-lg mb-10">Master concepts through repetition. Generate a deck of cards from your key takeaways.</p>
            
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden text-left">
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
            </div>
        </div>
      )}

      {isGenerating && (
        <div className="flex flex-col items-center justify-center mt-20">
          <div className="relative">
             <div className="absolute inset-0 bg-amber-500 blur-xl opacity-20 animate-pulse"></div>
            <Loader2 className="w-16 h-16 text-amber-500 animate-spin relative z-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mt-6">Generating Deck...</h3>
          <p className="text-slate-500 mt-2">Identifying key concepts and definitions.</p>
        </div>
      )}

      {flashcards.length > 0 && (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[600px]">
          {/* Header Controls */}
          <div className="w-full max-w-2xl flex justify-between items-center mb-8">
            <div className="flex items-center gap-3">
                <div className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 font-bold text-sm">
                    Card {currentIndex + 1} / {flashcards.length}
                </div>
                <div className="h-2 w-24 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 transition-all duration-300" style={{width: `${((currentIndex + 1) / flashcards.length) * 100}%`}}></div>
                </div>
            </div>
            <button onClick={() => {setFlashcards([]); setIsGenerating(false);}} className="text-sm font-bold text-slate-400 hover:text-slate-700 transition-colors">
              Exit Deck
            </button>
          </div>

          {/* Card Container */}
          <div 
            className="relative h-96 w-full max-w-2xl cursor-pointer perspective-1000 group"
            onClick={() => setIsFlipped(!isFlipped)}
          >
             <div className={`relative w-full h-full transition-all duration-700 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
                {/* Front */}
                <div className="absolute w-full h-full bg-[#fffdf8] rounded-3xl shadow-xl border border-stone-200 p-10 flex flex-col items-center justify-center text-center backface-hidden">
                    {/* Paper Texture Effect */}
                    <div className="absolute inset-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/cardboard-flat.png')] rounded-3xl"></div>
                    
                   <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center mb-6">
                        <span className="font-bold text-lg">Q</span>
                   </div>
                   <p className="text-2xl md:text-3xl text-slate-800 font-display font-bold leading-snug">{flashcards[currentIndex].front}</p>
                   <p className="absolute bottom-8 text-xs font-bold text-slate-300 uppercase tracking-widest">Click to flip</p>
                </div>

                {/* Back */}
                <div className="absolute w-full h-full bg-slate-900 rounded-3xl shadow-2xl border border-slate-800 p-10 flex flex-col items-center justify-center text-center backface-hidden rotate-y-180 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600 rounded-full blur-[80px] opacity-20"></div>
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-amber-500 rounded-full blur-[80px] opacity-20"></div>
                    
                   <div className="relative z-10 w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-6 border border-emerald-500/30">
                        <span className="font-bold text-lg">A</span>
                   </div>
                   <p className="relative z-10 text-xl md:text-2xl text-slate-100 font-medium leading-relaxed">{flashcards[currentIndex].back}</p>
                </div>
             </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6 mt-12">
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
                disabled={currentIndex === flashcards.length - 1}
                className="p-4 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:scale-110 disabled:opacity-30 disabled:hover:scale-100 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                <ArrowRight className="w-6 h-6" />
                </button>
            </Tooltip>
          </div>
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
