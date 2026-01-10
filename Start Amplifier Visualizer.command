#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Amplifier Audio Visualizer..."
echo "🚀 Launching application and opening browser..."
echo ""
./launcher.js &
sleep 3
open http://localhost:8080 2>/dev/null || echo "Please open your browser to http://localhost:8080"
wait
