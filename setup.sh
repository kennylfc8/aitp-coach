#!/bin/bash

# Setup script for AI Tennis Coach

echo "🎾 AI Tennis Coach - Setup"
echo "========================="

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3.11+"
    exit 1
fi

echo "✓ Python found: $(python3 --version)"

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv
source venv/bin/activate || . venv\Scripts\activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Create .env from template
if [ ! -f ".env" ]; then
    echo "Creating .env file..."
    cp .env.example .env
    echo "⚠️  Please edit .env with your tokens:"
    echo "   - TELEGRAM_BOT_TOKEN"
    echo "   - ANTHROPIC_API_KEY"
fi

# Create data directory
mkdir -p data/players

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your API tokens"
echo "2. Run: python -m src.main"
echo ""
