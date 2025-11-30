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
- **Multi-Source Intelligence Research**: An iterative, multi-pass research orchestrator gathers data from 7+ parallel intelligence sources (website scraping, news RSS, press releases, executive news, careers pages) per company to generate highly personalized outreach. Research quality is scored (1-10) and only leads with a quality score >= 9 proceed to email generation.
- **Autonomous BDR System**: A server-side automation scheduler manages background jobs for inbox synchronization, email queue processing, and AI-powered reply analysis (categorizing replies as INTERESTED, NOT_INTERESTED, etc., and generating auto-responses).
- **Unified Email Configuration**: A single settings interface manages both SMTP (sending) and IMAP (receiving) email configurations, automatically deriving host settings.
- **Unified Inbox View**: Displays both sent and received emails, with filtering and linking to leads.
- **CRM Features**: Includes a full sales pipeline with a drag-and-drop Kanban board, deal management (value, probability, close date), and a detailed lead view with multiple contacts, activity timelines, and notes.
- **AI Integration**: AI calls are proxied through a server-side endpoint for security and leverage Replit AI Integrations (OpenRouter) with the `meta-llama/llama-3.3-70b-instruct` model.
- **Deployment**: Configured for Replit's autoscale production environment, serving the React build via the Express server.

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