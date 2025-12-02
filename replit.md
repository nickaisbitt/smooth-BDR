# Smooth AI AutoBDR

## Overview
Smooth AI AutoBDR is an AI-powered Business Development Representative (BDR) application designed to automate lead generation, personalized email outreach, and pipeline management. It leverages AI for intelligent content generation and includes robust tracking and analytical capabilities. The project aims to streamline sales development processes, improve outreach effectiveness through personalization, and provide comprehensive insights into lead engagement, ultimately enhancing sales efficiency and revenue growth.

## User Preferences
I want the agent to:
- Adopt an iterative development approach, focusing on delivering functional increments.
- Ask for clarification or confirmation before implementing major changes or complex features.
- Provide detailed explanations for significant code modifications or architectural decisions.
- Maintain a clear and organized code structure, adhering to established conventions.

## System Architecture
The application features a modern full-stack architecture with a React 18 (TypeScript, Vite) frontend and a Node.js (Express) backend. Data is persisted using SQLite. The UI is built with Tailwind CSS for rapid styling and Recharts for data visualization. Key architectural decisions include:
- **Multi-Agent Architecture**: A system of 9 parallel autonomous agents (including a supervisor with merged COO functionality) for tasks like prospect finding, research, email generation, review, sending, inbox monitoring, and logo enrichment.
- **Multi-Source Intelligence Research**: A parallel orchestrator gathers data from multiple sources with adaptive fallbacks for comprehensive prospect insights.
- **Sustainable Rate Limiting**: Implemented across email generation and sending to ensure compliance with SMTP provider limits and graceful retry mechanisms.
- **Real-time Metrics Dashboard**: Provides live pipeline data, queue depths, research quality, and approval rates with a 5-second auto-refresh.
- **Persistent Research Retry System**: Automated retry mechanisms with progressive strategies and a fail-fast philosophy.
- **Autonomous BDR System**: Server-side automation scheduler for key processes like inbox sync, email queue processing, and AI-powered reply analysis.
- **Unified Email Configuration**: A single interface for SMTP sending and IMAP receiving.
- **Unified Inbox View**: Displays all email communications with filtering and lead linking.
- **CRM Features**: Full sales pipeline with Kanban board, deal management (value, probability, close date), and detailed lead view.
- **AI Integration**: Utilizes a server-side AI proxy for content generation and hallucination detection.
- **Production Deployment**: Configured for Replit autoscale, serving the React build via Express.
- **Enterprise Analytics & Business Intelligence**: Over 40 APIs for comprehensive insights including deal tracking, revenue forecasting, win/loss analysis, competitor intelligence, campaign ROI, source attribution, engagement funnel, meeting effectiveness, relationship mapping, opportunity scoring, pipeline velocity, and performance metrics.
- **Meeting & Call Tracking**: Functionality to schedule, log, and track meeting outcomes and conversion effectiveness.
- **Relationship Intelligence**: Tools to map prospect networks, identify buying committees, and track relationship strength.
- **Predictive Analytics**: Features for opportunity scoring, close date predictions, deal probability weighting, and revenue forecasting.
- **Pipeline Intelligence**: Velocity tracking, bottleneck detection, stage conversion rates, and stuck deal alerts.

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