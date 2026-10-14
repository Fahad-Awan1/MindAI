
export interface DocumentFile {
  id: string;
  title: string;
  content: string; // Used for text files, empty for binary
  inlineData?: {
    data: string; // Base64 string
    mimeType: string;
  };
  type: 'text' | 'markdown' | 'pdf' | 'docx' | 'pptx';
  createdAt: number;
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
}

export interface StudyTask {
  day: number;
  topic: string;
  tasks: string[];
  estimatedMinutes: number;
}

export interface ExamQuestion {
    id: number;
    question: string;
    marks: number;
    type: 'short' | 'long';
    answerKey: string;
}

export interface ExamPaper {
    title: string;
    totalMarks: number;
    durationMinutes: number;
    questions: ExamQuestion[];
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  DOCUMENTS = 'DOCUMENTS',
  CHAT = 'CHAT',
  QUIZ = 'QUIZ',
  FLASHCARDS = 'FLASHCARDS',
  PLANNER = 'PLANNER',
  EXAM = 'EXAM'
}

export interface AnalysisState {
  isLoading: boolean;
  error: string | null;
}