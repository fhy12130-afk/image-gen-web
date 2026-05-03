$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example."
  Write-Host "Edit .env and set IMAGE_API_BASE_URL and IMAGE_API_KEY before real generation."
  Write-Host ""
}

if (-not (Select-String -Path ".env" -Pattern "^DOCKER_NODE_IMAGE=" -Quiet)) {
  Add-Content -Path ".env" -Value ""
  Add-Content -Path ".env" -Value "DOCKER_NODE_IMAGE=node:20-bookworm-slim"
}

docker compose up --build -d
Write-Host "Started Image Gen Web at http://localhost:8700"
