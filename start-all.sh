#!/bin/bash
# Kill any existing processes
pkill -f "node server.js" || true
pkill -f "node agents/supervisor.js" || true
pkill -f "npm run dev" || true
sleep 1

# Start processes
node server.js & 
node agents/supervisor.js & 
npm run dev & 
wait
