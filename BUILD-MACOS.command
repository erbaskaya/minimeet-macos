#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "MiniMeet Manager macOS DMG derleniyor..."
npm install
npm run dmg:unsigned
echo
echo "Tamamlandi: dist-macos klasorunu kontrol edin."
read -n 1 -s -r -p "Kapatmak icin bir tusa basin..."
