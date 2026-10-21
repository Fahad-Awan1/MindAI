from sqlalchemy import Column, Integer, String, Text, ForeignKey, BigInteger, Boolean, Float
from sqlalchemy.orm import relationship
from database import Base


class User(Base):
    """
    A MindAI account. Each user's documents, chats, study sets and progress are private.

    Attributes:
        id: Unique string ID.
        email: Login email (stored lower-case, unique).
        name: Display name.
        password_hash: bcrypt hash of the password.
        avatar_color: Colour for the avatar initials.
        created_at: Timestamp (ms).
        email_verified: Whether the email address was confirmed.
        google_sub: Google account ID (Google sign-in).
        token_version: Login tokens from before the last password change carry an older number.
    """
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    avatar_color = Column(String, nullable=False, default="#6366f1")
    created_at = Column(BigInteger, nullable=False)
    # Sign-in can't happen until the email is confirmed with a code (or comes from Google)
    email_verified = Column(Boolean, nullable=False, default=False)
    # Google account ID when the user signs in with Google
    google_sub = Column(String, nullable=True, index=True)
    # Bumped on a password change/reset: tokens carrying an older version stop working
    token_version = Column(Integer, nullable=False, default=0)

class Document(Base):
    """
    Database model representing a document uploaded by the user.
    
    Attributes:
        id: Unique string ID.
        title: Original filename.
        content: Extracted text content from the file.
        file_path: Local path where the file is stored.
        mime_type: File MIME type (e.g., application/pdf).
        type: File classification (e.g., pdf, text).
        created_at: Timestamp of creation.
        summary: AI-generated summary of the document.
        chat_messages: Relationship to ChatMessage model.
    """
    __tablename__ = "documents"
    
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)  # Owner
    title = Column(String, nullable=False)
    content = Column(Text, nullable=True)  # Extracted text content
    file_path = Column(String, nullable=True)  # Path to local storage
    mime_type = Column(String, nullable=True)
    type = Column(String, default="text")
    created_at = Column(BigInteger, nullable=False)
    summary = Column(Text, nullable=True)
    
    # Relationships
    chat_messages = relationship("ChatMessage", back_populates="document", cascade="all, delete-orphan")
    study_sets = relationship("StudySet", back_populates="document", cascade="all, delete-orphan")
    activities = relationship("StudyActivity", back_populates="document", cascade="all, delete-orphan")
    concept_map = relationship("ConceptMap", back_populates="document", uselist=False, cascade="all, delete-orphan")
    # Unshared from every room when the document is deleted
    room_shares = relationship("RoomDocument", back_populates="document", cascade="all, delete-orphan")
    # Chats about this one document go with it; it is taken out of every project
    conversations = relationship("Conversation", back_populates="document", cascade="all, delete-orphan")
    project_links = relationship("ProjectDocument", back_populates="document", cascade="all, delete-orphan")


class ChatMessage(Base):
    """
    Database model representing a single message in a chat history.
    
    Attributes:
        id: Unique string ID.
        document_id: Foreign key to the related Document (optional).
        role: Sender role ('user' or 'model').
        text: Content of the message.
        timestamp: Time of message.
        is_knowledge_base: Boolean flag if the chat is global (KB) or document-specific.
        document: Relationship to Document model.
    """
    __tablename__ = "chat_messages"
    
    id = Column(String, primary_key=True, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)  # Owner (needed for knowledge-base chats)
    role = Column(String, nullable=False)  # user, model
    text = Column(Text, nullable=False)
    timestamp = Column(BigInteger, nullable=False)
    persona = Column(String, nullable=True)  # AI personality that wrote a model reply (None = MindAI)
    is_knowledge_base = Column(Boolean, default=False)  # True if knowledge base chat
    sources = Column(Text, nullable=True)  # JSON list of cited source passages (model messages)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=True, index=True)  # The chat it belongs to

    # Relationships
    document = relationship("Document", back_populates="chat_messages")
    conversation = relationship("Conversation", back_populates="messages")


class StudySet(Base):
    """
    A saved piece of generated study material (quiz, flashcard deck, study plan, exam or mind map).

    Attributes:
        id: Unique string ID.
        document_id: The document it was generated from.
        kind: 'quiz' | 'flashcards' | 'study_plan' | 'exam' | 'mind_map'.
        title: Display name (editable).
        data: JSON-encoded generated content.
        config: JSON-encoded generation settings (count, days, difficulty, ...).
        created_at: Timestamp of creation (ms).
    """
    __tablename__ = "study_sets"

    id = Column(String, primary_key=True, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)  # Owner
    kind = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    data = Column(Text, nullable=False)
    config = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False)

    # Relationships
    document = relationship("Document", back_populates="study_sets")
    activities = relationship("StudyActivity", back_populates="study_set", cascade="all, delete-orphan")
    card_states = relationship("CardState", back_populates="study_set", cascade="all, delete-orphan")
    exam_attempts = relationship("ExamAttempt", back_populates="study_set", cascade="all, delete-orphan")


class StudyActivity(Base):
    """
    A completed study action used for progress tracking.

    Attributes:
        id: Unique string ID.
        document_id: The document studied.
        study_set_id: The study set used (if any).
        kind: 'quiz' (a submitted quiz attempt) | 'flashcards' (a review session).
        correct: Correct answers / cards marked as known.
        total: Questions answered / cards reviewed.
        details: JSON-encoded extra data (e.g. the submitted answers).
        created_at: Timestamp (ms).
    """
    __tablename__ = "study_activities"

    id = Column(String, primary_key=True, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    study_set_id = Column(String, ForeignKey("study_sets.id"), nullable=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)  # Owner
    kind = Column(String, nullable=False)
    correct = Column(Integer, nullable=False, default=0)
    total = Column(Integer, nullable=False, default=0)
    details = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False, index=True)

    # Relationships
    document = relationship("Document", back_populates="activities")
    study_set = relationship("StudySet", back_populates="activities")


class CardState(Base):
    """
    Spaced-repetition (SM-2) schedule for one flashcard in a deck.

    Attributes:
        id: Unique string ID.
        study_set_id: The flashcard deck.
        document_id: The document the deck came from.
        card_index: Position of the card within the deck's data.
        ease: SM-2 ease factor (>= 1.3, starts at 2.5).
        interval_days: Current interval between reviews.
        repetitions: Consecutive successful reviews.
        lapses: Times the card was forgotten ("Again").
        due_at: When the card is next due (ms).
        last_reviewed_at: Last review time (ms).
        last_rating: 'again' | 'hard' | 'good' | 'easy'.
    """
    __tablename__ = "card_states"

    id = Column(String, primary_key=True, index=True)
    study_set_id = Column(String, ForeignKey("study_sets.id"), nullable=False, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    card_index = Column(Integer, nullable=False)
    ease = Column(Float, nullable=False, default=2.5)
    interval_days = Column(Float, nullable=False, default=0)
    repetitions = Column(Integer, nullable=False, default=0)
    lapses = Column(Integer, nullable=False, default=0)
    due_at = Column(BigInteger, nullable=False, index=True)
    last_reviewed_at = Column(BigInteger, nullable=True)
    last_rating = Column(String, nullable=True)

    study_set = relationship("StudySet", back_populates="card_states")


class ConceptMap(Base):
    """
    Key concepts and their relationships extracted from one document (for the concept graph).

    Attributes:
        document_id: The document (one map per document).
        content_hash: Hash of the document text the map was built from (rebuilt when it changes).
        data: JSON {"concepts": [{name, description}], "relations": [{source, target, label}]}.
        created_at: Timestamp (ms).
    """
    __tablename__ = "concept_maps"

    document_id = Column(String, ForeignKey("documents.id"), primary_key=True)
    content_hash = Column(String, nullable=False)
    data = Column(Text, nullable=False)
    created_at = Column(BigInteger, nullable=False)

    document = relationship("Document", back_populates="concept_map")


class Room(Base):
    """
    A study room: members chat in real time, share documents, ask the AI moderator and play quiz battles.

    Attributes:
        id: Unique string ID.
        name: Room name.
        invite_code: Short code used in invite links (/join/<code>).
        owner_id: The user who created the room.
        created_at: Timestamp (ms).
    """
    __tablename__ = "rooms"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    invite_code = Column(String, nullable=False, unique=True, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(BigInteger, nullable=False)

    members = relationship("RoomMember", back_populates="room", cascade="all, delete-orphan")
    documents = relationship("RoomDocument", back_populates="room", cascade="all, delete-orphan")
    messages = relationship("RoomMessage", back_populates="room", cascade="all, delete-orphan")


class RoomMember(Base):
    """Membership of a user in a room (role: 'owner' or 'member')."""
    __tablename__ = "room_members"

    id = Column(String, primary_key=True, index=True)
    room_id = Column(String, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String, nullable=False, default="member")
    joined_at = Column(BigInteger, nullable=False)

    room = relationship("Room", back_populates="members")
    user = relationship("User")


class RoomDocument(Base):
    """A member's document shared into a room (the AI moderator and quizzes use these)."""
    __tablename__ = "room_documents"

    id = Column(String, primary_key=True, index=True)
    room_id = Column(String, ForeignKey("rooms.id"), nullable=False, index=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    shared_by = Column(String, ForeignKey("users.id"), nullable=False)
    shared_at = Column(BigInteger, nullable=False)

    room = relationship("Room", back_populates="documents")
    document = relationship("Document", back_populates="room_shares")
    sharer = relationship("User")


class RoomMessage(Base):
    """
    A message in a room's timeline.

    kind: 'user' (member message), 'ai' (moderator answer), 'system' (joins, shares, ...),
          'quiz' (quiz battle results).
    """
    __tablename__ = "room_messages"

    id = Column(String, primary_key=True, index=True)
    room_id = Column(String, ForeignKey("rooms.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    kind = Column(String, nullable=False, default="user")
    text = Column(Text, nullable=False)
    sources = Column(Text, nullable=True)  # JSON list (AI answers)
    data = Column(Text, nullable=True)     # JSON (quiz results, ...)
    created_at = Column(BigInteger, nullable=False, index=True)

    room = relationship("Room", back_populates="messages")
    user = relationship("User")


class ImportJob(Base):
    """
    A lecture recording, YouTube video or web article being turned into a document.

    status: 'queued' | 'running' | 'done' | 'failed'; `stage` and `progress` (0-100) describe
    what is happening for the progress card in the UI.
    """
    __tablename__ = "import_jobs"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String, nullable=False)       # 'media' | 'youtube' | 'web'
    source = Column(String, nullable=False)     # File name or URL
    title = Column(String, nullable=True)
    status = Column(String, nullable=False, default="queued")
    stage = Column(String, nullable=True)
    progress = Column(Integer, nullable=False, default=0)
    document_id = Column(String, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False, index=True)
    updated_at = Column(BigInteger, nullable=False)


class ExamAttempt(Base):
    """
    One sitting of an exam paper: answers are autosaved while the clock runs, then marked.

    Attributes:
        status: 'in_progress' | 'graded'.
        answers: JSON {question_id: answer} (text, or an option index for objective questions).
        started_at / deadline_at: the timed window (ms); submissions after the deadline use the last autosave.
        grading: JSON {question_id: {awarded_marks, max_marks, feedback, missing_points, points}}.
        report: JSON summary (by section, topic, thinking level, grade, readiness, next steps).
        remarks: JSON list of re-mark requests and their outcome.
    """
    __tablename__ = "exam_attempts"

    id = Column(String, primary_key=True, index=True)
    study_set_id = Column(String, ForeignKey("study_sets.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String, nullable=False, default="in_progress")
    answers = Column(Text, nullable=False, default="{}")
    started_at = Column(BigInteger, nullable=False)
    deadline_at = Column(BigInteger, nullable=True)
    submitted_at = Column(BigInteger, nullable=True)
    time_spent_ms = Column(BigInteger, nullable=True)
    late = Column(Boolean, nullable=False, default=False)
    grading = Column(Text, nullable=True)
    report = Column(Text, nullable=True)
    remarks = Column(Text, nullable=True)
    total_awarded = Column(Float, nullable=True)
    total_marks = Column(Float, nullable=True)
    activity_id = Column(String, nullable=True)

    study_set = relationship("StudySet", back_populates="exam_attempts")


class QuestionBankItem(Base):
    """
    Every quiz/exam question a student has generated, with how they've done on it.

    Feeds topic mastery (quizzes, exams and room battles alike), instant quizzes with no AI call,
    and spaced re-testing of questions they got wrong.
    """
    __tablename__ = "question_bank"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    document_id = Column(String, nullable=False, index=True)
    study_set_id = Column(String, nullable=True, index=True)
    qid = Column(String, nullable=True)
    type = Column(String, nullable=False, default="mcq")
    topic = Column(String, nullable=False, default="General")
    bloom = Column(String, nullable=True)
    difficulty = Column(String, nullable=True)
    stem_hash = Column(String, nullable=False, index=True)
    question = Column(Text, nullable=False)
    source = Column(String, nullable=False, default="quiz")  # quiz | exam | battle
    times_seen = Column(Integer, nullable=False, default=0)
    times_correct = Column(Integer, nullable=False, default=0)
    score_sum = Column(Float, nullable=False, default=0.0)
    last_seen_at = Column(BigInteger, nullable=True)
    last_correct = Column(Boolean, nullable=True)
    srs_due_at = Column(BigInteger, nullable=True, index=True)
    srs_interval_days = Column(Float, nullable=False, default=0.0)
    srs_ease = Column(Float, nullable=False, default=2.5)
    created_at = Column(BigInteger, nullable=False)


class RoomChallenge(Base):
    """A quiz shared to a study room as an asynchronous challenge (a frozen copy of its questions)."""
    __tablename__ = "room_challenges"

    id = Column(String, primary_key=True, index=True)
    room_id = Column(String, ForeignKey("rooms.id"), nullable=False, index=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    questions = Column(Text, nullable=False)
    time_limit_s = Column(Integer, nullable=True)
    created_at = Column(BigInteger, nullable=False)


class ChallengeAttempt(Base):
    __tablename__ = "challenge_attempts"

    id = Column(String, primary_key=True, index=True)
    challenge_id = Column(String, ForeignKey("room_challenges.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    score = Column(Float, nullable=False)
    total = Column(Integer, nullable=False)
    duration_ms = Column(BigInteger, nullable=False, default=0)
    results = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False)


class EmailCode(Base):
    """
    A one-time 6-digit code emailed to a user, to confirm the address ("verify") or reset the password ("reset").

    Only a hash of the code is stored. A code expires after 15 minutes, works once, and is burned after too many wrong tries.
    """
    __tablename__ = "email_codes"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    purpose = Column(String, nullable=False)
    code_hash = Column(String, nullable=False)
    expires_at = Column(BigInteger, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(BigInteger, nullable=False)
    used_at = Column(BigInteger, nullable=True)


class Project(Base):
    """
    A workspace like a ChatGPT / Claude project: its own documents, standing instructions for the AI, and chats.

    A document can belong to several projects (ProjectDocument); deleting a project deletes its chats, not its documents.
    """
    __tablename__ = "projects"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    instructions = Column(Text, nullable=True)  # Added to the AI's system prompt in every chat of the project
    color = Column(String, nullable=True)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)

    document_links = relationship("ProjectDocument", back_populates="project", cascade="all, delete-orphan")
    conversations = relationship("Conversation", back_populates="project", cascade="all, delete-orphan")


class ProjectDocument(Base):
    """A document added to a project's knowledge."""
    __tablename__ = "project_documents"

    project_id = Column(String, ForeignKey("projects.id"), primary_key=True)
    document_id = Column(String, ForeignKey("documents.id"), primary_key=True)
    added_at = Column(BigInteger, nullable=False)

    project = relationship("Project", back_populates="document_links")
    document = relationship("Document", back_populates="project_links")


class Conversation(Base):
    """
    One chat thread in the history list.

    scope says what the AI answers from:
        "document"  one document (document_id)
        "all"       every document the user has
        "project"   the project's documents and instructions (project_id)
    """
    __tablename__ = "conversations"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    scope = Column(String, nullable=False, default="document")
    document_id = Column(String, ForeignKey("documents.id"), nullable=True, index=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=True, index=True)
    title = Column(String, nullable=False, default="New chat")
    title_is_auto = Column(Boolean, nullable=False, default=True)  # False once the user renames it
    pinned = Column(Boolean, nullable=False, default=False)
    persona = Column(String, nullable=True)  # Who answered last (kept when the chat is reopened)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False, index=True)

    document = relationship("Document", back_populates="conversations")
    project = relationship("Project", back_populates="conversations")
    messages = relationship("ChatMessage", back_populates="conversation", cascade="all, delete-orphan",
                            order_by="ChatMessage.timestamp")
