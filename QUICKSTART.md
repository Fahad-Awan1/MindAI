# 🚀 Quick Start Guide - MindAI

## ⚡ Essential Steps to Get Running

### 1. Get Your Groq API Key
Visit https://console.groq.com/keys and create a free API key.

### 2. Setup Backend

```powershell
# Open PowerShell in the MindAI directory

# Go to backend
cd backend

# Create Python virtual environment (Python 3.13)
py -3.13 -m venv venv

# Activate it (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# If you get execution policy error, run:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Install all dependencies
pip install -r requirements.txt

# Create .env file
Copy-Item .env.example .env

# IMPORTANT: Open backend/.env in a text editor and add your Groq API key:
# GROQ_API_KEY=your_actual_api_key_here
```

### 3. Setup Frontend

```powershell
# Open a NEW PowerShell window

# Go to frontend
cd frontend

# Install dependencies
npm install
```

### 4. Run the Application

**Terminal 1 (Backend):**
```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload
```
✅ Backend will run on http://localhost:8000

**Terminal 2 (Frontend):**
```powershell
cd frontend
npm run dev
```
✅ Frontend will run on http://localhost:5173

### 5. Open the App

Navigate to **http://localhost:5173** in your browser!

---

## 🎯 First Time Usage

1. **Upload** a document (PDF, DOCX, PPTX, Markdown, or text)
2. Wait for AI summary generation
3. **Chat** with your document using RAG
4. Try generating:
   - Flashcards
   - Quizzes
   - Study Plans
   - Exam Papers
   - Mind Maps

---

## ❗ Troubleshooting

### Backend Won't Start
- Check that Python 3.13 is installed: `py -3.13 --version`
- Verify virtual environment is activated (you should see `(venv)` in prompt)
- Make sure `GROQ_API_KEY` is set in `backend/.env`

### Frontend Won't Start
- Check that Node.js is installed: `node --version`
- Try deleting `node_modules` and running `npm install` again
- Make sure you're in the `frontend` directory

### API Errors
- Ensure backend is running on port 8000
- Check backend terminal for error messages
- Verify your Groq API key is valid

---

## 📚 Full Documentation

See [README.md](README.md) for complete documentation.
