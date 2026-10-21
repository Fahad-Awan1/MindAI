import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowUp, Check, FileText, FolderOpen, Loader2, MessageSquareText, Pencil, Plus, Trash2, Upload, X,
} from 'lucide-react';
import { DocumentFile, Project, ProjectColor, ProjectDetail } from '../../types';
import { getErrorMessage, projectsAPI } from '../../services/api';
import { useBackHandler } from '../../hooks/useBackHandler';
import { COLOR_NAMES, projectColor } from './colors';

interface ProjectPageProps {
  projectId: string;
  documents: DocumentFile[];
  /** Leave the project page (back to the chat) */
  onBack: () => void;
  /** The project was edited (name, colour, documents...) */
  onChanged: () => void;
  onDeleted: () => void;
  /** Upload a file to the library; resolves with the new document (or null when it failed) */
  onUpload: (file: File) => Promise<DocumentFile | null>;
  onOpenChat: (conversationId: string) => void;
  /** Open a new chat in the project, optionally sending a first message */
  onStartChat: (projectId: string, message?: string) => void;
  /** What is already known (shown at once while the full project loads) */
  initial?: ProjectDetail | null;
  /** `initial` is complete (a project just created): its documents need no loading */
  initialComplete?: boolean;
}

const UPLOAD_ACCEPT = '.txt,.md,.pdf,.docx,.pptx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';

const ago = (t: number) => {
  const minutes = Math.round((Date.now() - t) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
};

// --- Create / edit dialog ---------------------------------------------------------------------------

interface ProjectFormValues { name: string; description: string; instructions: string; color: ProjectColor }

/** Create a project (no `initial`) or edit one */
export const ProjectForm: React.FC<{
  initial?: Project;
  onCancel: () => void;
  onSave: (values: ProjectFormValues) => Promise<void>;
}> = ({ initial, onCancel, onSave }) => {
  const [values, setValues] = useState<ProjectFormValues>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    instructions: initial?.instructions ?? '',
    color: initial?.color ?? 'indigo',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBackHandler(onCancel);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.name.trim()) { setError('Give the project a name.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save the project.'));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={initial ? 'Edit project' : 'New project'}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onCancel} />
      <form onSubmit={submit} className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto animate-scale-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-display font-bold text-slate-900">{initial ? 'Edit project' : 'New project'}</h2>
          <button type="button" onClick={onCancel} className="p-2 -m-2 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5" htmlFor="project-name">Name</label>
        <input id="project-name" autoFocus value={values.name} maxLength={80} placeholder="e.g. BIO-101 Final exam"
          onChange={e => setValues({ ...values, name: e.target.value })}
          className="w-full rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 mb-4" />

        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5" htmlFor="project-description">What it's about <span className="normal-case font-normal text-slate-400">(optional)</span></label>
        <input id="project-description" value={values.description} maxLength={500} placeholder="e.g. Cell biology and genetics, semester 2"
          onChange={e => setValues({ ...values, description: e.target.value })}
          className="w-full rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 mb-4" />

        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5" htmlFor="project-instructions">Instructions for MindAI <span className="normal-case font-normal text-slate-400">(optional)</span></label>
        <textarea id="project-instructions" value={values.instructions} maxLength={4000} rows={4}
          placeholder="e.g. Explain in simple English, use examples from Pakistan, and end every answer with one practice question."
          onChange={e => setValues({ ...values, instructions: e.target.value })}
          className="w-full rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 text-sm mb-4" />

        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Colour</p>
        <div className="flex flex-wrap gap-2 mb-6" role="radiogroup" aria-label="Colour">
          {COLOR_NAMES.map(name => (
            <button key={name} type="button" role="radio" aria-checked={values.color === name} aria-label={name}
              onClick={() => setValues({ ...values, color: name })}
              className={`w-9 h-9 rounded-full flex items-center justify-center ${projectColor(name).dot} ${values.color === name ? `ring-2 ring-offset-2 ${projectColor(name).ring}` : ''}`}>
              {values.color === name && <Check className="w-4 h-4 text-white" />}
            </button>
          ))}
        </div>

        {error && <p className="mb-4 text-sm text-rose-600" role="alert">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 py-3 rounded-xl border border-slate-200 font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {initial ? 'Save' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
};

// --- One project (shown inside AI Chat) -------------------------------------------------------------

/** A project's page: start a chat in it, its chats, its instructions for the AI and its documents */
export const ProjectPage: React.FC<ProjectPageProps> = ({ projectId, documents, onBack, onChanged, onDeleted, onUpload, onOpenChat, onStartChat, initial, initialComplete }) => {
  const [project, setProject] = useState<ProjectDetail | null>(initial ?? null);
  // The project's documents have arrived from the server (until then that section shows a spinner)
  const [loaded, setLoaded] = useState(!!initialComplete);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState('');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const instructionsEdited = useRef(false);
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [adding, setAdding] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useBackHandler(onBack, !editing);

  const load = useCallback(async () => {
    try {
      const detail = await projectsAPI.get(projectId);
      setProject(detail);
      setLoaded(true);
      // Don't overwrite instructions the student is typing
      if (!instructionsEdited.current) setInstructions(detail.instructions);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not open the project.'));
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-slate-500 mb-6"><ArrowLeft className="w-4 h-4" /> Back to chat</button>
        <p className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-rose-700">{error}</p>
      </div>
    );
  }
  if (!project) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  }

  const color = projectColor(project.color);
  const inProject = new Set(project.documents.map(d => d.id));
  const addable = documents.filter(d => !inProject.has(d.id));
  const instructionsDirty = instructions.trim() !== project.instructions.trim();

  const run = async (action: () => Promise<void>, failure: string) => {
    setNotice(null);
    try {
      await action();
      await load();
      onChanged();
    } catch (err) {
      setNotice(`${failure}: ${getErrorMessage(err, 'please try again.')}`);
    }
  };

  /** Show a document added / removed at once; undo it if the server says no */
  const changeDocuments = async (next: ProjectDetail['documents'], action: () => Promise<void>, failure: string) => {
    const before = project.documents;
    setProject(p => (p ? { ...p, documents: next, document_count: next.length } : p));
    setNotice(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setProject(p => (p ? { ...p, documents: before, document_count: before.length } : p));
      setNotice(`${failure}: ${getErrorMessage(err, 'please try again.')}`);
    }
  };

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim()) onStartChat(project.id, question.trim());
  };

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 md:py-8 pb-28">
      <p className="page-eyebrow text-slate-400 mb-3">Project</p>
      <header className="flex items-start gap-4 mb-6">
        <span className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br ${color.gradient} text-white flex items-center justify-center shadow-lg flex-shrink-0`}>
          <FolderOpen className="w-6 h-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl md:text-3xl font-display font-bold text-slate-900 break-words">{project.name}</h1>
          {project.description && <p className="text-slate-500 mt-1">{project.description}</p>}
        </div>
        <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 flex-shrink-0">
          <Pencil className="w-4 h-4" /> <span className="hidden sm:inline">Edit</span>
        </button>
      </header>

      {notice && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Ask: starts a new chat in the project */}
      <form onSubmit={ask} className="relative mb-8">
        <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} maxLength={8000}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); ask(e); } }}
          placeholder={`Start a new chat in ${project.name}…`} aria-label="Start a new chat in this project"
          className="w-full rounded-2xl border-slate-200 bg-white shadow-lg shadow-slate-200/60 pr-14 py-4 pl-4 text-[15px] focus:border-indigo-400 focus:ring-indigo-500/20 resize-none" />
        <button type="submit" disabled={!question.trim()} aria-label="Start chat"
          className={`absolute right-3 bottom-3 w-10 h-10 rounded-xl bg-gradient-to-br ${color.gradient} text-white flex items-center justify-center shadow-md disabled:opacity-40`}>
          <ArrowUp className="w-5 h-5" />
        </button>
      </form>

      {/* grid-cols-1 = minmax(0, 1fr): on a phone a long document name must not stretch the column past the screen */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        {/* Chats */}
        <section className="md:col-span-3 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Chats <span className="text-slate-400 font-semibold">· {project.chats.length}</span></h2>
            <button onClick={() => onStartChat(project.id)} className={`flex items-center gap-1 text-sm font-bold ${color.text}`}><Plus className="w-4 h-4" /> New chat</button>
          </div>
          {project.chats.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 text-center">No chats yet. Ask something above to start one.</p>
          ) : (
            <ul className="rounded-2xl bg-white border border-slate-100 shadow-sm divide-y divide-slate-100 overflow-hidden">
              {project.chats.map(chat => (
                <li key={chat.id}>
                  <button onClick={() => onOpenChat(chat.id)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50">
                    <MessageSquareText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-medium text-slate-800">{chat.title}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">{ago(chat.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="md:col-span-2 space-y-6 min-w-0">
          {/* Instructions */}
          <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-1">Instructions</h2>
            <p className="text-xs text-slate-400 mb-2">MindAI follows these in every chat of this project.</p>
            <textarea value={instructions} onChange={e => { instructionsEdited.current = true; setInstructions(e.target.value); }} rows={5} maxLength={4000}
              placeholder="e.g. Answer in simple English and end with one practice question."
              className="w-full rounded-xl border-slate-200 text-sm focus:border-indigo-400 focus:ring-indigo-500/20" />
            {instructionsDirty && (
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => { instructionsEdited.current = false; setInstructions(project.instructions); }} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-100">Discard</button>
                <button disabled={savingInstructions}
                  onClick={async () => { setSavingInstructions(true); instructionsEdited.current = false; await run(() => projectsAPI.update(project.id, { instructions }).then(() => undefined), "Couldn't save the instructions"); setSavingInstructions(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-60">
                  {savingInstructions && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
                </button>
              </div>
            )}
          </section>

          {/* Documents */}
          <section className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-1">Documents <span className="text-slate-400 font-semibold">· {loaded ? project.documents.length : project.document_count}</span></h2>
            <p className="text-xs text-slate-400 mb-3">Chats in this project answer from these.</p>
            {!loaded ? (
              <p className="flex items-center gap-2 py-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading documents…</p>
            ) : (<>
            {project.documents.length > 0 && (
              <ul className="space-y-1 mb-3">
                {project.documents.map(doc => (
                  <li key={doc.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-700">{doc.title}</span>
                    <button onClick={() => changeDocuments(project.documents.filter(d => d.id !== doc.id), () => projectsAPI.removeDocument(project.id, doc.id), "Couldn't remove the document")}
                      className="p-1.5 rounded-md text-slate-300 hover:text-rose-500 hover:bg-rose-50" aria-label={`Remove ${doc.title} from the project`}>
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {addable.length > 0 && (
              <div className="flex gap-2 mb-2">
                <select value={adding} onChange={e => setAdding(e.target.value)} aria-label="Add a document from your library"
                  className="flex-1 min-w-0 w-full rounded-lg border-slate-200 text-sm py-2 truncate">
                  <option value="">Add from your library…</option>
                  {addable.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
                <button disabled={!adding} aria-label="Add document"
                  onClick={() => {
                    const doc = documents.find(d => d.id === adding);
                    setAdding('');
                    if (doc) changeDocuments([{ id: doc.id, title: doc.title, type: doc.type, created_at: doc.created_at }, ...project.documents],
                      () => projectsAPI.addDocument(project.id, doc.id), "Couldn't add the document");
                  }}
                  className="px-3 rounded-lg bg-slate-900 text-white disabled:opacity-40"><Plus className="w-4 h-4" /></button>
              </div>
            )}
            <label className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border-2 border-dashed border-slate-200 text-sm font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-600 cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Upload a file'}
              <input type="file" accept={UPLOAD_ACCEPT} className="sr-only" onChange={async e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setUploading(true);
                const doc = await onUpload(file);
                if (doc) await run(() => projectsAPI.addDocument(project.id, doc.id), "Couldn't add the document");
                setUploading(false);
              }} />
            </label>
            </>)}
          </section>

          {/* Delete */}
          <section className="rounded-2xl border border-rose-100 p-4">
            {confirmDelete ? (
              <>
                <p className="text-sm font-semibold text-slate-800">Delete "{project.name}"?</p>
                <p className="text-xs text-slate-500 mt-1 mb-3">Its {project.chats.length} chat{project.chats.length === 1 ? '' : 's'} will be deleted. Documents stay in your library.</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600">Cancel</button>
                  <button onClick={async () => {
                    try { await projectsAPI.delete(project.id); onDeleted(); } catch (err) { setNotice(`Couldn't delete the project: ${getErrorMessage(err, 'please try again.')}`); setConfirmDelete(false); }
                  }} className="flex-1 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold">Delete</button>
                </div>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-2 text-sm font-semibold text-rose-600"><Trash2 className="w-4 h-4" /> Delete project</button>
            )}
          </section>
        </div>
      </div>

      {editing && (
        <ProjectForm initial={project} onCancel={() => setEditing(false)} onSave={async values => {
          await projectsAPI.update(project.id, values);
          setEditing(false);
          await load();
          onChanged();
        }} />
      )}
    </div>
  );
};
