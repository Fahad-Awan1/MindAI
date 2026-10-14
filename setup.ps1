# Check if virtual environment exists
if (-Not (Test-Path "backend\venv")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Green
    python -m venv backend\venv
}

# Install backend dependencies into the virtual environment
Write-Host "`nInstalling Backend Dependencies..." -ForegroundColor Green
& backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# Create .env file if it doesn't exist
if (-Not (Test-Path "backend\.env")) {
    Write-Host "`nCreating backend .env file..." -ForegroundColor Yellow
    Copy-Item backend\.env.example backend\.env
    Write-Host "Please edit backend\.env and add your GROQ_API_KEY" -ForegroundColor Red
}

# Install frontend dependencies
Write-Host "`nInstalling Frontend Dependencies..." -ForegroundColor Green
Push-Location frontend
npm install
Pop-Location

Write-Host "`n✓ Setup completed successfully!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Edit backend\.env and add your GROQ_API_KEY"
Write-Host "2. Start the backend:  cd backend; .\venv\Scripts\python.exe -m uvicorn main:app --reload"
Write-Host "3. Start the frontend: cd frontend; npm run dev"
Write-Host "4. Open http://localhost:5173 in your browser"
