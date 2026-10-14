
import React, { useState, useEffect, useRef } from 'react';
import { DocumentFile } from '../types';
import { Tooltip } from './Tooltip';
import { FileText, Trash2, UploadCloud, File, Presentation, FileCode, Plus, Sparkles, FolderOpen, Clock, FileType, Loader2 } from 'lucide-react';

interface DocumentListProps {
  documents: DocumentFile[];
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onSelect: (doc: DocumentFile) => void;
}

export const DocumentList: React.FC<DocumentListProps> = ({ documents, onUpload, onDelete, onSelect }) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const prevDocCountRef = useRef(documents.length);

  // Monitor documents to clear uploading queue when a new document is added
  useEffect(() => {
    if (documents.length > prevDocCountRef.current) {
       const latest = documents[0];
       setUploadingFiles(prev => prev.filter(f => f.name !== latest.title));
    }
    prevDocCountRef.current = documents.length;
  }, [documents]);

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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setUploadingFiles(prev => [...prev, file]);
      onUpload(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadingFiles(prev => [...prev, file]);
      onUpload(file);
      e.target.value = ''; // Allow re-selecting the same file
    }
  };

  const getFileIcon = (type: string) => {
    const iconProps = "w-6 h-6";
    // Normalize type from extension or mime
    const normalizedType = type.toLowerCase();
    
    if (normalizedType === 'pdf') return <Tooltip content="PDF Document"><div className="bg-rose-50 p-2.5 rounded-xl border border-rose-100"><FileText className={`${iconProps} text-rose-500`} /></div></Tooltip>;
    if (normalizedType === 'docx' || normalizedType === 'doc') return <Tooltip content="Word Document"><div className="bg-blue-50 p-2.5 rounded-xl border border-blue-100"><File className={`${iconProps} text-blue-500`} /></div></Tooltip>;
    if (normalizedType === 'pptx' || normalizedType === 'ppt') return <Tooltip content="PowerPoint Presentation"><div className="bg-orange-50 p-2.5 rounded-xl border border-orange-100"><Presentation className={`${iconProps} text-orange-500`} /></div></Tooltip>;
    
    return <Tooltip content="Text File"><div className="bg-indigo-50 p-2.5 rounded-xl border border-indigo-100"><FileText className={`${iconProps} text-indigo-500`} /></div></Tooltip>;
  };

  return (
    <div className="p-8 md:p-12 w-full max-w-[1400px] mx-auto animate-fade-in pb-32">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-end mb-10 gap-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-slate-900 tracking-tight mb-3">
            Library
          </h1>
          <p className="text-slate-500 text-lg max-w-2xl leading-relaxed">
            Your knowledge hub. Upload materials to unlock AI insights.
          </p>
        </div>
        <Tooltip content="Total documents available for analysis" position="left">
            <div className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-full shadow-sm cursor-default">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-sm font-bold text-slate-600">{documents.length} Documents Synced</span>
            </div>
        </Tooltip>
      </div>

      {/* Hero Upload Zone */}
      <Tooltip content="Click or drag files to upload" position="top" className="w-full block">
        <div 
            className={`relative mb-16 group overflow-hidden rounded-[2rem] transition-all duration-500 cursor-pointer
            ${dragActive 
                ? 'bg-indigo-50/50 ring-4 ring-indigo-100 scale-[1.01]' 
                : 'bg-white hover:shadow-2xl hover:shadow-indigo-100/50 border-2 border-dashed border-slate-200 hover:border-indigo-300'}`}
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
            accept=".txt,.md,.pdf,.docx,.pptx" 
            onChange={handleFileChange}
            />
            
            <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none"></div>
            
            <div className="py-16 px-8 flex flex-col items-center justify-center text-center relative z-10">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 mb-6
                ${dragActive ? 'bg-indigo-600 text-white scale-110 rotate-12 shadow-xl shadow-indigo-500/30' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white group-hover:scale-110 group-hover:rotate-12 group-hover:shadow-xl group-hover:shadow-indigo-500/20'}`}>
                <Plus className="w-8 h-8 stroke-[3px]" />
            </div>
            
            <h3 className="text-2xl font-bold text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">
                {dragActive ? "Drop file to upload" : "Add New Document"}
            </h3>
            <p className="text-slate-400 font-medium max-w-md mx-auto">
                Drag & drop or click to upload PDF, DOCX, PPTX, or Text files.
            </p>
            </div>
        </div>
      </Tooltip>

      {/* Document Grid */}
      {(documents.length === 0 && uploadingFiles.length === 0) ? (
        <div className="text-center py-20">
          <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-float">
             <FolderOpen className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-xl font-bold text-slate-700">Your library is empty</h3>
          <p className="text-slate-400 mt-2">Upload your first document to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          
          {/* Ghost Cards for Uploading Files */}
          {uploadingFiles.map((file, idx) => (
            <div 
                key={`upload-${idx}-${file.name}`} 
                className="relative bg-white rounded-2xl p-1 border border-indigo-100 shadow-lg shadow-indigo-100/50 h-[260px] flex flex-col"
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
                            <div className="bg-indigo-500 h-2 rounded-full animate-pulse w-full origin-left scale-x-50 translate-x-[-50%] animate-[slideInRight_1.5s_infinite]"></div>
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
                className="group relative bg-white rounded-2xl p-1 border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 transition-all duration-300 cursor-pointer h-[260px] flex flex-col"
                style={{ animation: `slideUp 0.5s ease-out ${idx * 0.05}s forwards`, opacity: 0 }}
            >
              <div className="h-full w-full bg-white rounded-xl p-5 flex flex-col relative overflow-hidden group-hover:bg-slate-50/50 transition-colors">
                <Tooltip content="Click to chat with this document" position="top" className="absolute inset-0 w-full h-full z-0" delay={800}>
                    <div className="w-full h-full"></div>
                </Tooltip>
                
                <div className="flex justify-between items-start mb-4 relative z-10">
                   {getFileIcon(doc.type)}
                   <Tooltip content="Delete document" position="left">
                    <button 
                        onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-colors"
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
                        {doc.summary || (doc.inlineData ? "Ready for AI analysis..." : doc.content.slice(0, 150))}
                    </p>
                </div>
                
                <div className="pt-4 mt-2 border-t border-slate-100 flex items-center justify-between relative z-10">
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-1 rounded">
                      {doc.type}
                   </span>
                   <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(doc.createdAt).toLocaleDateString()}
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
