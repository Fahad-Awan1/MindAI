
import React from 'react';
import { AppView } from '../types';
import { Tooltip } from './Tooltip';
import { 
  LayoutDashboard, 
  Files, 
  MessageSquareText, 
  Zap, 
  GraduationCap,
  Sparkles,
  CalendarClock,
  LogOut,
  X,
  FileSignature
} from 'lucide-react';

interface SidebarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, onLogout, isOpen, onClose }) => {
  const navItems = [
    { view: AppView.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard', tip: 'Overview of your study progress' },
    { view: AppView.DOCUMENTS, icon: Files, label: 'Documents', tip: 'Manage your study materials' },
    { view: AppView.CHAT, icon: MessageSquareText, label: 'AI Chat', tip: 'Chat with your documents' },
    { view: AppView.PLANNER, icon: CalendarClock, label: 'Study Planner', tip: 'Create a study schedule' },
    { view: AppView.QUIZ, icon: GraduationCap, label: 'Quiz Generator', tip: 'Test your knowledge' },
    { view: AppView.EXAM, icon: FileSignature, label: 'Exam Paper', tip: 'Generate and print formal exams' },
    { view: AppView.FLASHCARDS, icon: Zap, label: 'Flashcards', tip: 'Memorize key terms' },
  ];

  const handleNavClick = (view: AppView) => {
    onChangeView(view);
    onClose(); // Close sidebar on mobile after selection
  };

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity duration-300 md:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      ></div>

      {/* Sidebar */}
      <div className={`no-print fixed inset-y-0 left-0 z-50 w-72 h-screen bg-slate-900 text-white flex flex-col flex-shrink-0 shadow-2xl overflow-hidden transition-transform duration-300 ease-out md:static md:translate-x-0 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        
        {/* Ambient Background Gradient */}
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 z-0"></div>
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary-600/20 rounded-full blur-3xl z-0"></div>
        <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-slate-950 to-transparent z-0"></div>

        {/* Logo Section */}
        <div className="relative z-10 p-8 pb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative group cursor-pointer">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary-600 to-indigo-600 rounded-lg blur opacity-40 group-hover:opacity-75 transition duration-200"></div>
                <div className="relative w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center border border-slate-700">
                    <MessageSquareText className="w-6 h-6 text-primary-400" />
                </div>
            </div>
            <div>
                <h1 className="text-2xl font-display font-bold tracking-tight text-white">MindAI</h1>
                <p className="text-xs text-slate-400 font-medium">Student Assistant</p>
            </div>
          </div>
          
          {/* Mobile Close Button */}
          <button 
            onClick={onClose}
            className="md:hidden p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        {/* Navigation */}
        <nav className="relative z-10 flex-1 px-4 space-y-1.5 py-4 overflow-y-auto no-scrollbar">
          <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Menu</p>
          {navItems.map((item) => (
            <Tooltip key={item.view} content={item.tip} position="right" className="w-full">
              <button
                onClick={() => handleNavClick(item.view)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 group relative overflow-hidden
                  ${currentView === item.view 
                    ? 'text-white shadow-lg shadow-primary-900/20' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
              >
                {currentView === item.view && (
                    <div className="absolute inset-0 bg-gradient-to-r from-primary-600 to-indigo-600 opacity-100 z-0"></div>
                )}
                
                <item.icon className={`relative z-10 w-5 h-5 transition-transform duration-300 ${currentView === item.view ? 'scale-110' : 'group-hover:scale-110'}`} />
                <span className="relative z-10 font-medium tracking-wide">{item.label}</span>
                
                {currentView === item.view && (
                    <div className="absolute right-4 w-2 h-2 bg-white rounded-full animate-pulse"></div>
                )}
              </button>
            </Tooltip>
          ))}
        </nav>

        {/* Bottom Section */}
        <div className="relative z-10 p-4 mt-auto">
           {/* Pro Tip Card */}
          <div className="mb-4 hidden md:block">
              <Tooltip content="Try this feature for better results!" position="top" className="w-full">
                  <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-2xl p-5 relative overflow-hidden group cursor-help">
                  <div className="absolute -right-4 -top-4 w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full blur-2xl opacity-10 group-hover:opacity-20 transition-opacity duration-500"></div>
                  
                  <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <p className="text-xs font-bold text-white uppercase tracking-wider">Pro Tip</p>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">
                      Use <span className="text-white font-semibold">Flashcards</span> to quickly memorize key terms!
                  </p>
                  </div>
              </Tooltip>
          </div>
          
          {/* Logout */}
          <Tooltip content="Sign out of your account" position="right" className="w-full">
              <button 
                  onClick={onLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all duration-300 group"
              >
                  <LogOut className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
                  <span className="font-medium">Sign Out</span>
              </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
};