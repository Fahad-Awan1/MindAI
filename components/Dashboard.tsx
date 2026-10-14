
import React from 'react';
import { DocumentFile, AppView } from '../types';
import { Tooltip } from './Tooltip';
import { FileText, BrainCircuit, Zap, GraduationCap, Plus, Clock, Sparkles, ChevronRight } from 'lucide-react';

interface DashboardProps {
  documents: DocumentFile[];
  onChangeView: (view: AppView) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ documents, onChangeView }) => {
  return (
    <div className="p-8 w-full max-w-7xl mx-auto animate-fade-in pb-20">
      {/* Hero Section */}
      <div className="relative bg-slate-900 rounded-[2.5rem] p-10 mb-10 text-white overflow-hidden shadow-2xl shadow-slate-900/20">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary-600 rounded-full blur-[100px] opacity-30 -translate-y-1/2 translate-x-1/3"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-indigo-600 rounded-full blur-[80px] opacity-20 translate-y-1/3 -translate-x-1/4"></div>
        
        <div className="relative z-10 flex justify-between items-end">
            <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-xs font-medium mb-4">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    AI System Online
                </div>
                <h2 className="text-4xl md:text-5xl font-display font-bold mb-4 tracking-tight">
                    Welcome back, Student.
                </h2>
                <p className="text-slate-300 max-w-xl text-lg leading-relaxed">
                    Your intelligent workspace is ready. You have <span className="text-white font-bold">{documents.length}</span> active documents analyzed and prepared for study.
                </p>
            </div>
            <div className="hidden lg:block">
                <Tooltip content="Open Chat Interface">
                    <button onClick={() => onChangeView(AppView.CHAT)} className="group bg-white text-slate-900 px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 transition-colors shadow-lg shadow-white/10">
                        Start AI Chat
                        <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                </Tooltip>
            </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <Tooltip content="View all uploaded files" className="w-full block">
            <div onClick={() => onChangeView(AppView.DOCUMENTS)} className="cursor-pointer bg-white p-6 rounded-3xl shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] border border-slate-100 flex items-center gap-5 transition-transform hover:-translate-y-1 duration-300">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30">
                <FileText className="w-8 h-8" />
            </div>
            <div>
                <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">Documents</p>
                <p className="text-3xl font-display font-bold text-slate-900">{documents.length}</p>
            </div>
            </div>
        </Tooltip>
        <div className="bg-white p-6 rounded-3xl shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] border border-slate-100 flex items-center gap-5 transition-transform hover:-translate-y-1 duration-300 cursor-default">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <BrainCircuit className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">Analysis Status</p>
            <p className="text-3xl font-display font-bold text-slate-900">{documents.length > 0 ? 'Active' : 'Idle'}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] border border-slate-100 flex items-center gap-5 transition-transform hover:-translate-y-1 duration-300 cursor-default">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Zap className="w-8 h-8" />
          </div>
          <div>
            <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">Study Tools</p>
            <p className="text-3xl font-display font-bold text-slate-900">Ready</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mb-12">
          <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-500" />
            Quick Actions
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Tooltip content="Add new study materials" className="w-full">
                <button onClick={() => onChangeView(AppView.DOCUMENTS)} className="w-full bg-gradient-to-br from-primary-600 to-indigo-700 text-white p-6 rounded-3xl shadow-xl shadow-primary-600/20 transition-all hover:scale-[1.02] hover:shadow-primary-600/30 flex flex-col items-start gap-4 group relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white opacity-10 rounded-full -translate-y-1/2 translate-x-1/3"></div>
                <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl">
                    <Plus className="w-6 h-6" />
                </div>
                <div className="text-left">
                    <span className="block font-bold text-lg">Upload File</span>
                    <span className="text-primary-200 text-sm">Add to knowledge base</span>
                </div>
                </button>
            </Tooltip>

            <Tooltip content="Generate a practice quiz" className="w-full">
                <button onClick={() => onChangeView(AppView.QUIZ)} className="w-full bg-white hover:bg-indigo-50 border border-slate-100 p-6 rounded-3xl shadow-sm transition-all hover:scale-[1.02] hover:border-indigo-200 flex flex-col items-start gap-4 group">
                <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl group-hover:bg-indigo-200 transition-colors">
                    <GraduationCap className="w-6 h-6" />
                </div>
                <div className="text-left">
                    <span className="block font-bold text-slate-900 text-lg">Practice Quiz</span>
                    <span className="text-slate-500 text-sm">Test your knowledge</span>
                </div>
                </button>
            </Tooltip>

            <Tooltip content="Review flashcards" className="w-full">
                <button onClick={() => onChangeView(AppView.FLASHCARDS)} className="w-full bg-white hover:bg-amber-50 border border-slate-100 p-6 rounded-3xl shadow-sm transition-all hover:scale-[1.02] hover:border-amber-200 flex flex-col items-start gap-4 group">
                <div className="p-3 bg-amber-100 text-amber-600 rounded-xl group-hover:bg-amber-200 transition-colors">
                    <Zap className="w-6 h-6" />
                </div>
                <div className="text-left">
                    <span className="block font-bold text-slate-900 text-lg">Flashcards</span>
                    <span className="text-slate-500 text-sm">Memorize concepts</span>
                </div>
                </button>
            </Tooltip>

            <Tooltip content="Ask questions to AI" className="w-full">
                <button onClick={() => onChangeView(AppView.CHAT)} className="w-full bg-white hover:bg-emerald-50 border border-slate-100 p-6 rounded-3xl shadow-sm transition-all hover:scale-[1.02] hover:border-emerald-200 flex flex-col items-start gap-4 group">
                <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl group-hover:bg-emerald-200 transition-colors">
                    <BrainCircuit className="w-6 h-6" />
                </div>
                <div className="text-left">
                    <span className="block font-bold text-slate-900 text-lg">AI Tutor</span>
                    <span className="text-slate-500 text-sm">Ask questions</span>
                </div>
                </button>
            </Tooltip>
          </div>
      </div>

      {/* Recent Activity */}
      <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
        <Clock className="w-5 h-5 text-slate-400" />
        Recent Documents
      </h3>
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
        {documents.length > 0 ? (
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5 text-xs font-bold text-slate-400 uppercase tracking-wider">Name</th>
                <th className="px-8 py-5 text-xs font-bold text-slate-400 uppercase tracking-wider">Type</th>
                <th className="px-8 py-5 text-xs font-bold text-slate-400 uppercase tracking-wider">Date Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {documents.slice(0, 5).map(doc => (
                <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="px-8 py-5">
                      <div className="font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">{doc.title}</div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 uppercase tracking-wide">
                      {doc.type}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-slate-500 text-sm font-medium">{new Date(doc.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center">
            <FileText className="w-12 h-12 mb-4 text-slate-200" />
            <p className="font-medium">No documents found.</p>
            <p className="text-sm mt-1">Start by uploading one!</p>
          </div>
        )}
      </div>
    </div>
  );
};
