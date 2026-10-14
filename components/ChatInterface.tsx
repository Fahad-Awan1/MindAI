
import React, { useState, useEffect, useRef } from 'react';
import { DocumentFile, ChatMessage } from '../types';
import { Tooltip } from './Tooltip';
import { Bot, User, Sparkles, Layers, ArrowUp, Info, ArrowDown } from 'lucide-react';
import { chatWithDocument, chatWithKnowledgeBase } from '../services/geminiService';

interface ChatInterfaceProps {
  documents: DocumentFile[];
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ documents }) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const selectedDoc = documents.find(d => d.id === selectedDocId);
  const isAllDocs = selectedDocId === 'ALL';

  useEffect(() => {
    setMessages([]); 
    if (isAllDocs && documents.length > 0) {
       setMessages([{
        id: 'intro',
        role: 'model',
        text: `Hello! I'm connected to your Knowledge Base. I have access to ${documents.length} documents. What are we studying today?`,
        timestamp: Date.now()
      }]);
    } else if (selectedDoc) {
      setMessages([{
        id: 'intro',
        role: 'model',
        text: `Ready to discuss "${selectedDoc.title}". Ask me for a summary, key points, or specific details!`,
        timestamp: Date.now()
      }]);
    }
  }, [selectedDocId, documents, isAllDocs]); 

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleScroll = () => {
    if (scrollContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        const isBottom = scrollHeight - scrollTop - clientHeight < 100;
        setShowScrollButton(!isBottom);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (!isAllDocs && !selectedDoc) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages
        .filter(m => m.id !== 'intro')
        .map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.text }]
        }));

      let responseText = "";
      if (isAllDocs) {
        responseText = await chatWithKnowledgeBase(history, documents, userMsg.text);
      } else if (selectedDoc) {
        responseText = await chatWithDocument(history, selectedDoc, userMsg.text);
      }
      
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: Date.now()
      };
      
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "I encountered a glitch. Could you try asking that again?",
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.05] bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:20px_20px]"></div>
        <div className="relative z-10 bg-white p-10 rounded-[2.5rem] shadow-2xl border border-slate-100 text-center max-w-md mx-4 animate-scale-in">
            <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6 mx-auto animate-float">
                <Sparkles className="w-10 h-10 text-indigo-500" />
            </div>
            <h3 className="text-2xl font-display font-bold text-slate-900 mb-3">It's quiet here...</h3>
            <p className="text-slate-500 leading-relaxed">Upload documents to the Knowledge Base to start chatting with your personal AI tutor.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative bg-slate-50 font-sans overflow-hidden">
      {/* Modern Background Pattern */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
      
      {/* Ambient Orbs */}
      <div className={`absolute top-0 left-0 w-full h-64 bg-gradient-to-b opacity-40 pointer-events-none transition-colors duration-700
        ${isAllDocs ? 'from-fuchsia-200/50 to-transparent' : 'from-indigo-200/50 to-transparent'}`}></div>

      {/* Header - Flex Item, relative to stack properly */}
      <div className="z-20 px-4 md:px-6 py-4 bg-white/80 backdrop-blur-xl border-b border-slate-200/50 flex items-center justify-between shadow-sm flex-shrink-0">
        <div className="flex items-center gap-4 overflow-hidden">
            <Tooltip content={isAllDocs ? "Connected to all documents" : "Connected to single document"} position="bottom">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg transition-all duration-500 flex-shrink-0
                    ${isAllDocs ? 'bg-gradient-to-br from-fuchsia-600 to-purple-700 rotate-3' : 'bg-gradient-to-br from-blue-600 to-indigo-700'}`}>
                    {isAllDocs ? <Layers className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                </div>
            </Tooltip>
            <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-800 leading-tight truncate">
                    {isAllDocs ? "Knowledge Base" : selectedDoc?.title || "Document Chat"}
                </h2>
                <div className="flex items-center gap-2">
                  <span className={`flex w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{isLoading ? "AI Thinking..." : "Active"}</p>
                </div>
            </div>
        </div>
        
        {/* Context Selector */}
        <Tooltip content="Switch document context" position="left">
            <div className="flex items-center relative ml-2">
                <div className="absolute inset-y-0 left-2 md:left-3 flex items-center pointer-events-none">
                    <Info className="h-4 w-4 text-slate-400" />
                </div>
                <select 
                    value={selectedDocId} 
                    onChange={(e) => setSelectedDocId(e.target.value)}
                    className="w-32 md:w-auto pl-8 md:pl-10 pr-4 md:pr-8 py-2 bg-slate-100/50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all hover:bg-white cursor-pointer appearance-none truncate"
                >
                    <option value="ALL">All Docs</option>
                    {documents.map(doc => (
                    <option key={doc.id} value={doc.id}>{doc.title}</option>
                    ))}
                </select>
            </div>
        </Tooltip>
      </div>

      {/* Messages Area - Flex grow with scroll */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 space-y-6 scroll-smooth"
      >
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex gap-3 md:gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-slide-up`}
          >
            {/* Avatar */}
            <Tooltip content={msg.role === 'user' ? "You" : "AI Assistant"} position={msg.role === 'user' ? "left" : "right"}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm border-2 border-white overflow-hidden
                ${msg.role === 'user' 
                    ? 'bg-slate-800 text-white' 
                    : isAllDocs ? 'bg-fuchsia-100 text-fuchsia-600' : 'bg-indigo-100 text-indigo-600'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-5 h-5" />}
                </div>
            </Tooltip>
            
            {/* Bubble */}
            <div className={`max-w-[85%] lg:max-w-[70%] p-4 md:p-5 shadow-md text-sm md:text-[15px] leading-relaxed relative group transition-all duration-300
              ${msg.role === 'user' 
                ? 'bg-slate-900 text-white rounded-[1.5rem] rounded-tr-sm' 
                : 'bg-white text-slate-800 rounded-[1.5rem] rounded-tl-sm border border-slate-100'}`}>
              <p className="whitespace-pre-wrap break-words">{msg.text}</p>
              <span className={`text-[10px] font-medium opacity-50 mt-2 block text-right
                 ${msg.role === 'user' ? 'text-slate-300' : 'text-slate-400'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </span>
            </div>
          </div>
        ))}
        
        {/* Loading Indicator */}
        {isLoading && (
           <div className="flex gap-4 animate-fade-in">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-white border border-slate-100 shadow-sm`}>
              <Bot className={`w-4 h-4 ${isAllDocs ? 'text-fuchsia-500' : 'text-indigo-500'}`} />
            </div>
            <div className="bg-white border border-slate-100 rounded-[1.5rem] rounded-tl-sm px-6 py-4 shadow-sm flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
            onClick={scrollToBottom}
            className="absolute bottom-28 right-6 z-30 p-3 bg-white text-indigo-600 rounded-full shadow-lg border border-slate-100 hover:bg-indigo-50 transition-all animate-scale-in"
        >
            <ArrowDown className="w-5 h-5" />
        </button>
      )}

      {/* Floating Input Area */}
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-slate-50 via-slate-50/90 to-transparent z-20 pointer-events-none">
        <div className="max-w-4xl mx-auto pointer-events-auto">
          <form onSubmit={handleSend} className="relative group">
            {/* Removed the background glow div that created the 'rectangular area' effect */}
             
            <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 p-1.5 pl-6 flex items-center gap-3 transition-all duration-300 group-focus-within:shadow-xl">
                <div className="flex-1 min-w-0">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={isAllDocs ? "Ask your Knowledge Base..." : "Ask about this document..."}
                        className="w-full bg-transparent border-none focus:ring-0 text-slate-800 placeholder-slate-400 text-sm md:text-base font-medium py-3"
                        disabled={isLoading}
                    />
                </div>
                <Tooltip content="Send Message" position="top">
                    <button 
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className={`h-10 w-10 md:h-12 md:w-12 rounded-xl flex items-center justify-center text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 hover:scale-105 active:scale-95
                        ${isAllDocs 
                            ? 'bg-gradient-to-br from-fuchsia-600 to-purple-700 hover:shadow-fuchsia-500/30' 
                            : 'bg-gradient-to-br from-indigo-600 to-blue-700 hover:shadow-indigo-500/30'}`}
                    >
                    <ArrowUp className="w-5 h-5 md:w-6 md:h-6 stroke-[3px]" />
                    </button>
                </Tooltip>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
