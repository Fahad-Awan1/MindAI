import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { Sidebar, VIEW_LABELS } from './components/Sidebar';
import { DocumentList } from './components/DocumentList';
import { ChatInterface } from './components/ChatInterface';
import { QuizGenerator } from './components/QuizGenerator';
import { Flashcards } from './components/Flashcards';
import { StudyPlanner } from './components/StudyPlanner';
import { ExamGenerator } from './components/ExamGenerator';
import { Dashboard } from './components/Dashboard';
import { DocumentFile, AppView, StudySetSummary, STUDY_SET_VIEW, ReaderFocus, Source, ConceptRequest } from './types';
import { documentsAPI, getErrorMessage } from './services/api';
import { Menu, Loader2, X, Sparkles } from 'lucide-react';
import { useAuth, initials } from './auth/AuthContext';
import { AuthPage } from './components/AuthPage';
import { ProfileDialog } from './components/ProfileDialog';
import { TabBar } from './components/TabBar';
import { Logo, LogoMark } from './components/Logo';
import { SplashScreen, shouldShowSplash } from './components/SplashScreen';
import { useLenis } from './motion/useLenis';
import { useGlobalSpotlight, prefersReducedMotion } from './motion';
import { onBackButton } from './services/platform';
import { handleBack } from './hooks/useBackHandler';

// Mind maps pull in the large Mermaid library, so load that screen on demand
const MindMapGenerator = lazy(() =>
  import('./components/MindMapGenerator').then(m => ({ default: m.MindMapGenerator }))
);

// Less frequently used screens load on demand to keep the first page light
const TeachBack = lazy(() => import('./components/TeachBack').then(m => ({ default: m.TeachBack })));
const Reader = lazy(() => import('./components/Reader').then(m => ({ default: m.Reader })));
const AudioOverview = lazy(() => import('./components/AudioOverview').then(m => ({ default: m.AudioOverview })));
const Rooms = lazy(() => import('./components/Rooms').then(m => ({ default: m.Rooms })));
const About = lazy(() => import('./components/About').then(m => ({ default: m.About })));

// The concept graph pulls in cytoscape, so load that screen on demand too
const ConceptGraph = lazy(() =>
  import('./components/ConceptGraph').then(m => ({ default: m.ConceptGraph }))
);

const INVITE_KEY = 'mindai.pendingInvite';
// Placeholder the backend writes while a new document's AI summary is still being generated
const PENDING_SUMMARY = 'Generating summary...';

/**
 * Invite links look like /join/<code>. Remember the code (it must survive signing up or in)
 * and clean the address bar.
 */
const captureInviteFromUrl = () => {
  const match = window.location.pathname.match(/^\/join\/([a-z0-9]+)\/?$/i);
  if (!match) return;
  try {
    window.sessionStorage.setItem(INVITE_KEY, match[1].toLowerCase());
  } catch {
    // Storage unavailable: the invite is simply not remembered
  }
  window.history.replaceState(null, '', '/');
};
captureInviteFromUrl();

const takePendingInvite = (): string | null => {
  try {
    const code = window.sessionStorage.getItem(INVITE_KEY);
    window.sessionStorage.removeItem(INVITE_KEY);
    return code;
  } catch {
    return null;
  }
};

/** The signed-in app (remounted per account so no state leaks between users). */
const Workspace: React.FC = () => {
  const { user, logout, claimedDocuments, dismissClaimNotice } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  // An invite link opens Study Rooms straight away
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => takePendingInvite());
  const [currentView, setCurrentView] = useState<AppView>(() => (pendingInvite ? AppView.ROOMS : AppView.DASHBOARD));
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A failed upload/delete, shown as a dismissable banner (instead of a browser alert)
  const [actionError, setActionError] = useState<string | null>(null);
  // A saved study set to open when its screen mounts (e.g. clicked on the dashboard)
  const [pendingSetId, setPendingSetId] = useState<string | null>(null);
  // Open the flashcard screen straight into today's spaced-repetition review
  const [reviewRequested, setReviewRequested] = useState(false);
  // Passage to show in the reader (e.g. a cited source)
  const [readerFocus, setReaderFocus] = useState<ReaderFocus | null>(null);
  // Concept handed from the concept graph to chat or teach-back
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const [teachRequest, setTeachRequest] = useState<ConceptRequest | null>(null);
  // The screen actually rendered lags the selected one briefly so a curtain can sweep across first
  const [displayedView, setDisplayedView] = useState<AppView>(currentView);
  const [curtain, setCurtain] = useState<{ key: number; label: string } | null>(null);
  const curtainKey = useRef(0);

  useEffect(() => {
    loadDocuments();
  }, []);

  // Android back button: close the menu or a dialog first, then step back through the screens visited
  const viewHistory = useRef<AppView[]>([]);
  const lastView = useRef(currentView);
  const goingBack = useRef(false);
  useEffect(() => {
    if (lastView.current !== currentView && !goingBack.current) viewHistory.current = [...viewHistory.current, lastView.current].slice(-20);
    goingBack.current = false;
    lastView.current = currentView;
  }, [currentView]);
  const backState = useRef({ isSidebarOpen });
  backState.current = { isSidebarOpen };
  useEffect(() => onBackButton(() => {
    if (backState.current.isSidebarOpen) { setIsSidebarOpen(false); return true; }
    // Open dialogs/sheets and screens that confirm before leaving (exam, quiz, room) register themselves
    if (handleBack()) return true;
    const previous = viewHistory.current.pop();
    if (previous === undefined) return false;
    goingBack.current = true;
    setCurrentView(previous);
    return true;
  }), []);

  useEffect(() => {
    if (currentView === displayedView) return;
    if (prefersReducedMotion()) {
      setDisplayedView(currentView);
      return;
    }
    curtainKey.current += 1;
    setCurtain({ key: curtainKey.current, label: VIEW_LABELS[currentView] ?? '' });
    const swap = window.setTimeout(() => setDisplayedView(currentView), 400);
    return () => window.clearTimeout(swap);
  }, [currentView, displayedView]);

  useEffect(() => {
    if (!curtain) return;
    const done = window.setTimeout(() => setCurtain(null), 950);
    return () => window.clearTimeout(done);
  }, [curtain]);

  const selfScrolling = displayedView === AppView.CHAT || displayedView === AppView.ROOMS;
  const scrollRef = useLenis<HTMLDivElement>(!selfScrolling, displayedView);

  const loadDocuments = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const docs = await documentsAPI.getAll();
      setDocuments(docs);
    } catch (error) {
      console.error('Error loading documents:', error);
      setLoadError(getErrorMessage(error, 'Failed to load documents.'));
    } finally {
      setIsLoading(false);
    }
  };

  // A new document's AI summary is written in the background: check back until it's there
  const watchSummary = useCallback((docId: string) => {
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const docs = await documentsAPI.getAll();
        const doc = docs.find(d => d.id === docId);
        if (doc && doc.summary !== PENDING_SUMMARY) {
          setDocuments(prev => prev.map(d => (d.id === docId ? { ...d, summary: doc.summary } : d)));
          return;
        }
      } catch {
        // Try again on the next tick
      }
      if (tries < 40) window.setTimeout(tick, 4000);
    };
    window.setTimeout(tick, 3000);
  }, []);

  const handleUpload = async (file: File) => {
    try {
      const newDoc = await documentsAPI.upload(file);
      setDocuments(prev => [newDoc, ...prev]);
      if (newDoc.summary === PENDING_SUMMARY) watchSummary(newDoc.id);
    } catch (error) {
      console.error('Error uploading document:', error);
      setActionError(`Couldn't upload "${file.name}": ${getErrorMessage(error, 'Please try again.')}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await documentsAPI.delete(id);
      setDocuments(prev => prev.filter(d => d.id !== id));
      if (selectedDocId === id) setSelectedDocId(null);
    } catch (error) {
      console.error('Error deleting document:', error);
      setActionError(`Couldn't delete the document: ${getErrorMessage(error, 'Please try again.')}`);
    }
  };

  const openStudySet = (set: StudySetSummary) => {
    setPendingSetId(set.id);
    setCurrentView(STUDY_SET_VIEW[set.kind]);
  };

  const openInReader = (source: Source) => {
    setReaderFocus({ documentId: source.document_id, text: source.text, label: source.location });
    setCurrentView(AppView.READER);
  };

  const askTutorAbout = ({ documentId, concept }: ConceptRequest) => {
    setSelectedDocId(documentId);
    setChatPrompt(`Explain "${concept}" and how it connects to the other ideas in this document.`);
    setCurrentView(AppView.CHAT);
  };

  const teachBackConcept = (request: ConceptRequest) => {
    setTeachRequest(request);
    setCurrentView(AppView.TEACH);
  };

  const startReview = () => {
    setReviewRequested(true);
    setCurrentView(AppView.FLASHCARDS);
  };

  // Props shared by every study tool screen for opening a saved set
  const setProps = {
    initialSetId: pendingSetId,
    onInitialSetConsumed: () => setPendingSetId(null),
  };

  const renderContent = () => {
    switch (displayedView) {
      case AppView.DASHBOARD:
        return <Dashboard documents={documents} onChangeView={setCurrentView} onOpenSet={openStudySet} onStartReview={startReview} />;
      case AppView.DOCUMENTS:
        return (
          <DocumentList
            documents={documents}
            onUpload={handleUpload}
            onDelete={handleDelete}
            onSelect={(doc) => {
              setSelectedDocId(doc.id);
              setCurrentView(AppView.CHAT);
            }}
            onImported={() => loadDocuments()}
            onOpenDocument={async (id) => {
              await loadDocuments();
              setSelectedDocId(id);
              setCurrentView(AppView.CHAT);
            }}
          />
        );
      case AppView.CHAT:
        return (
          <ChatInterface
            documents={documents}
            initialDocId={selectedDocId}
            onSelectDoc={setSelectedDocId}
            onOpenInReader={openInReader}
            initialInput={chatPrompt}
            onInitialInputConsumed={() => setChatPrompt(null)}
          />
        );
      case AppView.QUIZ:
        return <QuizGenerator documents={documents} {...setProps} onOpenInReader={openInReader} />;
      case AppView.FLASHCARDS:
        return (
          <Flashcards
            documents={documents}
            {...setProps}
            startReview={reviewRequested}
            onStartReviewConsumed={() => setReviewRequested(false)}
          />
        );
      case AppView.PLANNER:
        return <StudyPlanner documents={documents} {...setProps} />;
      case AppView.EXAM:
        return <ExamGenerator documents={documents} {...setProps} />;
      case AppView.READER:
        return <Reader documents={documents} focus={readerFocus} onFocusConsumed={() => setReaderFocus(null)} onOpenSet={openStudySet} />;
      case AppView.TEACH:
        return <TeachBack documents={documents} {...setProps} initialConcept={teachRequest} onInitialConceptConsumed={() => setTeachRequest(null)} />;
      case AppView.ROOMS:
        return <Rooms myDocuments={documents} onOpenInReader={openInReader} inviteCode={pendingInvite} onInviteHandled={() => setPendingInvite(null)} />;
      case AppView.ABOUT:
        return <About />;
      case AppView.AUDIO:
        return <AudioOverview documents={documents} {...setProps} />;
      case AppView.GRAPH:
        return (
          <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-10 h-10 text-indigo-500 animate-spin" /></div>}>
            <ConceptGraph documentCount={documents.length} onAskTutor={askTutorAbout} onTeachBack={teachBackConcept} />
          </Suspense>
        );
      case AppView.MINDMAP:
        return (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-10 h-10 text-pink-500 animate-spin" />
            </div>
          }>
            <MindMapGenerator documents={documents} {...setProps} />
          </Suspense>
        );
      default:
        return <Dashboard documents={documents} onChangeView={setCurrentView} onOpenSet={openStudySet} onStartReview={startReview} />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-slate-50">
        <div className="flex flex-col items-center gap-5 animate-fade-in">
          <LogoMark size={56} className="animate-float" />
          <div className="w-40 h-1 rounded-full shimmer" />
          <p className="text-sm text-slate-500 font-medium">Opening your library…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex h-[100dvh] bg-slate-50 overflow-hidden font-sans text-slate-900 relative">
      {/* Mobile Header */}
      <div className="no-print md:hidden fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-xl border-b border-slate-200/70 z-30 flex items-center px-4 justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2.5 -ml-2.5 text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>
            <Logo size={30} />
          </div>
          <button
            onClick={() => setShowProfile(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs"
            style={{ background: user?.avatar_color }}
            aria-label="Your profile"
          >
            {initials(user?.name ?? '')}
          </button>
      </div>

      <Sidebar
        currentView={currentView}
        onChangeView={setCurrentView}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        user={user}
        onOpenProfile={() => setShowProfile(true)}
        onLogout={logout}
      />

      {/* Main Content */}
      <main className={`app-main flex-1 flex flex-col relative overflow-hidden pt-16 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0 transition-all duration-300`}>
        {/* Soft ambient backdrop behind every screen */}
        <div className="no-print pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 dot-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
          <div className="mesh-blob w-[38rem] h-[38rem] -top-56 -right-40 bg-violet-200/60" />
          <div className="mesh-blob w-[30rem] h-[30rem] top-1/2 -left-48 bg-indigo-100/70" style={{ animationDelay: '-7s' }} />
        </div>
        {claimedDocuments > 0 && (
          <div className="no-print relative z-10 m-4 mb-0 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between gap-4 animate-slide-up">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 flex-shrink-0" />
              Welcome! Your existing study data ({claimedDocuments} document{claimedDocuments === 1 ? '' : 's'}, chats and progress) is now in your account.
            </span>
            <button onClick={dismissClaimNotice} className="p-1 rounded-lg hover:bg-emerald-100" aria-label="Dismiss"><X className="w-4 h-4" /></button>
          </div>
        )}
        {actionError && (
          <div className="no-print relative z-10 m-4 mb-0 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between gap-4 animate-slide-up" role="alert">
            <span className="min-w-0 [overflow-wrap:anywhere]">{actionError}</span>
            <button onClick={() => setActionError(null)} className="p-2 -m-1 rounded-lg hover:bg-red-100 flex-shrink-0" aria-label="Dismiss"><X className="w-4 h-4" /></button>
          </div>
        )}
        {loadError && (
          <div className="no-print relative z-10 m-4 mb-0 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between gap-4 animate-slide-up">
            <span>{loadError}</span>
            <button onClick={loadDocuments} className="font-bold underline whitespace-nowrap">Retry</button>
          </div>
        )}
        <div
          ref={scrollRef}
          key={selfScrolling ? 'fixed' : 'scroll'}
          className={`flex-1 w-full relative ${selfScrolling ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden no-scrollbar'}`}
        >
          {/* Stable content element (Lenis measures it); the keyed child replays the entrance per screen */}
          <div className={selfScrolling ? 'h-full' : 'min-h-full flex flex-col'}>
            <div key={displayedView} className={`view-enter ${selfScrolling ? 'h-full' : 'view-fill'}`}>
              <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[50vh]"><Loader2 className="w-10 h-10 text-indigo-500 animate-spin" /></div>}>
                {renderContent()}
              </Suspense>
            </div>
          </div>
        </div>

        {curtain && (
          <div key={curtain.key} className="curtain no-print" aria-hidden="true">
            <div className="curtain__panel" />
            <div className="curtain__line" />
            <div className="curtain__label">{curtain.label}</div>
          </div>
        )}
      </main>

      <TabBar currentView={currentView} onChangeView={setCurrentView} menuOpen={isSidebarOpen} />

      {showProfile && <ProfileDialog onClose={() => setShowProfile(false)} />}
    </div>
  );
};

/** Shows the sign-in screen until the user is authenticated. */
const App: React.FC = () => {
  const [showSplash, setShowSplash] = useState(shouldShowSplash);
  const hideSplash = useCallback(() => setShowSplash(false), []);
  const { isRestoring } = useAuth();
  useGlobalSpotlight();

  return (
    <>
      <AppGate />
      {showSplash && <SplashScreen ready={!isRestoring} onDone={hideSplash} />}
    </>
  );
};

const AppGate: React.FC = () => {
  const { user, isRestoring } = useAuth();

  if (isRestoring) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-slate-50">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <LogoMark size={64} className="animate-pulse-slow" />
          <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return <Workspace key={user.id} />;
};

export default App;
