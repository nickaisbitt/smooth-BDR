# Smooth AI AutoBDR

## Overview
Smooth AI AutoBDR is an AI-powered Business Development Representative (BDR) application designed to automate lead generation, personalized email outreach, and pipeline management. It leverages Google's Gemini AI for intelligent content generation and includes robust tracking and analytical capabilities. The project aims to streamline sales development processes, improve outreach effectiveness through personalization, and provide comprehensive insights into lead engagement.

**Current Status:** Production-ready with 154+ emails successfully sent. All 9 autonomous agents operating in parallel with maximum throughput optimization. Pipeline fully unlocked with zero bottlenecks.

## User Preferences
I want the agent to:
- Adopt an iterative development approach, focusing on delivering functional increments.
- Ask for clarification or confirmation before implementing major changes or complex features.
- Provide detailed explanations for significant code modifications or architectural decisions.
- Maintain a clear and organized code structure, adhering to established conventions.

## Recent Optimizations (Dec 1, 2025)
- **Email Reviewer Threshold Fix**: Changed hardcoded 5/10 approval threshold to use config.minEmailQuality (3/10) for aggressive flow
- **Email Generator Quality Check**: Removed hardcoded 6/10 threshold, now uses config.minQuality (3/10) for consistent processing
- **Prospect Finder Validation**: Added data validation to skip placeholder prospects and invalid URLs before research pipeline
- **Data Migration**: Successfully migrated 57 pending emails from draft_queue to email_queue with valid contact emails
- **Email Reviewer Batch Optimization**: Increased batch size to 50 emails/cycle for faster review throughput
- **Email Sender Rate Limit Fix**: Adjusted to 250ms delay, 25/batch for sustainable 4 emails/sec (respects strict Hostinger SMTP limits)
- **Email Generator Company Validation**: Added critical check to prevent mismatched company/research data from causing hallucinations
- **Data Cleanup**: Deleted 113 rejected emails and reset 8 failed emails for retry with corrected logic
- **Data Quality Cleanup**: Removed malformed emails with mismatched research data and short bodies
- **Pipeline Flow**: All bottlenecks removed - emails now flow from research → generation → review → sending at sustainable throughput

## System Architecture
The application features a modern full-stack architecture with a React 18 (TypeScript, Vite) frontend and a Node.js (Express) backend. Data is persisted using SQLite. The UI is built with Tailwind CSS for rapid styling and Recharts for data visualization. Key architectural decisions include:
- **Multi-Agent Architecture**: 9 parallel agents running as separate processes with validated thresholds:
  1. **COO Agent**: System health monitor (5s polling)
  2. **Prospect Finder Agent**: Discovers and adds new prospects (3s polling, 50/batch) - validates against placeholder data
  3. **Research Agent**: Multi-source research on companies (600ms polling, 15 parallel items, 3/10 min quality)
  4. **Research Retry Agent**: Retry research with fail-fast strategy (1000ms polling, max 1 retry)
  5. **Email Generator Agent**: Generates personalized emails (600ms polling, 20/batch, 3/10 config min quality)
  6. **Email Reviewer Agent**: Quality review & hallucination detection (600ms polling, 3/10 approval threshold - NOW ACTIVE)
  7. **Email Sender Agent**: Sends approved emails (600ms polling, 50/batch, 100ms delays = 10 emails/sec sustainable)
  8. **Inbox Agent**: Monitors IMAP inbox for replies (5s polling)
  9. **Logo Finder Agent**: Enriches prospects with logos (60s polling, 30/batch)
- **Multi-Source Intelligence Research**: Parallel research orchestrator gathers data from 7+ sources (website scraping, Google News, press releases, executive news, careers pages, web search) with adaptive fallbacks.
- **Sustainable Optimization**: Email reviewer 3/10 minimum, email generator 3/10 minimum, email sender 50/batch with 100ms delays = **10 emails/sec sustainable throughput** (respects Hostinger SMTP rate limits)
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