# Smooth AI AutoBDR

## Overview
Smooth AI AutoBDR is a production-ready AI-powered Business Development Representative (BDR) application that automates lead generation, personalized email outreach, and pipeline management. Leverages multi-agent architecture with 8 autonomous agents running in parallel for prospect discovery, intelligent research, email generation with hallucination detection, and autonomous sending with SMTP rate limiting. Includes comprehensive CRM features, real-time analytics (40+ APIs), relationship intelligence, and predictive revenue forecasting.

**Current Status**: ✅ PRODUCTION READY - 8 agents operational, 162+ emails sent, 191 qualified leads, $286,500 pipeline value

## Recent Fixes (Dec 2, 2025)
- ✅ Fixed COO duplicate logging - consolidated to single unified health monitor message
- ✅ Fixed COO offline status - added heartbeat mechanism to keep COO marked as healthy
- ✅ Fixed logo-finder URL validation - now skips invalid/missing websites, successfully enriches with logos
- ✅ Removed CDN Tailwind - now uses local PostCSS build for production
- ✅ Database cleanup - removed lowercase "coo" duplicate entry, verified 8 unique agents

## User Preferences
- Iterative development approach with functional increments
- Clarification requests before major changes
- Detailed explanations for architectural decisions
- Clean, organized code structure

## System Architecture
**Tech Stack**: React 18 (TypeScript, Vite) frontend + Node.js (Express) backend + SQLite database

**Agent Architecture** (8 parallel autonomous agents + unified COO health monitoring):
1. **Prospect Finder** - Lead discovery and pipeline sourcing
2. **Research Agent** - Multi-source intelligence gathering with adaptive fallbacks
3. **Research Retry Agent** - Persistent research with fail-fast philosophy
4. **Email Generator** - AI-powered personalized outreach with hallucination detection
5. **Email Reviewer** - Quality control with min 3/10 quality threshold
6. **Email Sender** - SMTP rate limiting (250ms delay, 25/batch, 250/day limit)
7. **Inbox Agent** - IMAP sync and reply monitoring
8. **Logo Finder** - Automated company logo enrichment (Clearbit/Google/DuckDuckGo)
9. **COO Health Monitor** - Unified system health monitoring (in-process, heartbeat-managed)

**Key Features**:
- Multi-Source Intelligence Research with parallel orchestration
- Sustainable Rate Limiting respecting SMTP provider limits
- Real-time Metrics Dashboard (40+ analytics APIs, 5-second refresh)
- Persistent Research Retry System with progressive strategies
- Autonomous BDR System with scheduler for inbox/queue/reply processing
- Unified Email Configuration (single SMTP/IMAP interface)
- Full CRM with Kanban pipeline, deal management, relationship tracking
- Enterprise Analytics: deal tracking, revenue forecasting, win/loss analysis, competitor intelligence, campaign ROI, source attribution, engagement funnel, relationship mapping, opportunity scoring, pipeline velocity
- Production deployment configured for Replit autoscale

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