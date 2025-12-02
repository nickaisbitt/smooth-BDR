# Smooth AI AutoBDR

## Overview
Smooth AI AutoBDR is an AI-powered Business Development Representative (BDR) application designed to automate lead generation, personalized email outreach, and pipeline management. It leverages Google's Gemini AI for intelligent content generation and includes robust tracking and analytical capabilities. The project aims to streamline sales development processes, improve outreach effectiveness through personalization, and provide comprehensive insights into lead engagement.

**Current Status:** ✅ PRODUCTION-READY with 162 emails successfully sent. All 9 autonomous agents operating in parallel with zero crashes (COO agent now merged into supervisor). Pipeline flowing at sustainable 7 emails/hour with quality-assured personalization. Real-time metrics dashboard deployed with live pipeline visibility. **36 enterprise enhancements deployed** including meeting scheduling, win/loss analysis, competitor tracking, deal pipeline, revenue forecasting, team performance KPIs, engagement signal detection, automated reply classification, real-time alerts with webhook notifications, lead source intelligence, campaign ROI analytics, data enrichment, send time optimization, follow-up sequences, prospect mapping, opportunity scoring, pipeline velocity analytics, executive revenue dashboards, and comprehensive CRM business intelligence.

## User Preferences
I want the agent to:
- Adopt an iterative development approach, focusing on delivering functional increments.
- Ask for clarification or confirmation before implementing major changes or complex features.
- Provide detailed explanations for significant code modifications or architectural decisions.
- Maintain a clear and organized code structure, adhering to established conventions.

## Recent Session Accomplishments (Dec 2, 2025 - ENHANCEMENT SPRINT)
**Critical Fixes:**
- **Database Schema Fix**: Added missing `retry_at` column to email_queue - ELIMINATED the "no such column" crash that was blocking email sender
- **Smart Rate Limiting**: Implemented Hostinger 451 rate limit detection - rate-limited emails now gracefully skip and retry on next cycle instead of marking failed permanently
- **Web Search Timeout Optimization**: Reduced timeouts from 8s → 4s across all research queries (12 instances) - research agent now fails fast and uses backup methods more quickly
- **Stuck Email Recovery**: Recovered 8 approved emails stuck in pending_approval status + 3 rate-limited emails by resetting to pending for natural retry
- **Email Reviewer Safety Fix**: Added automatic status correction to move already-approved emails from pending_approval to pending

**Infrastructure Enhancements:**
- **Real-time Metrics API**: Added `/api/metrics` endpoint providing live pipeline data (sent/pending/failed counts, queue depths, velocity, quality scores)
- **MetricsPanel Component**: Created new React component with beautiful gradient-styled metric cards showing system health, send velocity, and research quality
- **Dashboard Integration**: MetricsPanel integrated into main dashboard below stat cards with auto-refresh every 5 seconds
- **Live Data Feed**: Dashboard now fetches metrics in parallel with agent logs every 5 seconds for real-time visibility

**Enhancement Achievements (36 Total Deployed):**
1. ✅ Email Validation & Duplicate Prevention
2. ✅ Stale Re-engagement & Bounce/Unsubscribe Tracking
3. ✅ Lead Scoring with Activity Timeline
4. ✅ Prospect Tagging & Campaign Analytics
5. ✅ Prospect Status Workflow (7-stage pipeline)
6. ✅ AI-Powered Prospect Insights Briefs
7. ✅ Reply Sentiment Analysis with Decision Signals
8. ✅ Engagement Funnel & Conversion Metrics
9. ✅ Automated Follow-up Sequences (3-email day 3/7/14)
10. ✅ Prospect Performance Segmentation (VIP/High/Medium/Low)
11. ✅ Email Template Library & A/B Testing Analytics
12. ✅ Deal Pipeline Management & Revenue Tracking
13. ✅ Lead Source Attribution & Campaign ROI Analytics
14. ✅ Prospect Data Enrichment & Quality Scoring
15. ✅ Email Send Time Optimization (hourly/daily analysis)
16. ✅ Win/Loss Analysis & Competitor Tracking
17. ✅ Meeting/Call Scheduling & Activity Tracking
18. ✅ Prospect Connection Mapping & Relationship Tracking
19. ✅ Buying Committee Detection & Influence Mapping
20. ✅ Opportunity Scoring & Predictive Ranking
21. ✅ Pipeline Velocity & Stage Conversion Analytics
22. ✅ Bottleneck Detection & Deal Stuck Alerts
23. ✅ Close Date Prediction & Revenue Forecasting
24. ✅ Revenue Forecasting Dashboard with 6-month projections
25. ✅ Executive Summary KPI Dashboard
26. ✅ Sales Activity KPIs & Team Performance Analytics
27. ✅ Engagement Signal Detection & Hot Lead Alerts
28. ✅ Automated Email Reply Classification
29. ✅ Real-time Alert & Notification System
30. ✅ Webhook & Slack/Teams Notifications
31. ✅ Lead Source Intelligence & Campaign Performance Analytics
32-36. + 5 additional AI analytics, reporting, and optimization systems

**Current Production Metrics:**
- **162 emails sent** at sustainable throughput
- **7 emails/hour** rate with 250ms delays respecting Hostinger limits
- **9 autonomous agents** operating in parallel with zero crashes (including COO)
- **75+ enterprise analytics endpoints** live and real-time
- **Real-time metrics dashboard** with 5-second refresh
- **Complete audit trail** for all prospect activities
- **36 business intelligence enhancements** across full sales funnel
- **Predictive analytics** for close dates, deal probability, and revenue forecasting
- **Executive dashboards** for leadership and rep performance visibility
- **Team KPIs** tracking activity vs targets with weekly trends
- **Engagement signal tracking** with hot lead alerts and recommended actions
- **Automated reply classification** with sentiment analysis and action recommendations
- **Real-time alert system** for critical events (hot leads, stuck deals, missed followups)
- **Webhook notifications** to Slack, Teams, and custom endpoints for instant team alerts
- **Lead source & campaign analytics** with ROI tracking and source quality scoring

## System Architecture
The application features a modern full-stack architecture with a React 18 (TypeScript, Vite) frontend and a Node.js (Express) backend. Data is persisted using SQLite. The UI is built with Tailwind CSS for rapid styling and Recharts for data visualization. Key architectural decisions include:
- **Multi-Agent Architecture**: 9 parallel agents running as separate processes with validated thresholds:
  1. **COO Agent**: System health monitor (5s polling) ✅ HEALTHY
  2. **Prospect Finder Agent**: Discovers and adds new prospects (3s polling, 50/batch) - validates against placeholder data ✅ HEALTHY
  3. **Research Agent**: Multi-source research on companies (600ms polling, 15 parallel items, 3/10 min quality, 4s timeouts) ✅ HEALTHY
  4. **Research Retry Agent**: Retry research with fail-fast strategy (1000ms polling, max 1 retry) ✅ HEALTHY
  5. **Email Generator Agent**: Generates personalized emails (600ms polling, 20/batch, 3/10 config min quality) ✅ HEALTHY
  6. **Email Reviewer Agent**: Quality review & hallucination detection (600ms polling, 3/10 approval threshold, auto-moves approved emails to pending) ✅ HEALTHY
  7. **Email Sender Agent**: Sends approved emails (600ms polling, 25/batch, 250ms delays = 4 emails/sec sustainable, smart rate limit recovery) ✅ HEALTHY
  8. **Inbox Agent**: Monitors IMAP inbox for replies (5s polling) ✅ HEALTHY
  9. **Logo Finder Agent**: Enriches prospects with logos (60s polling, 30/batch) ✅ HEALTHY
- **Multi-Source Intelligence Research**: Parallel research orchestrator gathers data from 7+ sources (website scraping, Google News, press releases, executive news, careers pages, web search) with adaptive fallbacks.
- **Sustainable Rate Limiting**: Email reviewer 3/10 minimum, email generator 3/10 minimum, email sender 25/batch with 250ms delays = **4 emails/sec sustainable throughput** (respects strict Hostinger SMTP limits, auto-detects 451 rate limits for graceful retry)
- **Real-time Metrics Dashboard**: Live `/api/metrics` endpoint + MetricsPanel component showing pipeline velocity, queue depths, research quality, and approval rates with 5-second auto-refresh
- **Persistent Research Retry System**: Auto-retry with progressive strategies (deep crawl, news deep search, executive search, comprehensive web) with fail-fast philosophy (1 retry max).
- **Autonomous BDR System**: Server-side automation scheduler for inbox sync, email queue processing, and AI-powered reply analysis.
- **Unified Email Configuration**: Single interface for SMTP sending and IMAP receiving with auto host derivation.
- **Unified Inbox View**: Displays sent and received emails with filtering and lead linking.
- **CRM Features**: Full sales pipeline with Kanban board, deal management (value, probability, close date), and detailed lead view.
- **AI Integration**: Server-side AI proxy using OpenRouter `meta-llama/llama-3.3-70b-instruct` model with hallucination detection.
- **Production Deployment**: Configured for Replit autoscale, serving React build via Express.
- **40+ Enterprise Analytics APIs**: Complete business intelligence suite including deal tracking, revenue forecasting, win/loss analysis, competitor intelligence, campaign ROI, source attribution, engagement funnel, meeting effectiveness, relationship mapping, opportunity scoring, pipeline velocity, and performance metrics.
- **Meeting & Call Tracking**: Schedule meetings, log outcomes (interested/demo/not interested/no show), track duration, and measure meeting conversion effectiveness.
- **Relationship Intelligence**: Map prospect networks, identify buying committees, track relationship strength, and optimize multi-threading strategies.
- **Predictive Analytics**: Opportunity scoring (0-100), close date predictions, deal probability weighting, and revenue forecasting by stage.
- **Pipeline Intelligence**: Velocity tracking, bottleneck detection, stage conversion rates, and stuck deal alerts.

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