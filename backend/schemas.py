from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Dict, Optional, List, Literal


# Document Schemas
class DocumentBase(BaseModel):
    id: str
    title: str
    content: str = ""
    type: Literal['text', 'markdown', 'pdf', 'docx', 'pptx', 'lecture', 'web']
    created_at: int
    summary: Optional[str] = None


class DocumentCreate(BaseModel):
    title: str
    content: str
    type: Literal['text', 'markdown', 'pdf', 'docx', 'pptx']
    file_data: Optional[str] = None  # Base64 for binary files
    mime_type: Optional[str] = None


class DocumentResponse(DocumentBase):
    inline_data: Optional[dict] = None

    model_config = ConfigDict(from_attributes=True)


# Chat Schemas
class ChatMessage(BaseModel):
    id: str
    role: Literal['user', 'model']
    text: str
    timestamp: int
    # Numbered source passages the answer cites as [n] (model messages only)
    sources: Optional[List[dict]] = None
    # AI personality that answered (None = MindAI)
    persona: Optional[str] = None


class ChatRequest(BaseModel):
    document_id: Optional[str] = None
    message: str = Field(min_length=1, max_length=8000)
    history: List[dict] = []
    use_knowledge_base: bool = False
    # Answer as one of the AI personalities (Maya, Leo, Zoe, Omar) instead of MindAI
    persona: Optional[Literal['explainer', 'skeptic', 'novice', 'devil']] = None


class ChatResponse(BaseModel):
    message: str
    chat_id: str


# AI Features Schemas
class Flashcard(BaseModel):
    front: str
    back: str


class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    correct_answer_index: int
    explanation: str
    topic: Optional[str] = None  # Short concept label used for weak-topic tracking


class StudyTask(BaseModel):
    day: int
    topic: str
    tasks: List[str]
    estimated_minutes: int


class ExamQuestion(BaseModel):
    id: int
    question: str
    marks: int
    type: Literal['short', 'long']
    answer_key: str


class ExamPaper(BaseModel):
    title: str
    total_marks: int
    duration_minutes: int
    questions: List[ExamQuestion]


# Request Schemas
class FlashcardRequest(BaseModel):
    document_id: str
    count: int = Field(default=10, ge=1, le=50)


class QuizRequest(BaseModel):
    document_id: str
    count: int = Field(default=5, ge=1, le=30)
    # Concentrate on topics the student has been getting wrong
    focus_weak_topics: bool = False


class StudyPlanRequest(BaseModel):
    document_id: str
    days: int = Field(default=5, ge=1, le=30)


class MindMapRequest(BaseModel):
    document_id: str


class ExamPaperRequest(BaseModel):
    document_id: str
    num_questions: int = Field(default=5, ge=1, le=30)
    difficulty: Literal['Easy', 'Medium', 'Hard'] = 'Medium'
    type: Literal['short', 'long', 'mixed'] = 'mixed'


# Study Set Schemas
StudySetKind = Literal['quiz', 'flashcards', 'study_plan', 'exam', 'mind_map', 'teach_back', 'audio_overview', 'study_group']
ActivityKind = Literal['quiz', 'flashcards', 'exam', 'teach_back', 'study_group']


class StudySetSummary(BaseModel):
    id: str
    document_id: str
    document_title: str
    kind: StudySetKind
    title: str
    config: dict = {}
    item_count: int
    created_at: int
    # Progress on this set (quizzes: attempts/scores; flashcards: review sessions)
    attempts: int = 0
    best_score_pct: Optional[int] = None
    last_score_pct: Optional[int] = None
    last_activity_at: Optional[int] = None


class StudySetResponse(StudySetSummary):
    data: Any


class StudySetUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class QuizAttemptRequest(BaseModel):
    # Selected option index per question (-1 = unanswered)
    answers: List[int] = Field(min_length=1, max_length=100)


class FlashcardSessionRequest(BaseModel):
    # One entry per reviewed card: True = "Got it", False = "Still learning"
    results: List[bool] = Field(min_length=1, max_length=500)


class ActivityResponse(BaseModel):
    id: str
    study_set_id: Optional[str] = None
    kind: ActivityKind
    correct: int
    total: int
    score_pct: int
    created_at: int


# Progress Schemas
class DailyActivity(BaseModel):
    date: str  # YYYY-MM-DD in the client's local time
    quizzes: int
    flashcard_sessions: int
    chat_messages: int
    tutor_sessions: int = 0  # Exam gradings and teach-back sessions
    total: int


class QuizTrendPoint(BaseModel):
    created_at: int
    score_pct: int
    document_title: str
    study_set_title: Optional[str] = None


class TopicStat(BaseModel):
    topic: str
    correct: int
    total: int
    accuracy_pct: int
    last_seen_at: int


class DocumentMastery(BaseModel):
    document_id: str
    document_title: str
    mastery_pct: Optional[int] = None  # None = not studied yet
    quiz_attempts: int
    flashcard_sessions: int
    study_sets: int
    last_studied_at: Optional[int] = None
    weak_topics: List[TopicStat] = []


class ProgressTotals(BaseModel):
    documents: int
    study_sets: int
    quizzes_taken: int
    avg_quiz_accuracy_pct: Optional[int] = None
    cards_reviewed: int
    cards_known: int
    chat_questions: int


class ProgressResponse(BaseModel):
    totals: ProgressTotals
    current_streak_days: int
    longest_streak_days: int
    studied_today: bool
    cards_due_now: int = 0
    cards_due_today: int = 0
    cards_new: int = 0
    daily_activity: List[DailyActivity]
    quiz_trend: List[QuizTrendPoint]
    mastery: List[DocumentMastery]
    recent_sets: List[StudySetSummary]
    # Motivation (optional extras)
    xp: int = 0
    level: int = 1
    level_progress_pct: int = 0
    next_level_xp: int = 100
    badges: List[dict] = []
    bank_due: int = 0
    bank_total: int = 0


# Spaced repetition Schemas
ReviewRatingValue = Literal['again', 'hard', 'good', 'easy']


class ReviewRating(BaseModel):
    card_index: int = Field(ge=0)
    rating: ReviewRatingValue


class ReviewRequest(BaseModel):
    ratings: List[ReviewRating] = Field(min_length=1, max_length=500)


class CardSchedule(BaseModel):
    card_index: int
    is_new: bool
    due_at: Optional[int] = None
    interval_days: float = 0
    ease: float = 2.5
    repetitions: int = 0
    lapses: int = 0
    last_rating: Optional[ReviewRatingValue] = None
    # Interval (days) the card would get for each rating; 0 = review again this session
    next_intervals: Dict[str, float]


class ReviewResponse(BaseModel):
    activity: ActivityResponse
    schedule: List[CardSchedule]


class DueCard(BaseModel):
    study_set_id: str
    study_set_title: str
    document_id: str
    document_title: str
    card_index: int
    front: str
    back: str
    schedule: CardSchedule


class DueQueue(BaseModel):
    due_count: int
    new_count: int
    cards: List[DueCard]


# Tutoring Schemas
class ExplainMistakeRequest(BaseModel):
    document_id: str
    question: str = Field(min_length=1, max_length=4000)
    # Multiple choice: options + indices. Any other question type: the answers as text instead.
    options: List[str] = Field(default_factory=list, max_length=8)
    correct_answer_index: int = -1
    chosen_index: int = -1
    question_type: str = Field(default="mcq", max_length=30)
    correct_answer_text: Optional[str] = Field(default=None, max_length=4000)
    student_answer_text: Optional[str] = Field(default=None, max_length=6000)
    explanation: str = ""
    history: List[dict] = []
    # A follow-up question from the student; omitted for the first explanation
    message: Optional[str] = Field(default=None, max_length=4000)
    # The saved chat this explanation continues (returned by the first answer)
    conversation_id: Optional[str] = None


class TeachBackRequest(BaseModel):
    document_id: str
    concept: str = Field(min_length=1, max_length=200)
    explanation: str = Field(min_length=20, max_length=6000)


class TeachBackFeedback(BaseModel):
    score: int
    verdict: str
    strengths: List[str]
    gaps: List[str]
    misconceptions: List[str]
    improved_explanation: str
    follow_up_question: str


class ExamAttemptRequest(BaseModel):
    answers: List[str] = Field(min_length=1, max_length=30)


class ExamQuestionGrade(BaseModel):
    id: int
    awarded_marks: float
    max_marks: int
    feedback: str
    missing_points: List[str]


class ExamGradeResponse(BaseModel):
    activity: ActivityResponse
    total_awarded: float
    total_marks: int
    score_pct: int
    questions: List[ExamQuestionGrade]
    overall_feedback: str
