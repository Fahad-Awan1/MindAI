
import React, { useEffect, useState, useRef } from 'react';
import { DocumentFile } from '../types';
import { Tooltip } from './Tooltip';
import { FileText, Trash2, File, Presentation, Plus, FolderOpen, Clock, Loader2, Mic, Globe } from 'lucide-react';
import { ImportPanel, isMediaFile } from './ImportPanel';
import { importsAPI, getErrorMessage } from '../services/api';
import { PageHeader, CountUp, Reveal } from '../motion';
import { scrollToElement } from '../motion/useLenis';

interface DocumentListProps {
  documents: DocumentFile[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (id: string) => void;
  onSelect: (doc: DocumentFile) => void;
  /** A lecture/link import finished: refresh the library */
  onImported: (documentId: string) => void;
  onOpenDocument: (documentId: string) => void;
}

interface UploadingFile {
  key: number;
  file: File;
}

export const DocumentList: React.FC<DocumentListProps> = ({ documents, onUpload, onDelete, onSelect, onImported, onOpenDocument }) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const nextKeyRef = useRef(0);
  // The newest upload's card: scrolled into view as soon as it appears so its progress is visible
  const newestUploadRef = useRef<HTMLDivElement>(null);
  const uploadCount = useRef(0);
  useEffect(() => {
    const grew = uploadingFiles.length > uploadCount.current;
    uploadCount.current = uploadingFiles.length;
    if (!grew) return;
    const id = window.setTimeout(() => { if (newestUploadRef.current) scrollToElement(newestUploadRef.current, { offset: -140 }); }, 80);
    return () => window.clearTimeout(id);
  }, [uploadingFiles.length]);

  // Show a placeholder card while each file uploads; remove it once the upload settles (success or failure)
  const [importRefresh, setImportRefresh] = useState(0);

  const startUploads = (files: FileList) => {
    // Recordings dropped here go to Lecture-to-Notes instead of the document upload
    const media = Array.from(files).filter(f => isMediaFile(f.name));
    media.forEach(file => {
      importsAPI.uploadMedia(file)
        .then(() => setImportRefresh(n => n + 1))
        .catch(err => alert(`Could not import "${file.name}": ${getErrorMessage(err, 'Please try again.')}`));
    });
    Array.from(files).filter(f => !isMediaFile(f.name)).forEach(file => {
      const key = nextKeyRef.current++;
      setUploadingFiles(prev => [...prev, { key, file }]);
      onUpload(file).finally(() => {
        setUploadingFiles(prev => prev.filter(u => u.key !== key));
      });
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      startUploads(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      startUploads(e.target.files);
      e.target.value = ''; // Allow re-selecting the same file
    }
  };

  const handleDelete = (doc: DocumentFile) => {
    if (window.confirm(`Delete "${doc.title}"? This also removes its chat history.`)) {
      onDelete(doc.id);
    }
  };

  const getFileIcon = (type: string) => {
    const iconProps = "w-6 h-6";
    // Normalize type from extension or mime
    const normalizedType = type.toLowerCase();
    
    if (normalizedType === 'pdf') return <Tooltip content="PDF Document"><div className="bg-rose-50 p-2.5 rounded-xl border border-rose-100"><FileText className={`${iconProps} text-rose-500`} /></div></Tooltip>;
    if (normalizedType === 'docx' || normalizedType === 'doc') return <Tooltip content="Word Document"><div className="bg-blue-50 p-2.5 rounded-xl border border-blue-100"><File className={`${iconProps} text-blue-500`} /></div></Tooltip>;
    if (normalizedType === 'lecture' || isMediaFile(`x.${normalizedType}`)) return <Tooltip content="Lecture notes"><div className="bg-rose-50 p-2.5 rounded-xl border border-rose-100"><Mic className={`${iconProps} text-rose-500`} /></div></Tooltip>;
    if (normalizedType === 'web') return <Tooltip content="Web article"><div className="bg-sky-50 p-2.5 rounded-xl border border-sky-100"><Globe className={`${iconProps} text-sky-500`} /></div></Tooltip>;
    if (normalizedType === 'pptx' || normalizedType === 'ppt') return <Tooltip content="PowerPoint Presentation"><div className="bg-orange-50 p-2.5 rounded-xl border border-orange-100"><Presentation className={`${iconProps} text-orange-500`} /></div></Tooltip>;
    
    return <Tooltip content="Text File"><div className="bg-indigo-50 p-2.5 rounded-xl border border-indigo-100"><FileText className={`${iconProps} text-indigo-500`} /></div></Tooltip>;
  };

  return (
    <div className="p-6 md:p-12 w-full max-w-[1400px] mx-auto pb-32">

      {/* Header Section */}
      <PageHeader
        className="mb-10"
        eyebrow="Your knowledge hub"
        tone="text-indigo-600"
        title="Your Library"
        accent={['Library']}
        subtitle="Upload materials to unlock AI insights: chat, quizzes, flashcards and more."
        actions={
          <Tooltip content="Total documents available for analysis" position="left">
            <div className="flex items-center gap-2 bg-white/80 backdrop-blur border border-slate-200 px-4 py-2 rounded-full shadow-sm cursor-default">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-sm font-bold text-slate-600"><CountUp value={documents.length} /> Documents Synced</span>
            </div>
          </Tooltip>
        }
      />

      {/* Hero Upload Zone */}
      <Reveal delay={200} className="mb-16">
      <Tooltip content="Click or drag files to upload" position="top" className="w-full block">
        <div
            data-cursor="Upload"
            className={`spotlight w-full relative group overflow-hidden rounded-[2rem] transition-all duration-700 ease-out-expo cursor-pointer
            ${dragActive
                ? 'bg-indigo-50/70 ring-4 ring-indigo-200 scale-[1.015] border-2 border-dashed border-indigo-400'
                : 'bg-white/90 hover:shadow-2xl hover:shadow-indigo-100/60 border-2 border-dashed border-slate-200 hover:border-indigo-300'}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-upload')?.click()}
        >
            <input 
            type="file" 
            id="file-upload" 
            className="hidden" 
            accept=".txt,.md,.pdf,.docx,.pptx,.mp3,.m4a,.wav,.mp4,.webm,.mov,.ogg,.flac,.aac"
            multiple
            onChange={handleFileChange}
            />
            
            <div className="absolute inset-0 opacity-[0.05] bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none"></div>
            <div className={`mesh-blob w-80 h-80 -top-32 -left-20 bg-indigo-200/50 transition-opacity duration-700 ${dragActive ? 'opacity-90' : 'opacity-0 group-hover:opacity-60'}`}></div>
            <div className={`mesh-blob w-72 h-72 -bottom-32 -right-10 bg-fuchsia-200/50 transition-opacity duration-700 ${dragActive ? 'opacity-90' : 'opacity-0 group-hover:opacity-60'}`} style={{ animationDelay: '-6s' }}></div>
            
            <div className="py-16 px-8 flex flex-col items-center justify-center text-center relative z-10">
            <div className="relative mb-6">
              <span className={`absolute inset-0 rounded-full bg-indigo-400/40 ${dragActive ? 'animate-ping' : 'opacity-0'}`}></span>
              <div className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-700 ease-out-expo
                  ${dragActive ? 'bg-indigo-600 text-white scale-125 rotate-90 shadow-xl shadow-indigo-500/30' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white group-hover:scale-110 group-hover:rotate-90 group-hover:shadow-xl group-hover:shadow-indigo-500/20'}`}>
                  <Plus className="w-8 h-8 stroke-[3px]" />
              </div>
            </div>
            
            <h3 className="text-2xl font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">
                {dragActive ? "Drop file to upload" : "Add New Document"}
            </h3>
            <p className="text-slate-400 font-medium max-w-md mx-auto">
                Drag & drop or click to upload PDF, DOCX, PPTX, Markdown or Text files - or a lecture recording to turn into notes.
            </p>
            </div>
        </div>
      </Tooltip>
      </Reveal>

      <ImportPanel onImported={onImported} onOpenDocument={onOpenDocument} refreshKey={importRefresh} />

      {/* Document Grid */}
      {(documents.length === 0 && uploadingFiles.length === 0) ? (
        <div className="text-center py-20 animate-rise">
          <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-float">
             <FolderOpen className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-700">Your library is empty</h3>
          <p className="text-slate-400 mt-2">Upload your first document to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          
          {/* Ghost Cards for Uploading Files */}
          {uploadingFiles.map(({ key, file }, index) => (
            <div
                key={`upload-${key}`}
                ref={index === uploadingFiles.length - 1 ? newestUploadRef : undefined}
                className="relative bg-white rounded-2xl p-1 border border-indigo-100 shadow-lg shadow-indigo-100/50 h-[260px] flex flex-col animate-pop"
            >
               <div className="h-full w-full bg-white rounded-xl p-5 flex flex-col relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4">
                        {getFileIcon(file.name.split('.').pop() || 'txt')}
                        <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                    </div>
                    
                    <h3 className="font-bold text-lg text-slate-800 mb-2 line-clamp-2 leading-tight opacity-75">
                        {file.name}
                    </h3>
                    
                    <div className="flex-1 flex flex-col justify-center">
                        <div className="w-full bg-slate-100 rounded-full h-2 mb-3 overflow-hidden">
                            <div className="h-2 rounded-full w-full bg-[linear-gradient(90deg,#e0e7ff,#6366f1,#a855f7,#e0e7ff)] bg-[length:200%_100%] animate-shimmer"></div>
                        </div>
                        <p className="text-xs text-indigo-500 font-bold uppercase tracking-wide animate-pulse">
                            Processing Content...
                        </p>
                    </div>
               </div>
            </div>
          ))}

          {/* Actual Documents */}
          {documents.map((doc, idx) => (
            <div 
                key={doc.id} 
                onClick={() => onSelect(doc)}
                data-cursor="Chat"
                className="spotlight lift group relative bg-white rounded-2xl p-1 border border-slate-100 shadow-sm hover:border-indigo-100 cursor-pointer h-[260px] flex flex-col"
                style={{ animation: `rise 0.9s cubic-bezier(0.16, 1, 0.3, 1) ${Math.min(idx, 12) * 0.06}s backwards` }}
            >
              <div className="h-full w-full bg-white/60 rounded-xl p-5 flex flex-col relative overflow-hidden transition-colors">
                <div className="absolute -right-10 -top-10 w-32 h-32 rounded-full bg-gradient-to-br from-indigo-100 to-fuchsia-100 opacity-0 scale-50 group-hover:opacity-70 group-hover:scale-100 transition-all duration-700 ease-out-expo pointer-events-none"></div>
                <Tooltip content="Click to chat with this document" position="top" className="absolute inset-0 w-full h-full z-0" delay={800}>
                    <div className="w-full h-full"></div>
                </Tooltip>
                
                <div className="flex justify-between items-start mb-4 relative z-10">
                   <div className="transition-transform duration-700 ease-out-expo group-hover:-rotate-6 group-hover:scale-110">{getFileIcon(doc.type)}</div>
                   <Tooltip content="Delete document" position="left">
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(doc); }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 opacity-60 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500 transition-all"
                        aria-label="Delete document"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                   </Tooltip>
                </div>
                
                <h3 className="font-bold text-lg text-slate-800 mb-2 line-clamp-2 leading-tight group-hover:text-indigo-600 transition-colors relative z-10">
                    {doc.title}
                </h3>
                
                <div className="flex-1 relative z-10">
                    <p className="text-sm text-slate-500 leading-relaxed line-clamp-3">
                        {doc.summary || doc.content?.slice(0, 150) || "Ready for AI analysis..."}
                    </p>
                </div>
                
                <div className="pt-4 mt-2 border-t border-slate-100 flex items-center justify-between relative z-10">
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-1 rounded">
                      {doc.type}
                   </span>
                   <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(doc.created_at).toLocaleDateString()}
                   </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
