import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { DocumentList } from './components/DocumentList';
import { ChatInterface } from './components/ChatInterface';
import { QuizGenerator } from './components/QuizGenerator';
import { Flashcards } from './components/Flashcards';
import { StudyPlanner } from './components/StudyPlanner';
import { ExamGenerator } from './components/ExamGenerator';
import { Dashboard } from './components/Dashboard';
import { Auth } from './components/Auth';
import { DocumentFile, AppView } from './types';
import { generateSummary } from './services/geminiService';
import { Menu } from 'lucide-react';

const App: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const handleLogin = (loggedInUser: any) => {
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('currentUser');
    setUser(null);
    setDocuments([]); // Clear documents for security/session reset
    setCurrentView(AppView.DASHBOARD);
  };

  const handleUpload = async (file: File) => {
    // Determine file type
    let type: DocumentFile['type'] = 'text';
    if (file.name.endsWith('.md')) type = 'markdown';
    else if (file.name.endsWith('.pdf')) type = 'pdf';
    else if (file.name.endsWith('.docx')) type = 'docx';
    else if (file.name.endsWith('.pptx')) type = 'pptx';

    const isTextFile = type === 'text' || type === 'markdown';

    const reader = new FileReader();
    
    reader.onload = async (e) => {
      const result = e.target?.result as string;
      
      let newDoc: DocumentFile;
      
      if (isTextFile) {
          newDoc = {
            id: Date.now().toString(),
            title: file.name,
            content: result,
            type: type,
            createdAt: Date.now(),
            summary: "Generating summary...",
          };
      } else {
          // Binary file (PDF/DOCX/PPTX)
          // result is data:application/pdf;base64,...
          // We need to strip the metadata prefix to get just the base64 string
          const base64Data = result.split(',')[1];
          
          newDoc = {
            id: Date.now().toString(),
            title: file.name,
            content: "", // No text content for binary
            inlineData: {
                data: base64Data,
                mimeType: file.type
            },
            type: type,
            createdAt: Date.now(),
            summary: "Generating AI analysis...",
          };
      }

      setDocuments(prev => [newDoc, ...prev]);

      // Generate summary in background
      try {
        const summary = await generateSummary(newDoc);
        setDocuments(prev => prev.map(d => d.id === newDoc.id ? { ...d, summary } : d));
      } catch (error) {
        setDocuments(prev => prev.map(d => d.id === newDoc.id ? { ...d, summary: "Summary generation failed. File might be too large or format unsupported." } : d));
      }
    };

    if (isTextFile) {
        reader.readAsText(file);
    } else {
        reader.readAsDataURL(file);
    }
  };

  const handleDelete = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (selectedDocId === id) setSelectedDocId(null);
  };

  const renderContent = () => {
    switch (currentView) {
      case AppView.DASHBOARD:
        return <Dashboard documents={documents} onChangeView={setCurrentView} />;
      case AppView.DOCUMENTS:
        return (
          <DocumentList 
            documents={documents} 
            onUpload={handleUpload} 
            onDelete={handleDelete}
            onSelect={(doc) => {
              setSelectedDocId(doc.id);
              setCurrentView(AppView.CHAT); // Default action when opening doc
            }}
          />
        );
      case AppView.CHAT:
        return <ChatInterface documents={documents} />;
      case AppView.QUIZ:
        return <QuizGenerator documents={documents} />;
      case AppView.FLASHCARDS:
        return <Flashcards documents={documents} />;
      case AppView.PLANNER:
        return <StudyPlanner documents={documents} />;
      case AppView.EXAM:
        return <ExamGenerator documents={documents} />;
      default:
        return <Dashboard documents={documents} onChangeView={setCurrentView} />;
    }
  };

  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900 relative">
      {/* Mobile Header */}
      <div className="no-print md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-30 flex items-center px-4 justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
            <span className="font-display font-bold text-lg text-slate-800">MindAI</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">
            {user.name.charAt(0).toUpperCase()}
          </div>
      </div>

      <Sidebar 
        currentView={currentView} 
        onChangeView={setCurrentView} 
        onLogout={handleLogout} 
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      
      {/* Main Content */}
      <main className={`flex-1 flex flex-col relative overflow-hidden pt-16 md:pt-0 transition-all duration-300`}>
        <div className={`flex-1 w-full relative ${currentView === AppView.CHAT ? 'overflow-hidden' : 'overflow-y-auto no-scrollbar'}`}>
           {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default App;