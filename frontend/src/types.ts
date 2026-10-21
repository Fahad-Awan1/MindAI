
export interface DocumentFile {
  id: string;
  title: string;
  content: string;
  inline_data?: {
    data: string;
    mime_type: string;
  };
  type: 'text' | 'markdown' | 'pdf' | 'docx' | 'pptx' | 'lecture' | 'web';
  created_at: number;
  summary?: string;
}

/** A numbered passage an AI answer can cite as [n] */
export interface Source {
  n: number;
  document_id: string;
  document_title: string;
  location: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  sources?: Source[] | null;
  /** AI personality that answered (null = MindAI) */
  persona?: string | null;
}

export interface ChatResponse {
  message: string;
  chat_id: string;
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  topic?: string | null;
}

export interface StudyTask {
  day: number;
  topic: string;
  tasks: string[];
  estimated_minutes: number;
}

export interface ExamQuestion {
    id: number;
    question: string;
    marks: number;
    type: 'short' | 'long';
    answer_key: string;
}

export interface ExamPaper {
    title: string;
    total_marks: number;
    duration_minutes: number;
    questions: ExamQuestion[];
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  DOCUMENTS = 'DOCUMENTS',
  CHAT = 'CHAT',
  QUIZ = 'QUIZ',
  FLASHCARDS = 'FLASHCARDS',
  PLANNER = 'PLANNER',
  EXAM = 'EXAM',
  MINDMAP = 'MINDMAP',
  TEACH = 'TEACH',
  READER = 'READER',
  AUDIO = 'AUDIO',
  GRAPH = 'GRAPH',
  ROOMS = 'ROOMS',
  PROJECTS = 'PROJECTS',
  ABOUT = 'ABOUT',
  // (The separate AI Study Group screen was folded into AI Chat's personalities)
}

export type StudySetKind = 'quiz' | 'flashcards' | 'study_plan' | 'exam' | 'mind_map' | 'teach_back' | 'audio_overview' | 'study_group';
export type ActivityKind = 'quiz' | 'flashcards' | 'exam' | 'teach_back' | 'study_group';

export interface StudySetSummary {
  id: string;
  document_id: string;
  document_title: string;
  kind: StudySetKind;
  title: string;
  config: Record<string, unknown>;
  item_count: number;
  created_at: number;
  attempts: number;
  best_score_pct: number | null;
  last_score_pct: number | null;
  last_activity_at: number | null;
}

export interface StudySet<T = unknown> extends StudySetSummary {
  data: T;
}

export interface StudyActivity {
  id: string;
  study_set_id: string | null;
  kind: ActivityKind;
  correct: number;
  total: number;
  score_pct: number;
  created_at: number;
}

export interface DailyActivity {
  date: string;
  quizzes: number;
  flashcard_sessions: number;
  chat_messages: number;
  tutor_sessions: number;
  total: number;
}

export interface QuizTrendPoint {
  created_at: number;
  score_pct: number;
  document_title: string;
  study_set_title: string | null;
}

export interface DocumentMastery {
  document_id: string;
  document_title: string;
  mastery_pct: number | null;
  quiz_attempts: number;
  flashcard_sessions: number;
  study_sets: number;
  last_studied_at: number | null;
  weak_topics: TopicStat[];
}

export interface Progress {
  totals: {
    documents: number;
    study_sets: number;
    quizzes_taken: number;
    avg_quiz_accuracy_pct: number | null;
    cards_reviewed: number;
    cards_known: number;
    chat_questions: number;
  };
  current_streak_days: number;
  longest_streak_days: number;
  studied_today: boolean;
  cards_due_now: number;
  cards_due_today: number;
  cards_new: number;
  daily_activity: DailyActivity[];
  quiz_trend: QuizTrendPoint[];
  mastery: DocumentMastery[];
  recent_sets: StudySetSummary[];
  xp?: number;
  level?: number;
  level_progress_pct?: number;
  next_level_xp?: number;
  badges?: { id: string; title: string; description: string; earned: boolean }[];
  bank_due?: number;
  bank_total?: number;
}

/** Which screen shows each kind of study set */
export const STUDY_SET_VIEW: Record<StudySetKind, AppView> = {
  quiz: AppView.QUIZ,
  flashcards: AppView.FLASHCARDS,
  study_plan: AppView.PLANNER,
  exam: AppView.EXAM,
  mind_map: AppView.MINDMAP,
  teach_back: AppView.TEACH,
  audio_overview: AppView.AUDIO,
  study_group: AppView.CHAT,
};

export interface TopicStat {
  topic: string;
  correct: number;
  total: number;
  accuracy_pct: number;
  last_seen_at: number;
}

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface CardSchedule {
  card_index: number;
  is_new: boolean;
  due_at: number | null;
  interval_days: number;
  ease: number;
  repetitions: number;
  lapses: number;
  last_rating: ReviewRating | null;
  /** Days until the next review for each rating (0 = again in this session) */
  next_intervals: Record<ReviewRating, number>;
}

export interface DueCard {
  study_set_id: string;
  study_set_title: string;
  document_id: string;
  document_title: string;
  card_index: number;
  front: string;
  back: string;
  schedule: CardSchedule;
}

export interface DueQueue {
  due_count: number;
  new_count: number;
  cards: DueCard[];
}

export interface TeachBackFeedback {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  misconceptions: string[];
  improved_explanation: string;
  follow_up_question: string;
}

export interface TeachBackData {
  concept: string;
  explanation: string;
  feedback: TeachBackFeedback;
}

export interface ExamQuestionGrade {
  id: number;
  awarded_marks: number;
  max_marks: number;
  feedback: string;
  missing_points: string[];
}

export interface ExamGrade {
  activity: StudyActivity;
  total_awarded: number;
  total_marks: number;
  score_pct: number;
  questions: ExamQuestionGrade[];
  overall_feedback: string;
}

export interface DocumentSegment {
  index: number;
  label: string | null;
  text: string;
}

/** Where to scroll the reader to (e.g. a cited source) */
export interface ReaderFocus {
  documentId: string;
  text: string;
  label?: string | null;
}

export interface PodcastLine {
  speaker: 'A' | 'B';
  name: string;
  text: string;
}

export interface AudioOverviewData {
  title: string;
  lines: PodcastLine[];
  /** Studio audio rendered with Groq voices (null = play with browser voices) */
  audio: { file: string; durations: number[] } | null;
}

export interface GraphNode {
  id: string;
  name: string;
  description: string;
  documents: { id: string; title: string }[];
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  documents: string[];
}

export interface ConceptGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  documents: { id: string; title: string; concepts: number; mapped: boolean }[];
  shared_concepts: number;
  failed: string[];
}

/** Hand-off from another screen (e.g. the concept graph) to chat or teach-back */
export interface ConceptRequest {
  documentId: string;
  concept: string;
}

// Study rooms
export interface UserBrief {
  id: string;
  name: string;
  avatar_color: string;
}

export interface RoomMemberInfo extends UserBrief {
  role: 'owner' | 'member';
  joined_at: number;
  online: boolean;
}

export interface RoomSharedDocument {
  id: string;
  document_id: string;
  title: string;
  type: string;
  summary: string | null;
  shared_by: UserBrief;
  shared_at: number;
  mine: boolean;
}

export interface RoomSummary {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  my_role: 'owner' | 'member';
  member_count: number;
  online_count: number;
  document_count: number;
  created_at: number;
  last_message: { text: string; kind: string; user_name: string | null; created_at: number } | null;
}

export interface RoomDetail extends RoomSummary {
  members: RoomMemberInfo[];
  documents: RoomSharedDocument[];
  quiz_active: boolean;
}

export interface LeaderboardRow {
  user: UserBrief;
  score: number;
  correct: number;
}

export interface RoomMessage {
  id: string;
  room_id: string;
  kind: 'user' | 'ai' | 'system' | 'quiz';
  text: string;
  sources: Source[] | null;
  data: { leaderboard?: LeaderboardRow[]; questions?: number; persona?: string; challenge_id?: string; title?: string } | null;
  created_at: number;
  user: UserBrief | null;
}

export interface InvitePreview {
  id: string;
  name: string;
  owner_name: string;
  member_count: number;
  already_member: boolean;
}

// AI study group
export interface Persona {
  id: string;
  name: string;
  role: string;
  color: string;
  description: string;
}

export interface GroupLine {
  speaker: string; // persona id, 'student' or 'moderator'
  text: string;
  sources?: Source[];
  at: number;
}

export interface StudyGroupSummary {
  summary: string;
  key_points: string[];
  open_questions: string[];
  misconceptions: string[];
  student_score: number | null;
  student_strengths: string[];
  student_improvements: string[];
}

export interface StudyGroupData {
  topic: string;
  document_ids: string[];
  document_titles: string[];
  personas: string[];
  transcript: GroupLine[];
  status: 'active' | 'ended';
  summary: StudyGroupSummary | null;
}

// Lecture-to-Notes imports
export interface ImportJob {
  id: string;
  kind: 'media' | 'youtube' | 'web';
  source: string;
  title: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: string | null;
  progress: number;
  document_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

// --- Chat history & projects ----------------------------------------------------------------------

/** What a chat answers from: one document, every document, or a project's documents and instructions */
export type ChatScope = 'document' | 'all' | 'project';

export interface ConversationSummary {
  id: string;
  title: string;
  scope: ChatScope;
  document_id: string | null;
  document_title: string | null;
  project_id: string | null;
  project_name: string | null;
  pinned: boolean;
  persona: string | null;
  created_at: number;
  updated_at: number;
  /** Matching text, when the chat was found by searching its messages */
  snippet?: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

export type ProjectColor = 'indigo' | 'violet' | 'sky' | 'emerald' | 'amber' | 'rose' | 'slate';

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  color: ProjectColor;
  created_at: number;
  updated_at: number;
  document_count: number;
  chat_count: number;
}

export interface ProjectDetail extends Project {
  documents: { id: string; title: string; type: string; created_at: number }[];
  chats: ConversationSummary[];
}

/** Where the chat screen should open: an existing chat, or a new one (optionally in a project, optionally sending a first message) */
export interface ChatTarget {
  key: number;
  conversationId?: string | null;
  projectId?: string | null;
  message?: string | null;
}
