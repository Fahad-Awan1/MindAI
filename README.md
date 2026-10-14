<p align="center">
  <img src="frontend/public/logo.svg" alt="MindAI" width="320" />
</p>

# MindAI - Intelligent Student Study Assistant

[![Python](https://img.shields.io/badge/Python-3.13-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.121-green.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19.2-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)

An AI-powered study companion built with **Python FastAPI** backend and **React** frontend, featuring **RAG (Retrieval Augmented Generation)** for enhanced document interactions.

## ✨ Features

- 📚 **Document Upload** - Support for PDF, DOCX, PPTX, Markdown, and Text files
- 💬 **Streaming Chat with Citations** - Answers stream in, render as Markdown, and cite the exact page/slide/section they came from ([1], [2]); click a citation to see the passage or open it in the Reader
- 🗂️ **Knowledge Base** - Query across all your documents simultaneously
- 📖 **Reader** - Read any document and highlight text to Explain, Simplify, Make a flashcard or Quiz me
- 🎯 **Adaptive Quizzes** - Topic-tagged questions, per-topic accuracy, "Focus on my weak topics", and **Explain my mistake** tutor chats
- 🎴 **Spaced-Repetition Flashcards** - SM-2 scheduling (Again/Hard/Good/Easy) and a daily review queue across all decks
- 🗣️ **Teach It Back** - Explain a concept in your own words (typed or spoken); the AI grades it and lists gaps and misconceptions
- 📝 **Exam Generator** - Formal exam papers with answer keys; take the exam and get AI marking with per-question feedback
- 📅 **Study Planner** & 🧠 **Mind Maps** - Multi-day plans and Mermaid concept maps
- 🎧 **Audio Overview** - Turn a document into a two-host podcast with a synced transcript
- 🕸️ **Concept Graph** - An interactive map of concepts across all documents, showing what they share
- 🎙️ **Voice** - Dictate questions and explanations (Whisper) and have answers read aloud
- 📈 **Progress Dashboard** - Study streaks, activity, quiz accuracy trend, mastery per document and weak topics; everything you generate is saved

- 🔐 **Accounts** - Sign up / sign in; every user's documents, chats and progress are private
- 👥 **Study Rooms** - Real-time rooms with classmates: live chat, presence and typing indicators, shared documents,
  an **@MindAI** moderator that answers the group with citations, and live **Quiz Battles** with a leaderboard

- 🎓 **AI Study Group** - A seminar with AI classmates (Maya the Explainer, Leo the Skeptic, Zoe the Curious Beginner,
  Omar the Devil's Advocate) who debate your documents with citations and pull you in; ends with a summary and feedback
  on your contributions. The same classmates can be `@mentioned` inside Study Rooms.

- 🎙️ **Lecture-to-Notes** - Upload a lecture recording (audio or video), or paste a YouTube or web-article link:
  MindAI transcribes it (Whisper; YouTube captions when available), writes timestamped notes plus an overview, and
  adds it as a document whose chat citations point to timestamps. Uses a bundled ffmpeg (no install needed).

### Studying with friends (Study Rooms)

The frontend dev server proxies the API and WebSockets, so classmates only need one address:

- **Same Wi-Fi/LAN:** start both servers as usual, then open **Study Rooms → (your room) → Invite classmates**.
  The copied link uses your computer's network address (e.g. `http://192.168.x.x:5173/join/abc12345`) even if you
  opened MindAI on `localhost`. Friends open it, create an account, and land in the room.
  If they can't connect, allow **Node.js** through Windows Firewall for your network type.
- **Friends elsewhere:** expose the frontend with a tunnel, e.g. `cloudflared tunnel --url http://localhost:5173`
  (or `ngrok http 5173`), and share `https://<tunnel-address>/join/<code>`.
  Only share links with people you trust — they can create accounts on your MindAI.

> Voice playback uses Groq's Orpheus text-to-speech when its terms have been accepted in the Groq console
> (https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english); until then MindAI uses the browser's built-in voices.

> Note: MindAI is a single-user local app. There is no login; all documents are shared by everyone who can reach the server.

## 🏗️ Tech Stack

### Backend
- **FastAPI** - Modern Python web framework
- **ChromaDB** - Vector database for RAG
- **Groq** (`openai/gpt-oss-120b`, configurable via `GROQ_MODEL`) - Large language model
- **SQLAlchemy** - SQL toolkit and ORM
- **Sentence Transformers** - Document embeddings

### Frontend
- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Axios** - HTTP client
- **Tailwind CSS** - Styling
- **Lucide Icons** - Beautiful icons

## 📋 Prerequisites

- **Python 3.13**
- **Node.js 18+**
- **Groq API Key** ([Get one here](https://console.groq.com/keys))

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd MindAI
```

### 2. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env

# Edit .env and add your Groq API key
# GROQ_API_KEY=your_api_key_here

# Run the backend server
uvicorn main:app --reload
```

Backend will run on **http://localhost:8000**

### 3. Frontend Setup

Open a new terminal:

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Run the development server
npm run dev
```

Frontend will run on **http://localhost:5173**

### 4. Open the Application

Navigate to **http://localhost:5173** in your browser.

## 📖 Usage

1. **Upload Documents** - Add PDFs, DOCX, PPTX, Markdown, or text files
2. **Chat** - Ask questions about your documents (powered by RAG)
3. **Generate Study Materials**:
   - Create flashcards for memorization
   - Generate quizzes to test knowledge
   - Build study plans for structured learning
   - Create exam papers
   - Visualize concepts with mind maps

## 🔧 API Documentation

Once the backend is running, visit:
- **API Docs**: http://localhost:8000/docs
- **Alternative Docs**: http://localhost:8000/redoc

## 🗂️ Project Structure

```
MindAI/
├── backend/
│   ├── main.py                 # FastAPI app entry point
│   ├── config.py               # Configuration settings
│   ├── database.py             # Database setup
│   ├── models.py               # SQLAlchemy models
│   ├── schemas.py              # Pydantic schemas
│   ├── routers/
│   │   ├── documents.py        # Document management
│   │   ├── chat.py             # Chat endpoints
│   │   └── ai_features.py      # AI feature endpoints
│   ├── services/
│   │   ├── document_service.py # Document processing
│   │   ├── rag_service.py      # RAG implementation
│   │   └── groq_service.py     # Groq LLM integration
│   └── requirements.txt        # Python dependencies
│
├── frontend/
│   ├── src/
│   │   ├── components/         # React components
│   │   ├── services/
│   │   │   └── api.ts          # API client
│   │   ├── types.ts            # TypeScript types
│   │   ├── App.tsx             # Main app component
│   │   └── index.tsx           # Entry point
│   ├── index.html              # HTML template
│   ├── package.json            # Node dependencies
│   └── vite.config.ts          # Vite configuration
│
└── README.md                   # This file
```

## 🔑 Environment Variables

### Backend (.env)

```env
GROQ_API_KEY=your_groq_api_key
DATABASE_URL=sqlite:///./mindai.db
UPLOAD_DIR=./uploads
CHROMA_PERSIST_DIR=./chroma_db
```

## 🧪 RAG Architecture

MindAI uses **Retrieval Augmented Generation** for accurate document-based Q&A:

1. **Document Upload** → Text extraction from PDFs, DOCX, PPTX
2. **Chunking** → Split into 500-character chunks with 50-character overlap
3. **Embedding** → Generate vectors using `all-MiniLM-L6-v2`
4. **Storage** → Store in ChromaDB vector database
5. **Query** → Generate query embeddings
6. **Retrieval** → Find top K most relevant chunks (semantic search)
7. **Generation** → Feed context to the Groq LLM for response

## 🛠️ Development

### Backend Development

```bash
cd backend
uvicorn main:app --reload --log-level debug
```

### Frontend Development

```bash
cd frontend
npm run dev
```

### Build for Production

```bash
# Frontend
cd frontend
npm run build

# Backend
cd backend
pip install gunicorn
gunicorn main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgements

- **Groq** for fast LLM inference
- **ChromaDB** for vector storage
- **FastAPI** for the amazing framework
- **React** community for excellent tooling

---

**Built with ❤️ for students worldwide**
