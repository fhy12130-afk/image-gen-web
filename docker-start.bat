@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example.
  echo Edit .env and set IMAGE_API_BASE_URL and IMAGE_API_KEY before real generation.
  echo.
)

findstr /b /c:"DOCKER_NODE_IMAGE=" ".env" >nul
if errorlevel 1 (
  echo.>> ".env"
  echo DOCKER_NODE_IMAGE=node:20-bookworm-slim>> ".env"
)

docker compose up --build -d
echo Started Image Gen Web at http://localhost:8700
pause
