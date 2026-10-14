import React, { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { ConceptGraph as Graph, ConceptRequest, GraphNode } from '../types';
import { graphAPI, getErrorMessage } from '../services/api';
import { Share2, Loader2, RefreshCw, Search, MessageSquareText, MessageSquareQuote, X, List, Network, AlertCircle } from 'lucide-react';
import { PageHeader } from '../motion';

interface ConceptGraphProps {
  documentCount: number;
  onAskTutor: (request: ConceptRequest) => void;
  onTeachBack: (request: ConceptRequest) => void;
}

// Validated categorical slots (all-pairs safe for up to three categories); identity is never
// color-alone: nodes are labelled, a legend is shown, and a list view is available.
const CATEGORY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a'];
const SHARED_RING = '#0f172a';
const EDGE = '#cbd5e1';
const ACCENT = '#6366f1';

interface Category {
  key: string;
  label: string;
  color: string;
  documentIds: string[];
}

/** Up to three document colors; with more documents the smaller ones fold into "Other documents". */
const buildCategories = (graph: Graph): Category[] => {
  const mapped = graph.documents.filter(d => d.mapped).sort((a, b) => b.concepts - a.concepts);
  if (mapped.length <= 3) {
    return mapped.map((d, i) => ({ key: d.id, label: d.title, color: CATEGORY_COLORS[i], documentIds: [d.id] }));
  }
  return [
    ...mapped.slice(0, 2).map((d, i) => ({ key: d.id, label: d.title, color: CATEGORY_COLORS[i], documentIds: [d.id] })),
    { key: 'other', label: `Other documents (${mapped.length - 2})`, color: CATEGORY_COLORS[2], documentIds: mapped.slice(2).map(d => d.id) },
  ];
};

export const ConceptGraph: React.FC<ConceptGraphProps> = ({ documentCount, onAskTutor, onTeachBack }) => {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Below the large layout the details panel sits under the graph: bring it into view when a concept is picked
  const detailsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selectedId || window.matchMedia('(min-width: 1024px)').matches) return;
    const id = window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => window.clearTimeout(id);
  }, [selectedId]);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const load = async (rebuild = false) => {
    setIsLoading(true);
    setError(null);
    try {
      setGraph(await graphAPI.get(rebuild));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to build the concept graph.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const categories = useMemo(() => (graph ? buildCategories(graph) : []), [graph]);
  const categoryOf = (node: GraphNode) =>
    categories.find(c => node.documents.some(d => c.documentIds.includes(d.id))) ?? categories[0];

  // Nodes whose documents are all hidden by the filter are removed
  const visibleNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter(n => n.documents.some(d => !hidden.has(categories.find(c => c.documentIds.includes(d.id))?.key ?? '')));
  }, [graph, hidden, categories]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => (graph?.edges ?? []).filter(e => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [graph, visibleIds]
  );
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map(n => [n.id, n])), [graph]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;

  // (Re)build the cytoscape graph when data or filters change
  useEffect(() => {
    if (view !== 'graph' || !containerRef.current || !graph) return;
    const maxDegree = Math.max(1, ...visibleNodes.map(n => n.degree));
    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...visibleNodes.map(n => ({
          data: { id: n.id, name: n.name, degree: n.degree, color: categoryOf(n)?.color ?? CATEGORY_COLORS[0], shared: n.documents.length > 1 ? 1 : 0 },
        })),
        ...visibleEdges.map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target, label: e.label } })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(name)',
            width: `mapData(degree, 0, ${maxDegree}, 22, 58)`,
            height: `mapData(degree, 0, ${maxDegree}, 22, 58)`,
            'font-size': 11,
            'font-weight': 600,
            color: '#334155',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-wrap': 'wrap',
            'text-max-width': '110px',
            'text-outline-color': '#ffffff',
            'text-outline-width': 2,
            'border-width': 2,
            'border-color': '#ffffff',
          },
        },
        { selector: 'node[shared = 1]', style: { 'border-width': 4, 'border-color': SHARED_RING } },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': EDGE,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': EDGE,
            'arrow-scale': 0.8,
          },
        },
        { selector: '.faded', style: { opacity: 0.15 } },
        {
          selector: 'edge.active',
          style: {
            'line-color': ACCENT,
            'target-arrow-color': ACCENT,
            width: 2,
            label: 'data(label)',
            'font-size': 10,
            color: '#4338ca',
            'text-rotation': 'autorotate',
            'text-background-color': '#ffffff',
            'text-background-opacity': 1,
            'text-background-padding': '2px',
          },
        },
        { selector: 'node.focus', style: { 'overlay-color': ACCENT, 'overlay-opacity': 0.15, 'overlay-padding': 6 } },
      ],
      layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: () => 9000, idealEdgeLength: () => 90 } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 3,
    });
    cy.on('tap', 'node', evt => setSelectedId(evt.target.id()));
    cy.on('tap', evt => { if (evt.target === cy) setSelectedId(null); });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, visibleNodes, visibleEdges, view]);

  // Highlight the selected concept's neighbourhood
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('faded active focus');
    if (!selectedId) return;
    const node = cy.getElementById(selectedId);
    if (node.empty()) return;
    const neighbourhood = node.closedNeighborhood();
    cy.elements().difference(neighbourhood).addClass('faded');
    node.connectedEdges().addClass('active');
    node.addClass('focus');
    cy.animate({ center: { eles: node }, duration: 300 });
  }, [selectedId, graph, visibleNodes]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = visibleNodes.find(n => n.name.toLowerCase() === q) ?? visibleNodes.find(n => n.name.toLowerCase().includes(q));
    if (match) setSelectedId(match.id);
  };

  const toggleCategory = (key: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const connections = useMemo(() => {
    if (!selected || !graph) return [];
    return graph.edges
      .filter(e => e.source === selected.id || e.target === selected.id)
      .map(e => {
        const outgoing = e.source === selected.id;
        const other = nodeById.get(outgoing ? e.target : e.source);
        return { label: e.label, outgoing, other };
      })
      .filter(c => c.other);
  }, [selected, graph, nodeById]);

  if (documentCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
          <AlertCircle className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-semibold text-slate-700">Concept Graph</h3>
        <p className="text-slate-400 mt-2">Upload documents to see how their ideas connect.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto p-6 md:p-8 pb-16">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
        <PageHeader
          icon={<Share2 className="w-5 h-5 text-sky-600" />}
          eyebrow="Connected knowledge"
          tone="text-sky-600"
          title="Concept Graph"
          accent={['Graph']}
          subtitle={
            <span className="text-base">
              How the ideas across your documents connect.
              {graph && ` ${graph.nodes.length} concepts, ${graph.edges.length} links, ${graph.shared_concepts} shared between documents.`}
            </span>
          }
        />
        <div className="flex flex-wrap items-center gap-2 animate-rise" style={{ animationDelay: '300ms', animationFillMode: 'backwards' }}>
          <form onSubmit={handleSearch} className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              list="concept-names"
              placeholder="Find a concept"
              aria-label="Find a concept"
              className="pl-9 pr-3 py-2 rounded-xl border-slate-200 bg-white text-sm w-56 focus:border-indigo-500 focus:ring-indigo-500"
            />
            <datalist id="concept-names">
              {visibleNodes.map(n => <option key={n.id} value={n.name} />)}
            </datalist>
          </form>
          <div className="flex bg-slate-100 rounded-xl p-1" role="group" aria-label="View">
            <button onClick={() => setView('graph')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${view === 'graph' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
              <Network className="w-4 h-4" /> Graph
            </button>
            <button onClick={() => setView('list')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${view === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
              <List className="w-4 h-4" /> List
            </button>
          </div>
          <button onClick={() => load(true)} disabled={isLoading} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /> Rebuild
          </button>
        </div>
      </div>

      {/* Legend + filters (one row above the chart) */}
      {graph && categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {categories.map(c => (
            <button
              key={c.key}
              onClick={() => toggleCategory(c.key)}
              aria-pressed={!hidden.has(c.key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all max-w-[18rem] ${hidden.has(c.key) ? 'bg-white border-slate-200 text-slate-400' : 'bg-white border-slate-300 text-slate-700 shadow-sm'}`}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: hidden.has(c.key) ? '#e2e8f0' : c.color }} />
              <span className="truncate">{c.label}</span>
            </button>
          ))}
          <span className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-500">
            <span className="w-3.5 h-3.5 rounded-full border-[3px] bg-white" style={{ borderColor: SHARED_RING }} />
            Shared across documents
          </span>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl p-3">{error}</p>}
      {graph && graph.failed.length > 0 && (
        <p className="mb-4 text-sm text-amber-800 bg-amber-50 rounded-xl p-3">
          {graph.failed.length} document{graph.failed.length === 1 ? ' was' : 's were'} skipped because the AI service was busy. Use Rebuild to try again.
        </p>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0 bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden relative">
          {isLoading && (
            <div className="absolute inset-0 z-10 bg-white/80 flex flex-col items-center justify-center text-center p-6">
              <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
              <p className="font-semibold text-slate-700">Mapping concepts across your documents...</p>
              <p className="text-sm text-slate-400 mt-1">The first time takes a little while per document; after that it's instant.</p>
            </div>
          )}
          {view === 'graph' ? (
            <div ref={containerRef} className="h-[60dvh] min-h-[320px] md:h-[620px] w-full bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:18px_18px]" role="img" aria-label="Concept graph. Use the List view for an accessible version." />
          ) : (
            <div className="max-h-[60dvh] md:max-h-[620px] overflow-y-auto" data-lenis-prevent>
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Concept</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Documents</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Links</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {visibleNodes.map(n => (
                    <tr key={n.id} onClick={() => setSelectedId(n.id)} className={`cursor-pointer hover:bg-slate-50 ${selectedId === n.id ? 'bg-indigo-50/60' : ''}`}>
                      <td className="px-5 py-3">
                        <p className="font-semibold text-slate-800">{n.name}</p>
                        <p className="text-xs text-slate-500 line-clamp-1">{n.description}</p>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{n.documents.map(d => d.title).join(', ')}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">{n.degree}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Details panel */}
        <aside ref={detailsRef} className="lg:w-80 flex-shrink-0 scroll-mt-20">
          {selected ? (
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 lg:sticky lg:top-4 animate-scale-in">
              <div className="flex items-start justify-between gap-3 mb-3">
                <h2 className="text-xl font-display font-bold text-slate-900 min-w-0 break-anywhere">{selected.name}</h2>
                <button onClick={() => setSelectedId(null)} className="p-2 -m-1 rounded-lg flex-shrink-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {selected.description && <p className="text-sm text-slate-600 leading-relaxed mb-4">{selected.description}</p>}

              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Appears in</h3>
              <ul className="space-y-1.5 mb-5">
                {selected.documents.map(d => {
                  const color = categories.find(c => c.documentIds.includes(d.id))?.color;
                  return (
                    <li key={d.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="truncate">{d.title}</span>
                    </li>
                  );
                })}
              </ul>

              {connections.length > 0 && (
                <>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Connections</h3>
                  <ul className="space-y-1 mb-5 max-h-56 overflow-y-auto">
                    {connections.map((c, i) => (
                      <li key={i}>
                        <button onClick={() => setSelectedId(c.other!.id)} className="w-full text-left text-sm px-2 py-1.5 -mx-2 rounded-lg hover:bg-slate-50">
                          <span className="text-slate-400">{c.outgoing ? c.label : `${c.label} ←`}</span>{' '}
                          <span className="font-semibold text-indigo-700">{c.other!.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="space-y-2">
                <button
                  onClick={() => onAskTutor({ documentId: selected.documents[0].id, concept: selected.name })}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
                >
                  <MessageSquareText className="w-4 h-4" /> Ask the AI tutor
                </button>
                <button
                  onClick={() => onTeachBack({ documentId: selected.documents[0].id, concept: selected.name })}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal-50 text-teal-700 text-sm font-bold hover:bg-teal-100 transition-colors"
                >
                  <MessageSquareQuote className="w-4 h-4" /> Teach it back
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white/60 rounded-3xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
              <p className="font-semibold text-slate-700 mb-1">Explore your knowledge</p>
              <p>Click a concept to see what it means, where it appears and how it connects. Bigger circles are more connected; ringed circles appear in more than one document.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
