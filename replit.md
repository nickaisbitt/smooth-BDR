# Smooth AI AutoBDR

## Overview
Smooth AI AutoBDR is an AI-powered Business Development Representative (BDR) application designed to automate lead generation, personalized email outreach, and pipeline management. It leverages Google's Gemini AI for intelligent content generation and includes robust tracking and analytical capabilities. The project aims to streamline sales development processes, improve outreach effectiveness through personalization, and provide comprehensive insights into lead engagement.

## User Preferences
I want the agent to:
- Adopt an iterative development approach, focusing on delivering functional increments.
- Ask for clarification or confirmation before implementing major changes or complex features.
- Provide detailed explanations for significant code modifications or architectural decisions.
- Maintain a clear and organized code structure, adhering to established conventions.

## System Architecture
The application features a modern full-stack architecture with a React 18 (TypeScript, Vite) frontend and a Node.js (Express) backend. Data is persisted using SQLite. The UI is built with Tailwind CSS for rapid styling and Recharts for data visualization. Key architectural decisions include:
- **Multi-Agent Architecture**: 9 parallel agents running as separate processes:
  1. **COO Agent**: System health monitor (5s polling)
  2. **Prospect Finder Agent**: Discovers and adds new prospects (3s polling, 50/batch)
  3. **Research Agent**: Multi-source research on companies (600ms polling, 15 parallel items)
  4. **Research Retry Agent**: Retry research with fail-fast strategy (1000ms polling, max 1 retry)
  5. **Email Generator Agent**: Generates personalized emails (600ms polling, 20/batch)
  6. **Email Reviewer Agent**: Quality review & hallucination detection (600ms polling)
  7. **Email Sender Agent**: Sends approved emails (800ms polling, 100/batch, 5ms delays)
  8. **Inbox Agent**: Monitors IMAP inbox for replies (5s polling)
  9. **Logo Finder Agent**: Enriches prospects with logos (60s polling, 30/batch)
- **Multi-Source Intelligence Research**: Parallel research orchestrator gathers data from 7+ sources (website scraping, Google News, press releases, executive news, careers pages, web search) with adaptive fallbacks.
- **Ultra-Aggressive Optimization**: Research quality threshold 3/10, email minimum 3/10, email sender batch 100 emails/cycle, 5ms inter-email delay = **theoretical 200 emails/sec throughput**
- **Persistent Research Retry System**: Auto-retry with progressive strategies (deep crawl, news deep search, executive search, comprehensive web) with fail-fast philosophy (1 retry max).
- **Autonomous BDR System**: Server-side automation scheduler for inbox sync, email queue processing, and AI-powered reply analysis.
- **Unified Email Configuration**: Single interface for SMTP sending and IMAP receiving with auto host derivation.
- **Unified Inbox View**: Displays sent and received emails with filtering and lead linking.
- **CRM Features**: Full sales pipeline with Kanban board, deal management (value, probability, close date), and detailed lead view.
- **AI Integration**: Server-side AI proxy using OpenRouter `meta-llama/llama-3.3-70b-instruct` model with hallucination detection.
- **Production Deployment**: Configured for Replit autoscale, serving React build via Express.

## Development Workflow
The development environment runs three parallel processes using a single workflow command:
```bash
node server.js & node agents/supervisor.js & npm run dev & wait
```
- **Express API Server** (port 3000): Backend API handling leads, emails, agents, and automation
- **Agent Supervisor**: Spawns and manages the 6 autonomous agents
- **Vite Dev Server** (port 5000): Frontend development server with hot reload

## External Dependencies
- **AI Service**: Google Gemini API (via Replit AI Integrations/OpenRouter, using `meta-llama/llama-3.3-70b-instruct`)
- **Email Services**:
    - **Nodemailer**: For sending emails via SMTP.
    - **imapflow & mailparser**: For receiving and parsing emails via IMAP.
- **Database**: SQLite (local file-based).
- **UI Libraries**:
    - **Tailwind CSS**: For styling.
    - **Recharts**: For analytics charts.
- **Web Scraping**:
    - **axios**: HTTP client.
    - **cheerio**: For parsing and manipulating HTML.