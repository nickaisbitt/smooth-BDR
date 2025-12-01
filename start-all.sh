#!/bin/bash

echo "🚀 Starting Smooth AI AutoBDR..."

# Start Express API Server
echo "📡 Starting API Server on port 3000..."
node server.js &
SERVER_PID=$!

# Wait for server to be ready
sleep 3

# Verify server is running
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ Server failed to start"
    exit 1
fi

echo "✅ API Server running (PID: $SERVER_PID)"

# Start Agent Supervisor
echo "🤖 Starting Agent Supervisor..."
node agents/supervisor.js &
SUPERVISOR_PID=$!
echo "✅ Supervisor running (PID: $SUPERVISOR_PID)"

# Start Vite Dev Server
echo "🎨 Starting Vite Dev Server on port 5000..."
npm run dev &
VITE_PID=$!
echo "✅ Vite running (PID: $VITE_PID)"

# Keep script running
wait
