@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo Image Gen Web one-click startup
echo ========================================
echo.

if not exist ".env" (
  echo No .env found. Creating one from .env.example...
  copy ".env.example" ".env" >nul
  echo.
  echo Please edit .env and set IMAGE_API_BASE_URL and IMAGE_API_KEY before real generation.
  echo The website can still start now.
  echo.
)

echo Installing dependencies with npx pnpm@9.15.4 install ...
call npx pnpm@9.15.4 install
if errorlevel 1 (
  echo.
  echo Dependency installation failed.
  pause
  exit /b 1
)

echo.
echo Starting API and Web servers...
echo Web: http://localhost:5173
echo API: http://localhost:8787
echo.
echo Keep this window open while using the website.
echo Press Ctrl+C to stop.
echo.

call npx pnpm@9.15.4 dev
pause
