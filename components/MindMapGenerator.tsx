
import React, { useState, useEffect, useRef } from 'react';
import { DocumentFile } from '../types';
import { generateMindMap } from '../services/geminiService';
import { Tooltip } from './Tooltip';
import { AlertCircle, Network, ChevronRight, Loader2, RefreshCw, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import mermaid from 'mermaid';

interface MindMapGeneratorProps {
  documents: DocumentFile[];
}

export const MindMapGenerator: React.FC<MindMapGeneratorProps> = ({ documents }) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [mermaidCode, setMermaidCode] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mermaid.initialize({ 
        startOnLoad: true,
        theme: 'neutral',
        securityLevel: 'loose',
    });
  }, []);

  useEffect(() => {
    if (mermaidCode && containerRef.current) {
      renderDiagram();
    }
  }, [mermaidCode]);

  const renderDiagram = async () => {
    if (!containerRef.current) return;
    try {
      containerRef.current.innerHTML = '';
      const { svg } = await mermaid.render('mindmap-svg', mermaidCode);
      containerRef.current.innerHTML = svg;
    } catch (error) {
      console.error("Mermaid render error:", error);
      containerRef.current.innerHTML = '<div class="text-red-500 p-4">Error rendering diagram. Try regenerating.</div>';
    }
  };

  const handleGenerate = async () => {
    const doc = documents.find(d => d.id === selectedDocId);
    if (!doc) return;
    
    setIsGenerating(true);
    setMermaidCode('');
    
    try {
      const code = await generateMindMap(doc);
      setMermaidCode(code);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  if (documents.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
      <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
         <AlertCircle className="w-10 h-10 text-slate-300" />
      </div>
      <h3 className="text-xl font-semibold text-slate-700">Mind Maps</h3>
      <p className="text-slate-400 mt-2">Upload a document to visualize concepts.</p>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto p-8 h-full flex flex-col animate-fade-in">
      {!mermaidCode && !isGenerating && (
        <div className="flex flex-col items-center text-center mt-10">
             <div className="w-24 h-24 bg-gradient-to-br from-pink-500 to-rose-600 rounded-3xl shadow-2xl shadow-pink-500/30 flex items-center justify-center mb-8 rotate-3 transform transition-transform hover:rotate-6">
                <Network className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-4xl font-display font-bold text-slate-900 mb-3">AI Mind Maps</h2>
            <p className="text-slate-500 max-w-md text-lg mb-10">Transform dense text into clear, visual diagrams. Perfect for understanding relationships between concepts.</p>
            
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-500 to-rose-600"></div>
                 
                 <label className="block text-sm font-bold text-slate-700 mb-3 text-left uppercase tracking-wide">Select Source Material</label>
                  <Tooltip content="Choose a document to map" position="top" className="w-full block">
                    <div className="relative mb-6">
                        <select 
                            value={selectedDocId} 
                            onChange={(e) => setSelectedDocId(e.target.value)}
                            className="w-full appearance-none rounded-xl border-slate-200 bg-slate-50 py-4 px-4 text-slate-700 font-medium focus:border-pink-500 focus:ring-pink-500 focus:bg-white transition-colors"
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

                  <Tooltip content="Generate Visual Map" position="bottom" className="w-full">
                    <button 
                        onClick={handleGenerate}
                        className="w-full bg-gradient-to-r from-pink-500 to-rose-600 text-white py-4 rounded-xl font-semibold shadow-lg shadow-pink-500/25 hover:shadow-pink-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group"
                    >
                        <span>Generate Mind Map</span>
                        <Network className="w-5 h-5 group-hover:rotate-12 transition-transform duration-500" />
                    </button>
                  </Tooltip>
            </div>
        </div>
      )}

      {isGenerating && (
        <div className="flex flex-col items-center justify-center mt-20">
          <div className="relative">
             <div className="absolute inset-0 bg-pink-500 blur-xl opacity-20 animate-pulse"></div>
            <Loader2 className="w-16 h-16 text-pink-500 animate-spin relative z-10" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mt-6">Visualizing Concepts...</h3>
          <p className="text-slate-500 mt-2">Structuring information into a diagram.</p>
        </div>
      )}

      {mermaidCode && (
        <div className="flex-1 flex flex-col h-full">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center">
                        <Network className="w-5 h-5 text-pink-600" />
                    </div>
                    <h3 className="font-bold text-slate-800 text-lg">Concept Map</h3>
                </div>
                <div className="flex gap-2">
                     <Tooltip content="Zoom Out">
                        <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600"><ZoomOut className="w-4 h-4" /></button>
                     </Tooltip>
                     <Tooltip content="Zoom In">
                        <button onClick={() => setZoom(z => Math.min(2, z + 0.1))} className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600"><ZoomIn className="w-4 h-4" /></button>
                     </Tooltip>
                     <Tooltip content="Generate a new map">
                        <button onClick={() => {setMermaidCode(''); setIsGenerating(false);}} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors">
                            <RefreshCw className="w-4 h-4" /> New Map
                        </button>
                     </Tooltip>
                </div>
            </div>
            
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-inner overflow-hidden relative flex items-center justify-center p-8">
                <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-50"></div>
                <div 
                    ref={containerRef} 
                    className="relative z-10 transition-transform duration-300 origin-center"
                    style={{ transform: `scale(${zoom})` }}
                ></div>
            </div>
        </div>
      )}
    </div>
  );
};
