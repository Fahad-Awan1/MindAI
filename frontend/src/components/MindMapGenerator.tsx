
import React, { useState, useEffect, useRef } from 'react';
import { AiThinking } from './AiThinking';
import { ToolHero } from './ToolHero';
import { DocumentFile, StudySet, StudySetSummary } from '../types';
import { aiAPI, studySetsAPI, getErrorMessage } from '../services/api';
import { useInitialStudySet } from '../hooks/useInitialStudySet';
import { SavedSets } from './SavedSets';
import { useSelectedDocument } from '../hooks/useSelectedDocument';
import { Tooltip } from './Tooltip';
import { AlertCircle, Network, ChevronRight, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import mermaid from 'mermaid';

interface MindMapGeneratorProps {
  documents: DocumentFile[];
  initialSetId?: string | null;
  onInitialSetConsumed?: () => void;
}

// Mermaid is configured once; 'strict' prevents scripts/HTML in AI-generated diagrams
mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
});

let renderCounter = 0;

export const MindMapGenerator: React.FC<MindMapGeneratorProps> = ({ documents, initialSetId, onInitialSetConsumed }) => {
  const [selectedDocId, setSelectedDocId] = useSelectedDocument(documents);
  const [mermaidCode, setMermaidCode] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      if (!containerRef.current) return;
      try {
        containerRef.current.innerHTML = '';
        // Unique id per render avoids clashes with leftover nodes from earlier renders
        const { svg } = await mermaid.render(`mindmap-svg-${++renderCounter}`, mermaidCode);
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
      } catch (err) {
        console.error("Mermaid render error:", err);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = '<div class="text-red-500 p-4">Error rendering diagram. Try regenerating.</div>';
        }
      }
    };

    if (mermaidCode && containerRef.current) {
      renderDiagram();
    }

    return () => {
      cancelled = true;
    };
  }, [mermaidCode]);

  const [mapTitle, setMapTitle] = useState<string | null>(null);

  const openMap = (set: StudySet<string>) => {
    setMermaidCode(set.data);
    setMapTitle(`${set.title} · ${set.document_title}`);
    setZoom(1);
    setError(null);
    setSelectedDocId(set.document_id);
  };

  useInitialStudySet<string>(initialSetId, openMap, setError, onInitialSetConsumed);

  const handleOpenSaved = async (summary: StudySetSummary) => {
    try {
      openMap(await studySetsAPI.get<string>(summary.id));
    } catch (err) {
      setError(getErrorMessage(err, "Failed to open the saved mind map."));
    }
  };

  const handleGenerate = async () => {
    const doc = documents.find(d => d.id === selectedDocId);
    if (!doc) return;

    setIsGenerating(true);
    setError(null);
    setMermaidCode('');
    setZoom(1);

    try {
      const set = await aiAPI.generateMindMap(doc.id);
      if (!set.data.trim()) throw new Error("No mind map generated");
      openMap(set);
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err, "Failed to generate mind map. Please try again."));
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
    <div className="max-w-7xl mx-auto p-4 md:p-8 h-full flex flex-col animate-fade-in">
      {!mermaidCode && !isGenerating && (
        <div className="flex flex-col items-center text-center mt-4 md:mt-10">
             <ToolHero
               icon={Network}
               gradient="from-pink-500 to-rose-600"
               glow="bg-pink-400"
               eyebrow="Visual thinking"
               tone="text-pink-600"
               title="AI Mind Maps"
               accent={['Mind']}
               subtitle="Transform dense text into clear, visual diagrams. Perfect for understanding relationships between concepts."
             />
            
            <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden tool-card spotlight">
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
                  {error && <p className="text-red-500 mt-4 text-sm font-medium bg-red-50 p-2 rounded-lg text-left">{error}</p>}
            </div>

            <SavedSets kind="mind_map" documentId={selectedDocId} onOpen={handleOpenSaved} accent="text-pink-600 hover:bg-pink-50" />
        </div>
      )}

      {isGenerating && (
        <AiThinking title="Visualizing Concepts..." subtitle="Structuring information into a diagram." color="#ec4899" steps={['Reading your document', 'Finding the main branches', 'Drawing the map']} />
      )}

      {mermaidCode && (
        <div className="flex-1 flex flex-col h-full">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-pink-50 flex items-center justify-center">
                        <Network className="w-5 h-5 text-pink-600" />
                    </div>
                    <h3 className="font-bold text-slate-800 text-lg truncate">{mapTitle || "Concept Map"}</h3>
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
            
            <div className="flex-1 min-h-[60dvh] md:min-h-0 bg-white rounded-3xl border border-slate-200 shadow-inner overflow-auto relative flex p-4 md:p-8" data-lenis-prevent>
                <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-50"></div>
                <div 
                    ref={containerRef} 
                    className="relative z-10 m-auto"
                    style={{ zoom }}
                ></div>
            </div>
        </div>
      )}
    </div>
  );
};
