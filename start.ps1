$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "========================================"
Write-Host "Image Gen Web one-click startup"
Write-Host "========================================"
Write-Host ""

if (-not (Test-Path ".env")) {
  Write-Host "No .env found. Creating one from .env.example..."
  Copy-Item ".env.example" ".env"
  Write-Host ""
  Write-Host "Please edit .env and set IMAGE_API_BASE_URL and IMAGE_API_KEY before real generation."
  Write-Host "The website can still start now."
  Write-Host ""
}

Write-Host "Installing dependencies with npx pnpm@9.15.4 install ..."
npx pnpm@9.15.4 install

Write-Host ""
Write-Host "Starting API and Web servers..."
Write-Host "Web: http://localhost:5173"
Write-Host "API: http://localhost:8700"
Write-Host ""
Write-Host "Keep this window open while using the website. Press Ctrl+C to stop."
Write-Host ""

npx pnpm@9.15.4 dev
