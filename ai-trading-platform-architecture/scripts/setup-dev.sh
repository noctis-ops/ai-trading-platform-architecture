#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Development setup script for Private Trading Assistant
#
# Usage:
#   bash scripts/setup-dev.sh
#
# This script:
#   1. Checks prerequisites (Node.js, PostgreSQL)
#   2. Creates .env from .env.example if it doesn't exist
#   3. Installs dependencies
#   4. Runs database migrations
#   5. Seeds default plans and symbols
#   6. Optionally starts Docker if Postgres is not running locally
# ---------------------------------------------------------------------------
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

echo "============================================"
echo "  Private Trading Assistant — Dev Setup"
echo "============================================"
echo ""

# --- Check Node.js ---
if ! command -v node &> /dev/null; then
  error "Node.js is required. Install it from https://nodejs.org"
  exit 1
fi
info "Node.js $(node --version)"

# --- Check npm ---
if ! command -v npm &> /dev/null; then
  error "npm is required."
  exit 1
fi
info "npm $(npm --version)"

# --- .env setup ---
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    info "Created .env from .env.example"
    warn "Edit .env to configure your settings:"
    warn "  - TELEGRAM_BOT_TOKEN (from @BotFather)"
    warn "  - TELEGRAM_WEBHOOK_SECRET (generate: openssl rand -hex 32)"
    warn "  - CRON_SECRET (generate: openssl rand -hex 32)"
    warn "  - OWNER_TELEGRAM_IDS (your numeric Telegram user ID)"
    echo ""
  else
    error ".env.example not found!"
    exit 1
  fi
else
  info ".env already exists"
fi

# --- Database ---
# Check if DATABASE_URL in .env is reachable
DB_URL=$(grep DATABASE_URL .env 2>/dev/null | cut -d '=' -f2- || echo "")
if [ -z "$DB_URL" ] || echo "$DB_URL" | grep -q "localhost:5432"; then
  # Check if Docker is available for local Postgres
  if command -v docker &> /dev/null; then
    if ! docker ps 2>/dev/null | grep -q "trading-db"; then
      warn "Starting PostgreSQL via Docker..."
      docker compose up -d postgres 2>/dev/null || docker-compose up -d postgres 2>/dev/null || true
      info "Waiting for PostgreSQL to be ready..."
      sleep 3
    else
      info "PostgreSQL Docker container already running"
    fi
  else
    warn "Docker not found. Make sure PostgreSQL is running and update DATABASE_URL in .env"
  fi
fi

# --- Install dependencies ---
info "Installing npm dependencies..."
npm install

# --- Database migration ---
info "Running database migrations..."
npm run db:migrate

# --- Seed data ---
info "Seeding default plans and symbols..."
npm run admin seed

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your Telegram bot token"
echo "     TELEGRAM_BOT_TOKEN=your_bot_token"
echo ""
echo "  2. Create an admin user:"
echo "     npm run admin create-admin owner@example.com 'your-strong-password'"
echo ""
echo "  3. Start the dev server:"
echo "     npm run dev"
echo ""
echo "  4. For auto-trading (paper mode):"
echo "     Set TRADING_MODE=paper in .env"
echo "     Set PAPER_TRADING_EQUITY=10000"
echo ""
echo "  5. For auto-trading (live mode):"
echo "     Set TRADING_MODE=live in .env"
echo "     Set BINANCE_API_KEY and BINANCE_API_SECRET"
echo ""
echo "  Schedule cron jobs (example with curl):"
echo "     curl -X POST http://localhost:3000/api/cron/scan \\"
echo "       -H 'Authorization: Bearer YOUR_CRON_SECRET'"
echo ""
