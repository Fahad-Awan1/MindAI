
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppView } from '../types';
import { User } from '../services/api';
import { initials } from '../auth/AuthContext';
import { Logo, LogoMark } from './Logo';
import { Tooltip } from './Tooltip';
import { RollText } from '../motion';
import {
  LayoutDashboard,
  Files,
  MessageSquareText,
  Zap,
  GraduationCap,
  CalendarClock,
  Network,
  MessageSquareQuote,
  BookOpen,
  Headphones,
  Share2,
  Users,
  X,
  LogOut,
  FileSignature,
  ChevronDown,
  ChevronLeft,
  Download,
  Info,
} from 'lucide-react';
import { promptInstall, watchInstallable } from '../services/platform';

interface SidebarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onOpenProfile: () => void;
  onLogout: () => void;
}

type NavItem = { view: AppView; icon: React.ElementType; label: string; tip: string };

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { view: AppView.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard', tip: 'Overview of your study progress' },
      { view: AppView.DOCUMENTS, icon: Files, label: 'Documents', tip: 'Manage your study materials' },
    ],
  },
  {
    title: 'Learn together',
    items: [
      { view: AppView.CHAT, icon: MessageSquareText, label: 'AI Chat', tip: 'Chat with your documents' },
      { view: AppView.ROOMS, icon: Users, label: 'Study Rooms', tip: 'Study live with classmates' },
    ],
  },
  {
    title: 'Study tools',
    items: [
      { view: AppView.READER, icon: BookOpen, label: 'Reader', tip: 'Read and highlight to learn' },
      { view: AppView.PLANNER, icon: CalendarClock, label: 'Study Planner', tip: 'Create a study schedule' },
      { view: AppView.QUIZ, icon: GraduationCap, label: 'Quiz Generator', tip: 'Test your knowledge' },
      { view: AppView.EXAM, icon: FileSignature, label: 'Exam Paper', tip: 'Generate and print formal exams' },
      { view: AppView.FLASHCARDS, icon: Zap, label: 'Flashcards', tip: 'Memorize key terms' },
      { view: AppView.TEACH, icon: MessageSquareQuote, label: 'Teach It Back', tip: 'Explain a concept, get graded' },
    ],
  },
  {
    title: 'See & hear',
    items: [
      { view: AppView.MINDMAP, icon: Network, label: 'Mind Map', tip: 'Visualize key concepts' },
      { view: AppView.AUDIO, icon: Headphones, label: 'Audio Overview', tip: 'Turn a document into a podcast' },
      { view: AppView.GRAPH, icon: Share2, label: 'Concept Graph', tip: 'See how ideas connect across documents' },
    ],
  },
  {
    title: 'MindAI',
    items: [
      { view: AppView.ABOUT, icon: Info, label: 'About', tip: 'What MindAI is and who built it' },
    ],
  },
];

/** Display name of each screen (used by the page-transition curtain). */
export const VIEW_LABELS: Partial<Record<AppView, string>> = Object.fromEntries(
  NAV_SECTIONS.flatMap(section => section.items.map(item => [item.view, item.label])),
);

const RAIL_KEY = 'mindai.sidebarRail';
const SECTIONS_KEY = 'mindai.sidebarClosedSections';

const readJSON = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeJSON = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the preference just isn't remembered
  }
};

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, isOpen, onClose, user, onOpenProfile, onLogout }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<AppView, HTMLButtonElement>());
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  // Desktop: slim icon rail instead of the full sidebar (the mobile drawer is always full width)
  const [rail, setRail] = useState<boolean>(() => readJSON(RAIL_KEY, false));
  // Folded nav sections, by title
  const [closed, setClosed] = useState<string[]>(() => readJSON(SECTIONS_KEY, []));

  // Phone drawer: while it is slid away it must not be reachable by screen readers or the keyboard
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const hiddenDrawer = !isOpen && !desktop;

  const toggleRail = () => setRail(r => { writeJSON(RAIL_KEY, !r); return !r; });
  const toggleSection = (title: string) => setClosed(prev => {
    const next = prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title];
    writeJSON(SECTIONS_KEY, next);
    return next;
  });

  // Never hide the screen you're on: open its section
  useEffect(() => {
    const section = NAV_SECTIONS.find(s => s.items.some(i => i.view === currentView));
    if (section && closed.includes(section.title)) toggleSection(section.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  // Slide the highlight pill to the active item (re-measured as sections fold and the rail resizes)
  useLayoutEffect(() => {
    const measure = () => {
      const list = listRef.current;
      const button = buttonRefs.current.get(currentView);
      if (!list || !button || button.offsetParent === null) {
        setPill(null);
        return;
      }
      const listRect = list.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      setPill(rect.height > 0 ? { top: rect.top - listRect.top, height: rect.height } : null);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer && listRef.current) observer.observe(listRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [currentView, rail]);

  const handleNavClick = (view: AppView) => {
    onChangeView(view);
    onClose(); // Close sidebar on mobile after selection
  };

  // Hidden only on desktop while the rail is active (the mobile drawer always shows labels)
  const railHide = rail ? 'md:hidden' : '';
  const [installable, setInstallable] = useState(false);
  useEffect(() => watchInstallable(setInstallable), []);
  let itemIndex = 0;

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={`fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity duration-500 md:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      ></div>

      {/* Sidebar */}
      <div inert={hiddenDrawer} aria-hidden={hiddenDrawer || undefined} className={`no-print group/sidebar fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] md:max-w-none pb-[env(safe-area-inset-bottom)] bg-[#0b0a1a] text-white flex-shrink-0 shadow-2xl transition-[transform,width] duration-700 ease-out-expo md:relative md:z-30 md:translate-x-0 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} ${rail ? 'md:w-[5.5rem]' : ''}`}>
        {/* Desktop: collapse / expand handle on the top-right edge (outside the clipped content) */}
        <button
          onClick={toggleRail}
          className="hidden md:flex absolute top-9 -right-3.5 z-40 w-7 h-7 rounded-full items-center justify-center bg-white text-slate-500 border border-slate-200 shadow-lg shadow-slate-900/20 hover:bg-violet-600 hover:text-white hover:border-violet-600 hover:scale-110 transition-all duration-300 ease-out-expo"
          aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!rail}
          title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft className={`w-4 h-4 stroke-[2.5px] transition-transform duration-500 ease-out-expo ${rail ? 'rotate-180' : ''}`} />
        </button>

        <div className="relative h-full w-full flex flex-col overflow-hidden">

        {/* Ambient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#120f2b] via-[#0b0a1a] to-[#07060f] z-0"></div>
        <div className="mesh-blob w-72 h-72 -top-24 -right-28 bg-violet-600/30 z-0"></div>
        <div className="mesh-blob w-60 h-60 bottom-10 -left-32 bg-indigo-600/20 z-0" style={{ animationDelay: '-9s' }}></div>
        <div className="absolute inset-0 grain z-0 opacity-70"></div>

        {/* Logo Section */}
        <div className={`relative z-10 pt-7 pb-5 flex items-center justify-between gap-2 animate-fade-in ${rail ? 'px-7 md:px-0 md:justify-center' : 'px-7'}`}>
          <button onClick={() => handleNavClick(AppView.DASHBOARD)} className="relative group text-left" aria-label="MindAI home" data-cursor="Home">
            <div className="absolute -inset-2 bg-gradient-to-r from-primary-600 to-indigo-600 rounded-2xl blur-xl opacity-20 group-hover:opacity-50 transition duration-500"></div>
            <Logo size={42} tone="light" tagline="Student Assistant" className={`relative transition-transform duration-500 ease-out-expo group-hover:scale-[1.03] ${railHide}`} />
            {rail && <LogoMark size={42} className="relative hidden md:block transition-transform duration-500 ease-out-expo group-hover:scale-105" />}
          </button>

          {/* Mobile Close Button */}
          <button
            onClick={onClose}
            className="md:hidden p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
            aria-label="Close menu"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation */}
        <nav className={`relative z-10 flex-1 pb-4 overflow-y-auto no-scrollbar ${rail ? 'px-4 md:px-3' : 'px-4'}`} data-lenis-prevent>
          <div ref={listRef} className="relative">
            {/* Sliding active highlight */}
            {pill && (
              <div className="nav-pill" style={{ transform: `translate3d(0, ${pill.top}px, 0)`, height: pill.height }} aria-hidden="true" />
            )}

            {NAV_SECTIONS.map((section, sectionIndex) => {
              const isClosed = closed.includes(section.title);
              const hasActive = section.items.some(i => i.view === currentView);
              return (
                <div key={section.title} className={rail ? 'mb-4 md:mb-2' : 'mb-3'}>
                  {/* Section heading: folds the group (full sidebar) / a thin divider (rail) */}
                  <button
                    type="button"
                    onClick={() => toggleSection(section.title)}
                    aria-expanded={!isClosed}
                    className={`group/sec w-full flex items-center justify-between px-4 pt-2 pb-2 rounded-lg text-left hover:bg-white/[0.03] transition-colors animate-fade-in ${railHide}`}
                  >
                    <span className={`text-[10.5px] font-semibold uppercase tracking-[0.18em] transition-colors ${isClosed && hasActive ? 'text-violet-300' : 'text-slate-500 group-hover/sec:text-slate-300'}`}>
                      {section.title}
                    </span>
                    <span className="flex items-center gap-2">
                      {isClosed && <span className="text-[10px] font-semibold text-slate-600">{section.items.length}</span>}
                      <ChevronDown className={`w-3.5 h-3.5 text-slate-500 group-hover/sec:text-slate-300 transition-transform duration-500 ease-out-expo ${isClosed ? '-rotate-90' : ''}`} />
                    </span>
                  </button>
                  {rail && sectionIndex > 0 && <div className="hidden md:block mx-3 mb-2 h-px bg-white/[0.06]" />}

                  {/* Items: animated fold using grid rows (always open in the rail) */}
                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out-expo ${isClosed ? `grid-rows-[0fr] opacity-0 ${rail ? 'md:grid-rows-[1fr] md:opacity-100' : ''}` : 'grid-rows-[1fr] opacity-100'}`}
                  >
                    <div className="overflow-hidden min-h-0">
                      <div className="space-y-1">
                        {section.items.map(item => {
                          const active = currentView === item.view;
                          const index = itemIndex++;
                          return (
                            <Tooltip key={item.view} content={rail ? item.label : item.tip} position="right" className="w-full" delay={rail ? 120 : 700}>
                              <button
                                ref={el => {
                                  if (el) buttonRefs.current.set(item.view, el);
                                  else buttonRefs.current.delete(item.view);
                                }}
                                onClick={() => handleNavClick(item.view)}
                                aria-current={active ? 'page' : undefined}
                                aria-label={item.label}
                                tabIndex={isClosed && !rail ? -1 : undefined}
                                className={`roll-host w-full flex items-center gap-3 py-3 rounded-xl transition-colors duration-300 group relative animate-slide-in-right
                                  ${rail ? 'px-4 md:px-0 md:justify-center' : 'px-4'}
                                  ${active ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'}`}
                                style={{ animationDelay: `${120 + index * 35}ms`, animationFillMode: 'both' }}
                              >
                                <span className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-500 ease-out-expo flex-shrink-0
                                  ${active ? 'bg-white/15' : 'bg-white/[0.03] group-hover:bg-white/[0.08] group-hover:rotate-[-8deg] group-hover:scale-110'}`}>
                                  <item.icon className="w-[18px] h-[18px]" />
                                </span>
                                <span className={`relative z-10 font-medium tracking-wide text-[14.5px] whitespace-nowrap ${railHide}`}>
                                  <RollText text={item.label} />
                                </span>
                                <span className={`absolute right-4 z-10 w-1.5 h-1.5 rounded-full bg-amber-300 transition-all duration-500 ${railHide} ${active ? 'opacity-100 scale-100 shadow-[0_0_10px_rgba(251,191,36,0.9)]' : 'opacity-0 scale-0'}`}></span>
                              </button>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Bottom Section */}
        <div className={`relative z-10 mt-auto border-t border-white/[0.06] ${rail ? 'p-4 md:p-3' : 'p-4'}`}>
          {installable && (
            <Tooltip content="Install MindAI as an app" position={rail ? 'right' : 'top'}>
              <button onClick={() => promptInstall()}
                className={`mb-3 w-full flex items-center gap-2.5 rounded-xl border border-primary-400/30 bg-primary-500/15 text-primary-100 hover:bg-primary-500/25 transition-colors text-sm font-semibold ${rail ? 'px-3 py-2.5 md:justify-center md:px-0' : 'px-3 py-2.5'}`}>
                <Download className="w-4 h-4 flex-shrink-0" />
                <span className={railHide}>Install app</span>
              </button>
            </Tooltip>
          )}
          {/* Signed-in user */}
          {user && (
            <div className={`flex items-center gap-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-colors duration-300 animate-slide-up ${rail ? 'p-3 md:p-2 md:flex-col md:gap-2' : 'p-3'}`}>
              <button onClick={() => { onOpenProfile(); onClose(); }} className={`flex items-center gap-3 min-w-0 flex-1 text-left group ${rail ? 'md:flex-none' : ''}`} aria-label="Your profile" data-cursor="Profile" title={rail ? user.name : undefined}>
                <span className="relative w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-sm ring-2 ring-white/10 transition-transform duration-500 ease-out-expo group-hover:scale-110" style={{ background: user.avatar_color }}>
                  {initials(user.name)}
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[#0b0a1a]"></span>
                </span>
                <span className={`min-w-0 ${railHide}`}>
                  <span className="block text-sm font-semibold text-white truncate group-hover:text-primary-200 transition-colors">{user.name}</span>
                  <span className="block text-xs text-slate-400 truncate">{user.email}</span>
                </span>
              </button>
              <Tooltip content="Log out" position={rail ? 'right' : 'top'}>
                <button onClick={onLogout} className="p-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-rose-500/20 transition-colors" aria-label="Log out">
                  <LogOut className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
        </div>
      </div>
    </>
  );
};
