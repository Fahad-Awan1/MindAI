import React, { useEffect, useState } from 'react';
import { FileSignature, GraduationCap, Info, LayoutDashboard, MessageSquareText } from 'lucide-react';
import { AppView } from '../types';

interface TabBarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  /** While the full menu (the sidebar drawer, opened from the header) is open, no tab is highlighted */
  menuOpen: boolean;
}

const TABS = [
  { view: AppView.DASHBOARD, icon: LayoutDashboard, label: 'Home' },
  { view: AppView.CHAT, icon: MessageSquareText, label: 'Chat' },
  { view: AppView.QUIZ, icon: GraduationCap, label: 'Quiz' },
  { view: AppView.EXAM, icon: FileSignature, label: 'Exam' },
  { view: AppView.ABOUT, icon: Info, label: 'About' },
];

/** Phone-only bottom navigation for the most used screens; every other screen is in the header's menu. */
export const TabBar: React.FC<TabBarProps> = ({ currentView, onChangeView, menuOpen }) => {
  // Hide while typing so the bar doesn't ride up on top of the keyboard
  const [typing, setTyping] = useState(false);
  // Lets the page drop the space it keeps for this bar while the keyboard is up (see .app-main in index.css)
  useEffect(() => {
    document.documentElement.classList.toggle('typing', typing);
    return () => document.documentElement.classList.remove('typing');
  }, [typing]);
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || el.isContentEditable ||
        (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes((el as HTMLInputElement).type)));
    const onIn = (e: FocusEvent) => { if (isField(e.target)) setTyping(true); };
    const onOut = () => window.setTimeout(() => setTyping(isField(document.activeElement)), 0);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => { document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut); };
  }, []);

  return (
    <nav aria-label="Main"
      className={`no-print md:hidden fixed bottom-0 inset-x-0 z-30 h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-white/90 backdrop-blur-xl border-t border-slate-200/70 shadow-[0_-4px_20px_rgba(15,23,42,0.06)] grid grid-cols-5 transition-transform duration-300 ease-out-expo ${typing ? 'translate-y-full' : 'translate-y-0'}`}>
      {TABS.map(tab => {
        const active = !menuOpen && currentView === tab.view;
        return (
          <button key={tab.view} onClick={() => onChangeView(tab.view)} aria-current={active ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${active ? 'text-primary-700' : 'text-slate-400 active:text-slate-600'}`}>
            <span className={`absolute top-0 h-[3px] rounded-b-full bg-primary-600 transition-all duration-300 ${active ? 'w-8 opacity-100' : 'w-0 opacity-0'}`} />
            <span className={`flex items-center justify-center w-11 h-7 rounded-full transition-colors duration-300 ${active ? 'bg-primary-100' : ''}`}>
              <tab.icon className="w-5 h-5" />
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};
