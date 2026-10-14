import axios from 'axios';
import { authHeaders, getToken, notifyUnauthorized, setToken } from './authToken';
import {
  AnswerValue, AttemptHistoryItem, AttemptResult, ExamStreamRequest, GenerationEvent, ItemResult, Question,
  QuizMode, QuizQuestionType, QuizStreamRequest, ResponseItem, DifficultySetting, ExamAttempt, MarkingEvent, QuestionMark,
} from '../assessment/types';
import { DocumentFile, ChatMessage, ChatResponse, Flashcard, QuizQuestion, StudyTask, ExamPaper, StudySet, StudySetKind, StudySetSummary, StudyActivity, Progress, CardSchedule, DueQueue, ReviewRating, TopicStat, TeachBackData, ExamGrade, Source, DocumentSegment, AudioOverviewData, ConceptGraph, RoomSummary, RoomDetail, RoomMessage, InvitePreview, Persona, StudyGroupData, ImportJob } from '../types';
import { saveFile } from './platform';

// Same origin by default: the Vite dev server proxies /api (and WebSockets) to the backend.
// Set VITE_API_URL to call a backend on another address directly.
export const API_BASE_URL: string = import.meta.env.VITE_API_URL || '';

// Create axios instance. A timeout stops spinners hanging forever when a connection silently drops
// (uploads set their own, longer timeout).
const api = axios.create({
  baseURL: API_BASE_URL,
  // Generous: some AI requests (audio overviews, mind maps) legitimately take a few minutes
  timeout: 300_000,
});
const UPLOAD_TIMEOUT = 15 * 60_000;

const SERVER_UNREACHABLE = "Can't reach the MindAI server right now. Check your internet connection and try again.";
// Gateway / tunnel errors (Cloudflare 52x, proxy 502-504): the server itself is down or unreachable
const isGatewayStatus = (status: number) => (status >= 502 && status <= 504) || (status >= 520 && status <= 530);

/** Sign out only if the rejected request used the current token (not an older one replaced meanwhile). */
const handleUnauthorized = (sentAuthorization: string | null | undefined) => {
  const current = getToken();
  if (!current || (sentAuthorization && sentAuthorization !== `Bearer ${current}`)) return;
  setToken(null);
  notifyUnauthorized();
};

// Every request carries the login token; a rejected token signs the user out
api.interceptors.request.use(config => {
  Object.entries(authHeaders()).forEach(([key, value]) => config.headers.set(key, value));
  return config;
});
api.interceptors.response.use(
  response => response,
  error => {
    const url: string = error.config?.url ?? '';
    const authFlow = ['/api/auth/login', '/api/auth/signup', '/api/auth/google', '/api/auth/verify-email', '/api/auth/reset-password'].some(p => url.includes(p));
    if (error.response?.status === 401 && !authFlow) {
      const sent = error.config?.headers?.Authorization ?? error.config?.headers?.get?.('Authorization');
      handleUnauthorized(sent ? String(sent) : null);
    }
    return Promise.reject(error);
  }
);

/** Error raised by streaming requests; `message` holds a user-friendly description. */
export class StreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamError';
  }
}

const STREAM_INTERRUPTED = 'The connection was interrupted before the answer finished. Please try again.';

/** POST to a streaming endpoint; throws StreamError with a clear message when it can't start. */
const openStream = async (path: string, body: unknown, signal?: AbortSignal): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  let response: Response;
  const authorization = authHeaders().Authorization;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new StreamError(SERVER_UNREACHABLE);
  }
  if (response.status === 401) handleUnauthorized(authorization);
  if (!response.ok || !response.body) {
    let detail = isGatewayStatus(response.status) ? SERVER_UNREACHABLE : `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === 'string') detail = data.detail;
    } catch {
      // Non-JSON error body (e.g. a proxy's HTML page) - keep the message above
    }
    throw new StreamError(detail);
  }
  return response.body.getReader();
};

/** Read NDJSON lines from a stream. A dropped connection (or a stream that ends without "done") is an error. */
const readLines = async (reader: ReadableStreamDefaultReader<Uint8Array>, onLine: (line: string) => void, finished: () => boolean) => {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      throw new StreamError(STREAM_INTERRUPTED);
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(line => { if (line.trim()) onLine(line); });
  }
  buffer += decoder.decode();
  if (buffer.trim()) onLine(buffer);
  if (!finished()) throw new StreamError(STREAM_INTERRUPTED);
};

/**
 * Turn an API error into a user-friendly message, preferring the backend's `detail`.
 */
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof StreamError) return error.message;
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return 'The server took too long to answer. Check your connection and try again.';
    }
    if (!error.response) return SERVER_UNREACHABLE;
    const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
    if (!detail && isGatewayStatus(error.response.status)) return SERVER_UNREACHABLE;
    if (typeof detail === 'string' && detail.trim()) return detail;
    // Validation errors: show the first message without pydantic's "Value error," prefix
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error,\s*/i, '');
  }
  return fallback;
};

// History entry sent to the chat endpoints
export interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
}

// Document API
export const documentsAPI = {
  upload: async (file: File): Promise<DocumentFile> => {
    const formData = new FormData();
    formData.append('file', file);
    // Let the browser set the multipart Content-Type (including the boundary)
    const response = await api.post('/api/documents/upload', formData, { timeout: UPLOAD_TIMEOUT });
    return response.data;
  },

  getAll: async (): Promise<DocumentFile[]> => {
    const response = await api.get('/api/documents');
    return response.data;
  },

  getSegments: async (id: string): Promise<DocumentSegment[]> => {
    const response = await api.get(`/api/documents/${id}/segments`);
    return response.data;
  },

  getById: async (id: string): Promise<DocumentFile> => {
    const response = await api.get(`/api/documents/${id}`);
    return response.data;
  },

  delete: async (id: string) => {
    const response = await api.delete(`/api/documents/${id}`);
    return response.data;
  },
};

export interface StreamOptions {
  onDelta: (text: string) => void;
  /** Numbered passages the answer may cite as [n] (sent before the answer) */
  onSources?: (sources: Source[]) => void;
  signal?: AbortSignal;
}

type StreamEvent =
  | { type: 'sources'; sources: Source[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; chat_id: string }
  | { type: 'error'; detail: string };

/**
 * POST to a streaming endpoint and read its NDJSON events, calling `onDelta` for each text piece.
 * Resolves with the saved chat message ID; rejects with StreamError (or AbortError if aborted).
 */
export const streamChat = async (path: string, body: unknown, { onDelta, onSources, signal }: StreamOptions): Promise<{ chat_id: string }> => {
  const reader = await openStream(path, body, signal);
  let chatId = '';
  let done = false;
  await readLines(reader, line => {
    const event = JSON.parse(line) as StreamEvent;
    if (event.type === 'sources') onSources?.(event.sources);
    else if (event.type === 'delta') onDelta(event.text);
    else if (event.type === 'done') { chatId = event.chat_id; done = true; }
    else if (event.type === 'error') throw new StreamError(event.detail || 'The AI service failed.');
  }, () => done);
  return { chat_id: chatId };
};

// Chat API
export const chatAPI = {
  streamDocument: (documentId: string, message: string, history: ChatHistoryItem[], options: StreamOptions, persona?: string | null) =>
    streamChat('/api/chat/document/stream', { document_id: documentId, message, history, persona: persona || null }, options),

  streamKnowledgeBase: (message: string, history: ChatHistoryItem[], options: StreamOptions, persona?: string | null) =>
    streamChat('/api/chat/knowledge-base/stream', { message, history, persona: persona || null }, options),

  chatWithDocument: async (documentId: string, message: string, history: ChatHistoryItem[]): Promise<ChatResponse> => {
    const response = await api.post('/api/chat/document', {
      document_id: documentId,
      message,
      history,
    });
    return response.data;
  },

  chatWithKnowledgeBase: async (message: string, history: ChatHistoryItem[]): Promise<ChatResponse> => {
    const response = await api.post('/api/chat/knowledge-base', {
      message,
      history,
    });
    return response.data;
  },

  getHistory: async (documentId: string): Promise<ChatMessage[]> => {
    const response = await api.get(`/api/chat/history/${documentId}`);
    return response.data;
  },

  getKnowledgeBaseHistory: async (): Promise<ChatMessage[]> => {
    const response = await api.get('/api/chat/history');
    return response.data;
  }
};

// AI Features API - every generation is saved as a study set and returned
export const aiAPI = {
  generateFlashcards: async (documentId: string, count: number = 10): Promise<StudySet<Flashcard[]>> => {
    const response = await api.post('/api/ai/flashcards', {
      document_id: documentId,
      count,
    });
    return response.data;
  },

  generateQuiz: async (documentId: string, count: number = 5, focusWeakTopics: boolean = false): Promise<StudySet<QuizQuestion[]>> => {
    const response = await api.post('/api/ai/quiz', {
      document_id: documentId,
      count,
      focus_weak_topics: focusWeakTopics,
    });
    return response.data;
  },

  generateStudyPlan: async (documentId: string, days: number = 5): Promise<StudySet<StudyTask[]>> => {
    const response = await api.post('/api/ai/study-plan', {
      document_id: documentId,
      days,
    });
    return response.data;
  },

  generateMindMap: async (documentId: string): Promise<StudySet<string>> => {
    const response = await api.post('/api/ai/mind-map', {
      document_id: documentId,
    });
    return response.data;
  },

  generateExamPaper: async (documentId: string, numQuestions: number, difficulty: string, type: string): Promise<StudySet<ExamPaper>> => {
    const response = await api.post('/api/ai/exam-paper', {
      document_id: documentId,
      num_questions: numQuestions,
      difficulty,
      type
    });
    return response.data;
  }
};

// Saved study sets & attempts
export const studySetsAPI = {
  list: async (params: { documentId?: string; kind?: StudySetKind } = {}): Promise<StudySetSummary[]> => {
    const response = await api.get('/api/study-sets', {
      params: { document_id: params.documentId, kind: params.kind },
    });
    return response.data;
  },

  get: async <T,>(id: string): Promise<StudySet<T>> => {
    const response = await api.get(`/api/study-sets/${id}`);
    return response.data;
  },

  rename: async (id: string, title: string): Promise<StudySetSummary> => {
    const response = await api.patch(`/api/study-sets/${id}`, { title });
    return response.data;
  },

  delete: async (id: string) => {
    const response = await api.delete(`/api/study-sets/${id}`);
    return response.data;
  },

  submitQuizAttempt: async (id: string, answers: number[]): Promise<StudyActivity> => {
    const response = await api.post(`/api/study-sets/${id}/quiz-attempts`, { answers });
    return response.data;
  },

  submitFlashcardSession: async (id: string, results: boolean[]): Promise<StudyActivity> => {
    const response = await api.post(`/api/study-sets/${id}/flashcard-sessions`, { results });
    return response.data;
  },

  getSchedule: async (id: string): Promise<CardSchedule[]> => {
    const response = await api.get(`/api/study-sets/${id}/schedule`);
    return response.data;
  },

  submitExamAttempt: async (id: string, answers: string[]): Promise<ExamGrade> => {
    const response = await api.post(`/api/study-sets/${id}/exam-attempts`, { answers });
    return response.data;
  },

  submitReviews: async (id: string, ratings: { card_index: number; rating: ReviewRating }[]): Promise<{ activity: StudyActivity; schedule: CardSchedule[] }> => {
    const response = await api.post(`/api/study-sets/${id}/reviews`, { ratings });
    return response.data;
  },
};

// Spaced-repetition review queue & weak topics
export const reviewAPI = {
  getDue: async (newLimit: number = 10): Promise<DueQueue> => {
    const response = await api.get('/api/review/due', { params: { new_limit: newLimit } });
    return response.data;
  },
};

export const topicsAPI = {
  get: async (documentId: string): Promise<TopicStat[]> => {
    const response = await api.get('/api/topics', { params: { document_id: documentId } });
    return response.data;
  },
};

// Learning progress
export const progressAPI = {
  get: async (): Promise<Progress> => {
    const response = await api.get('/api/progress', {
      // Lets the server compute streaks and daily activity in the student's local time
      params: { tz_offset_minutes: new Date().getTimezoneOffset() },
    });
    return response.data;
  },
};

export default api;

// Tutoring
export interface ExplainMistakeBody {
  document_id: string;
  question: string;
  options: string[];
  correct_answer_index: number;
  chosen_index: number;
  explanation: string;
  history: ChatHistoryItem[];
  message?: string;
  /** Non-multiple-choice questions send the answers as text */
  question_type?: string;
  correct_answer_text?: string;
  student_answer_text?: string;
}

export const tutorAPI = {
  explainMistake: (body: ExplainMistakeBody, options: StreamOptions) =>
    streamChat('/api/tutor/explain/stream', body, options),

  getConcepts: async (documentId: string): Promise<string[]> => {
    const response = await api.get('/api/tutor/concepts', { params: { document_id: documentId } });
    return response.data;
  },

  /** Explain or simplify a highlighted passage (streams; supports follow-ups) */
  selection: (body: { document_id: string; selection: string; action: 'explain' | 'simplify'; history: ChatHistoryItem[]; message?: string }, options: StreamOptions) =>
    streamChat('/api/tutor/selection/stream', body, options),

  /** Turn a highlighted passage into flashcards in the document's Highlights deck */
  selectionFlashcards: async (documentId: string, selection: string): Promise<StudySet<Flashcard[]>> => {
    const response = await api.post('/api/tutor/selection/flashcards', { document_id: documentId, selection });
    return response.data;
  },

  /** Short quiz about a highlighted passage (saved as a quiz set) */
  selectionQuiz: async (documentId: string, selection: string, count: number = 3): Promise<StudySet<QuizQuestion[]>> => {
    const response = await api.post('/api/tutor/selection/quiz', { document_id: documentId, selection, count });
    return response.data;
  },

  teachBack: async (documentId: string, concept: string, explanation: string): Promise<StudySet<TeachBackData>> => {
    const response = await api.post('/api/tutor/teach-back', { document_id: documentId, concept, explanation });
    return response.data;
  },
};

// Voice: speech-to-text (Groq Whisper) and text-to-speech (Groq Orpheus, if enabled)
export interface VoiceStatus {
  stt_available: boolean;
  tts_available: boolean;
  tts_reason: string | null;
  voices: string[];
}

export const voiceAPI = {
  transcribe: async (audio: Blob, filename: string): Promise<string> => {
    const formData = new FormData();
    formData.append('file', audio, filename);
    const response = await api.post('/api/voice/transcribe', formData, { timeout: UPLOAD_TIMEOUT });
    return response.data.text;
  },

  status: async (): Promise<VoiceStatus> => {
    const response = await api.get('/api/voice/status');
    return response.data;
  },

  speak: async (text: string, voice?: string): Promise<Blob> => {
    const response = await api.post('/api/voice/speak', { text, voice }, { responseType: 'blob' });
    return response.data;
  },
};

// Audio overview (podcast)
export const audioAPI = {
  generate: async (documentId: string, length: 'short' | 'medium'): Promise<StudySet<AudioOverviewData>> => {
    const response = await api.post('/api/ai/audio-overview', { document_id: documentId, length });
    return response.data;
  },

  /** Render studio audio with Groq voices (fails with 503 until Groq TTS is enabled) */
  render: async (setId: string): Promise<StudySet<AudioOverviewData>> => {
    const response = await api.post(`/api/study-sets/${setId}/render-audio`);
    return response.data;
  },

  /** Rendered studio audio as a blob (an <audio> tag can't send the login header) */
  fetchAudio: async (setId: string): Promise<Blob> => {
    const response = await api.get(`/api/audio/${setId}`, { responseType: 'blob' });
    return response.data;
  },
};

// Concept graph across documents
export const graphAPI = {
  get: async (rebuild: boolean = false): Promise<ConceptGraph> => {
    const response = await api.get('/api/graph', { params: { rebuild } });
    return response.data;
  },
};

// Accounts
export interface User {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  created_at: number;
}

export interface AuthResult {
  /** Missing while the email still has to be confirmed with a code */
  token?: string | null;
  user?: User | null;
  claimed_documents: number;
  verification_required?: boolean;
  email?: string | null;
}

export const authAPI = {
  signup: async (name: string, email: string, password: string): Promise<AuthResult> => {
    const response = await api.post('/api/auth/signup', { name, email, password });
    return response.data;
  },

  login: async (email: string, password: string): Promise<AuthResult> => {
    const response = await api.post('/api/auth/login', { email, password });
    return response.data;
  },

  me: async (): Promise<User> => {
    const response = await api.get('/api/auth/me');
    return response.data;
  },

  /** A fresh token for the current session (sessions stay alive while the app is used) */
  refresh: async (): Promise<AuthResult> => (await api.post('/api/auth/refresh')).data,

  updateProfile: async (name: string): Promise<User> => {
    const response = await api.patch('/api/auth/me', { name });
    return response.data;
  },

  verifyEmail: async (email: string, code: string): Promise<AuthResult> =>
    (await api.post('/api/auth/verify-email', { email, code })).data,

  resendVerification: async (email: string): Promise<void> => {
    await api.post('/api/auth/resend-verification', { email });
  },

  forgotPassword: async (email: string): Promise<void> => {
    await api.post('/api/auth/forgot-password', { email });
  },

  resetPassword: async (email: string, code: string, newPassword: string): Promise<AuthResult> =>
    (await api.post('/api/auth/reset-password', { email, code, new_password: newPassword })).data,

  google: async (idToken: string): Promise<AuthResult> =>
    (await api.post('/api/auth/google', { id_token: idToken })).data,

  changePassword: async (currentPassword: string, newPassword: string) => {
    const response = await api.post('/api/auth/change-password', { current_password: currentPassword, new_password: newPassword });
    // Other devices are signed out; keep this one signed in with the fresh token
    if (response.data?.token) setToken(response.data.token);
    return response.data;
  },
};

// Study rooms
export const roomsAPI = {
  list: async (): Promise<RoomSummary[]> => (await api.get('/api/rooms')).data,
  create: async (name: string): Promise<RoomDetail> => (await api.post('/api/rooms', { name })).data,
  get: async (id: string): Promise<RoomDetail> => (await api.get(`/api/rooms/${id}`)).data,
  rename: async (id: string, name: string): Promise<RoomDetail> => (await api.patch(`/api/rooms/${id}`, { name })).data,
  remove: async (id: string) => (await api.delete(`/api/rooms/${id}`)).data,
  resetInvite: async (id: string): Promise<RoomDetail> => (await api.post(`/api/rooms/${id}/invite/reset`)).data,
  previewInvite: async (code: string): Promise<InvitePreview> => (await api.get(`/api/rooms/invite/${encodeURIComponent(code)}`)).data,
  join: async (code: string): Promise<RoomDetail> => (await api.post(`/api/rooms/join/${encodeURIComponent(code)}`)).data,
  leave: async (id: string) => (await api.post(`/api/rooms/${id}/leave`)).data,
  removeMember: async (id: string, userId: string) => (await api.delete(`/api/rooms/${id}/members/${userId}`)).data,
  shareDocument: async (id: string, documentId: string): Promise<RoomDetail> => (await api.post(`/api/rooms/${id}/documents`, { document_id: documentId })).data,
  unshareDocument: async (id: string, shareId: string): Promise<RoomDetail> => (await api.delete(`/api/rooms/${id}/documents/${shareId}`)).data,
  messages: async (id: string, before?: number): Promise<RoomMessage[]> => (await api.get(`/api/rooms/${id}/messages`, { params: { before } })).data,

  /** WebSocket URL for a room (same origin as the API) */
  socketUrl: (id: string, token: string) => {
    const base = API_BASE_URL || window.location.origin;
    return `${base.replace(/^http/, 'ws')}/api/rooms/${id}/ws?token=${encodeURIComponent(token)}`;
  },

  /** This machine's network addresses (so invite links work when the app is opened on localhost) */
  networkAddresses: async (): Promise<string[]> => (await api.get('/api/rooms/network/addresses')).data.addresses,

  /** Shareable invite link; `origin` overrides the current one (e.g. the LAN address) */
  inviteLink: (code: string, origin: string = window.location.origin) => `${origin}/join/${code}`,
};

/**
 * POST to an NDJSON streaming endpoint and hand every event to `onEvent`.
 * Rejects with StreamError on HTTP or {"type":"error"} failures (AbortError if aborted).
 */
export const streamEvents = async (
  path: string,
  body: unknown,
  onEvent: (event: any) => void,
  signal?: AbortSignal
): Promise<void> => {
  const reader = await openStream(path, body, signal);
  let done = false;
  await readLines(reader, line => {
    const event = JSON.parse(line);
    if (event.type === 'error') throw new StreamError(event.detail || 'The AI service failed.');
    if (event.type === 'done') done = true;
    onEvent(event);
  }, () => done);
};

// AI study group
export const studyGroupAPI = {
  personas: async (): Promise<Persona[]> => (await api.get('/api/study-group/personas')).data,

  create: async (topic: string, documentIds: string[], personas: string[]): Promise<StudySet<StudyGroupData>> =>
    (await api.post('/api/study-group/sessions', { topic, document_ids: documentIds, personas })).data,

  /** Speak (optional message) and stream the classmates' replies */
  turn: (setId: string, message: string | undefined, onEvent: (event: any) => void, signal?: AbortSignal) =>
    streamEvents(`/api/study-group/${setId}/turn`, message ? { message } : {}, onEvent, signal),

  end: async (setId: string): Promise<StudySet<StudyGroupData>> =>
    (await api.post(`/api/study-group/${setId}/end`)).data,
};

// Lecture-to-Notes: recordings, YouTube videos and web articles become documents
export const importsAPI = {
  uploadMedia: async (file: File): Promise<ImportJob> => {
    const formData = new FormData();
    formData.append('file', file);
    return (await api.post('/api/imports/media', formData, { timeout: UPLOAD_TIMEOUT })).data;
  },
  importUrl: async (url: string): Promise<ImportJob> => (await api.post('/api/imports/url', { url })).data,
  list: async (): Promise<ImportJob[]> => (await api.get('/api/imports')).data,
  get: async (id: string): Promise<ImportJob> => (await api.get(`/api/imports/${id}`)).data,
  dismiss: async (id: string) => (await api.delete(`/api/imports/${id}`)).data,
};

// Quiz & exam engine: streamed generation, editing questions, attempts with every question type
export const assessmentAPI = {
  streamQuiz: (body: QuizStreamRequest, onEvent: (event: GenerationEvent) => void, signal?: AbortSignal) =>
    streamEvents('/api/assessment/quiz/stream', body, onEvent, signal),

  streamExam: (body: ExamStreamRequest, onEvent: (event: GenerationEvent) => void, signal?: AbortSignal) =>
    streamEvents('/api/assessment/exam/stream', body, onEvent, signal),

  outline: async (documentId: string): Promise<{ label: string; chars: number }[]> =>
    (await api.get(`/api/assessment/documents/${documentId}/outline`)).data.sections,

  regenerate: async (setId: string, qid: string, mode: 'same' | 'harder' | 'easier' | 'variant'):
    Promise<{ question: Question; set: StudySet<unknown> }> =>
    (await api.post(`/api/assessment/sets/${setId}/questions/${qid}/regenerate`, { mode })).data,

  editQuestion: async (setId: string, qid: string, question: Question): Promise<{ question: Question; set: StudySet<unknown> }> =>
    (await api.patch(`/api/assessment/sets/${setId}/questions/${qid}`, question)).data,

  updateMeta: async (setId: string, body: { title?: string; duration_minutes?: number; instructions?: string[];
    sections?: { id: string; title?: string; instructions?: string; attempt_any?: number | null }[];
    header?: import('../assessment/types').PaperHeader | null }): Promise<StudySet<unknown>> =>
    (await api.patch(`/api/assessment/sets/${setId}/meta`, body)).data,

  deleteQuestion: async (setId: string, qid: string): Promise<StudySet<unknown>> =>
    (await api.delete(`/api/assessment/sets/${setId}/questions/${qid}`)).data,

  streamAddMore: (setId: string, body: { count: number; types?: QuizQuestionType[]; difficulty?: DifficultySetting },
    onEvent: (event: GenerationEvent) => void, signal?: AbortSignal) =>
    streamEvents(`/api/assessment/sets/${setId}/questions/stream`, body, onEvent, signal),

  submitAttempt: async (setId: string, mode: QuizMode, responses: ResponseItem[], durationMs: number): Promise<AttemptResult> =>
    (await api.post(`/api/assessment/sets/${setId}/attempts`, { mode, responses, duration_ms: durationMs })).data,

  check: async (setId: string, qid: string, answer: AnswerValue): Promise<ItemResult> =>
    (await api.post('/api/assessment/check', { set_id: setId, qid, answer })).data,

  attempts: async (setId: string): Promise<AttemptHistoryItem[]> =>
    (await api.get(`/api/assessment/sets/${setId}/attempts`)).data,

  streamVariant: (setId: string, qids: string[], onEvent: (event: GenerationEvent) => void, signal?: AbortSignal) =>
    streamEvents(`/api/assessment/sets/${setId}/variant/stream`, { qids }, onEvent, signal),

  toFlashcards: async (setId: string, qids: string[]): Promise<StudySetSummary> =>
    (await api.post(`/api/assessment/sets/${setId}/to-flashcards`, { qids })).data,
};

// Exam room: timed attempts, autosave, streamed marking, history and re-marks
export const examsAPI = {
  start: async (setId: string): Promise<ExamAttempt> => (await api.post(`/api/exams/${setId}/attempts`)).data,
  saveDraft: async (attemptId: string, answers: Record<string, string | number>): Promise<{ saved_at: number }> =>
    (await api.put(`/api/exams/attempts/${attemptId}/draft`, { answers })).data,
  submitStream: (attemptId: string, answers: Record<string, string | number> | null, onEvent: (event: MarkingEvent) => void, signal?: AbortSignal) =>
    streamEvents(`/api/exams/attempts/${attemptId}/submit/stream`, { answers }, onEvent, signal),
  list: async (setId: string): Promise<ExamAttempt[]> => (await api.get(`/api/exams/${setId}/attempts`)).data,
  get: async (attemptId: string): Promise<ExamAttempt> => (await api.get(`/api/exams/attempts/${attemptId}`)).data,
  remark: async (attemptId: string, qid: string, reason: string): Promise<{ result: QuestionMark; before: number; attempt: ExamAttempt }> =>
    (await api.post(`/api/exams/attempts/${attemptId}/remark`, { qid, reason })).data,
};

// Question bank: instant quizzes from questions you've already generated
export interface BankSummary {
  total: number;
  quizzable: number;
  answered: number;
  due: number;
  missed: number;
  mastered: number;
  topics: { topic: string; questions: number; answered: number; accuracy_pct: number | null }[];
}

export const bankAPI = {
  summary: async (documentId?: string): Promise<BankSummary> =>
    (await api.get('/api/bank/summary', { params: { document_id: documentId } })).data,
  quiz: async (source: 'due' | 'missed' | 'weak' | 'random', count = 10, documentId?: string): Promise<StudySet<unknown>> =>
    (await api.post('/api/bank/quiz', { source, count, document_id: documentId })).data,
};

export type ExportFormat = 'docx' | 'csv' | 'anki' | 'gift' | 'moodle' | 'kahoot' | 'gforms';

// File extension per export format (matches backend/services/assessment/export.py FORMATS)
const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  docx: 'docx', csv: 'csv', anki: 'txt', gift: 'gift.txt', moodle: 'xml', kahoot: 'kahoot.csv', gforms: 'gs',
};

/** Download a quiz or exam in another format (saves the file, or opens the share sheet in the app). */
export const downloadExport = async (setId: string, format: ExportFormat, version: 'A' | 'B' = 'A', key = true) => {
  const response = await api.get(`/api/assessment/sets/${setId}/export`, { params: { format, version, key }, responseType: 'blob' });
  const disposition = String(response.headers['content-disposition'] || '');
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let name = disposition.match(/filename="([^"]+)"/)?.[1] || `mindai.${EXPORT_EXTENSIONS[format]}`;
  if (utf8) {
    try {
      name = decodeURIComponent(utf8);
    } catch {
      // Keep the plain name
    }
  }
  await saveFile(response.data as Blob, name);
};

export const pastPaperAPI = {
  blueprint: async (documentId: string): Promise<{ sections: import('../assessment/types').BlueprintSection[]; duration_minutes: number | null; style_notes: string; paper_title: string }> =>
    (await api.post('/api/assessment/past-paper/blueprint', { document_id: documentId })).data,
};

export interface ChallengeRow { user: { id: string; name: string; avatar_color: string }; score: number; total: number; pct: number; duration_ms: number; attempts: number }
export interface Challenge {
  id: string;
  room_id: string;
  title: string;
  count: number;
  time_limit_s: number | null;
  created_at: number;
  created_by: { id: string; name: string };
  my_attempts: number;
  leaderboard: ChallengeRow[];
  questions?: Question[];
}

export const challengesAPI = {
  create: async (roomId: string, setId: string, timeLimitS?: number | null): Promise<Challenge> =>
    (await api.post(`/api/rooms/${roomId}/challenges`, { set_id: setId, time_limit_s: timeLimitS ?? null })).data,
  list: async (roomId: string): Promise<Challenge[]> => (await api.get(`/api/rooms/${roomId}/challenges`)).data,
  get: async (id: string): Promise<Challenge> => (await api.get(`/api/challenges/${id}`)).data,
  submit: async (id: string, responses: ResponseItem[], durationMs: number):
    Promise<{ results: ItemResult[]; score: number; total: number; score_pct: number; leaderboard: ChallengeRow[]; questions: Question[] }> =>
    (await api.post(`/api/challenges/${id}/attempts`, { responses, duration_ms: durationMs })).data,
};
