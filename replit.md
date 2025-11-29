# Smooth AI AutoBDR

## Overview
This is an AI-powered Business Development Representative (BDR) application that automates lead generation, email outreach, and tracking. The application uses Google's Gemini AI for intelligent email generation and includes a comprehensive pipeline management system.

**Status**: Fully configured and running in Replit environment

**Original Source**: Imported from GitHub - AI Studio app

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Node.js + Express
- **Database**: SQLite (local file-based)
- **UI Framework**: Tailwind CSS
- **AI Service**: Google Gemini API
- **Email Service**: Nodemailer (SMTP)
- **Charts**: Recharts

## Project Structure
```
.
├── components/          # React components
│   ├── AgentTerminal.tsx
│   ├── AnalyticsView.tsx
│   ├── CalendarView.tsx
│   ├── LeadCard.tsx
│   ├── PipelineBoard.tsx
│   └── ...
├── services/           # Business logic and integrations
│   ├── emailService.ts
│   ├── geminiService.ts
│   ├── googleSheetsService.ts
│   └── ...
├── App.tsx            # Main React application
├── server.js          # Express backend server
├── vite.config.ts     # Vite configuration
├── package.json       # Dependencies
└── README.md          # Original documentation
```

## Recent Changes (Nov 29, 2025)
### Replit Environment Setup
1. Installed Node.js 20 and all npm dependencies
2. Configured Vite to run on port 5000 with host 0.0.0.0 and `allowedHosts: true` for Replit proxy compatibility
3. Added API proxy in Vite config to forward `/api/*` requests to backend (port 3000)
4. Updated backend server to explicitly bind to 0.0.0.0:3000 for production deployment compatibility
5. Enhanced .gitignore with database and environment variable patterns
6. Created workflow to run both backend and frontend concurrently
7. Configured deployment for production (autoscale mode with npm build and node server.js)

### AI Integration Migration
8. Installed Replit AI Integrations (OpenRouter) - no personal API key needed, usage billed to Replit credits
9. Refactored AI service architecture: moved AI calls from client-side to server-side by creating `/api/ai/chat` endpoint for security
10. Updated `geminiService.ts` to call backend API instead of using OpenAI SDK directly in browser

### IMAP Inbox Feature (Email Reading)
11. Added IMAP email reading capability to receive and view incoming emails
12. Created `imapService.js` backend service using imapflow and mailparser libraries
13. Built Inbox view with email list, filters (All/Unread/Linked/Unlinked), and email detail pane
14. Auto-links incoming emails to existing leads by matching sender email addresses
15. Added database tables: `email_messages` and `imap_settings`

### Unified Email Configuration
16. Merged SMTP and IMAP settings into single "Email Configuration" section in Settings
17. Same credentials (username/password) work for both sending and receiving
18. Smart host derivation: enters `hostinger.com` or `smtp.hostinger.com` -> auto-derives `imap.hostinger.com` for inbox
19. Created unified `EmailConfig` type in types.ts with backwards-compatible aliases
20. Single "Save Config" button saves both SMTP and IMAP settings
21. Separate "Test Send" and "Test Inbox" buttons to verify both directions work

### Bug Fixes
22. Fixed InboxView crash when emails have missing from/to fields (null safety checks added)
23. Fixed email field mapping in API - properly returns `from`, `to`, `date` instead of raw database field names
24. Added IMAP connection timeout handling (15s timeout) for more reliable connections

### Autonomous BDR System (Full Automation)
25. Created `automationService.js` - Server-side automation scheduler with background jobs
26. Added automation database tables: `automation_state`, `email_queue`, `reply_analysis`, `automation_logs`
27. Implemented server-side scheduler that runs every 1-5 minutes for:
    - Automatic inbox sync (every 5 minutes)
    - Email queue processing (every 1 minute)
    - Reply analysis (every 2 minutes)
28. Added AI-powered reply categorization (INTERESTED, NOT_INTERESTED, QUESTION, OUT_OF_OFFICE, BOUNCE, REFERRAL)
29. Added auto-response generation for positive replies and questions
30. Integrated auto-queue: When Growth Engine qualifies a lead, first email automatically queues for sending
31. Created System Status dashboard (`SystemStatusView.tsx`) with:
    - Real-time automation status (running/paused)
    - Daily email quota tracking (sent today / limit)
    - Email queue management (pending, sent, failed)
    - Reply analysis summary
    - Activity logs
    - Quick action buttons (Send Now, Analyze Replies, Retry Failed)
32. Added 15+ automation API endpoints for full control:
    - `/api/automation/status` - Get stats
    - `/api/automation/toggle` - Enable/disable automation
    - `/api/automation/queue-email` - Queue emails
    - `/api/automation/send-queued` - Trigger sending
    - `/api/automation/process-replies` - Analyze replies
    - And more...

## Configuration

### Development Environment
- **Frontend**: Runs on port 5000 (0.0.0.0) - accessible from browser
- **Backend API**: Runs on port 3000 (0.0.0.0) - accepts connections on all interfaces
  - In dev mode, Vite proxies `/api/*` requests from frontend to backend
- **Database**: SQLite file at `./smooth_ai.db`
- **Workflow**: Both servers run together via `node server.js & npm run dev`

### Production Environment (Deployment)
- **Mode**: Autoscale (stateless, scales with traffic)
- **Build Command**: `npm run build` (compiles TypeScript and builds React app)
- **Run Command**: `node server.js` (serves API and static frontend)
- **Server Binding**: 0.0.0.0 on port from `PORT` env variable (defaults to 3000)
- **Static Files**: Serves built React app from `./dist/` directory
- **External Port**: Port 80 (Replit automatically maps to internal port 5000 in dev, port 3000 in production)

### AI Integration (Replit AI Integrations)
The application uses **Replit AI Integrations** for AI-powered features:
- **No API key needed** - Uses Replit's built-in OpenRouter integration
- **Billed to Replit credits** - Usage charges go to your Replit account
- **Model**: meta-llama/llama-3.3-70b-instruct (via OpenRouter)

The following environment variables are automatically set by Replit:
- `AI_INTEGRATIONS_OPENROUTER_BASE_URL`: API endpoint
- `AI_INTEGRATIONS_OPENROUTER_API_KEY`: Authentication token

### Email Configuration (Unified SMTP + IMAP)
Email sending and receiving uses a single unified configuration in Settings:
- **Host**: Enter any variant (smtp.hostinger.com, imap.hostinger.com, or just hostinger.com) - automatically derives correct hosts for each protocol
- **Username/Password**: Same credentials for both sending (SMTP) and receiving (IMAP)
- **SMTP**: Uses port 465 with TLS for sending
- **IMAP**: Uses port 993 with TLS for receiving
- **Test Send**: Sends a test email to verify outgoing works
- **Test Inbox**: Connects to IMAP to verify incoming works
- Includes rate limiting (60 requests per minute per IP)

## Features
- **Lead Management**: Add, track, and manage leads through multiple stages
- **AI Email Generation**: Uses Gemini AI to generate personalized outreach emails
- **Email Tracking**: Tracks email opens via pixel tracking
- **Pipeline Visualization**: Kanban-style board and table views
- **Analytics Dashboard**: Email performance metrics and charts
- **Quality Control**: Monitor and review AI-generated content
- **Calendar View**: Schedule and track activities
- **LinkedIn Integration**: Link and track LinkedIn profiles

### CRM Features (New)
- **Deals Pipeline**: Full sales pipeline with drag-and-drop Kanban board
  - Stages: Qualified → Contacted → Meeting Scheduled → Proposal Sent → Negotiation → Won/Lost
  - Revenue forecasting with weighted pipeline value
  - Monthly won/lost tracking
- **Deal Management**: Track deal value, probability, expected close date
- **Lead Detail View**: Slide-out panel for viewing/editing leads with:
  - Deal information (value, probability, close date, industry, company size)
  - Multiple contacts with roles (add/edit/delete contacts)
  - Activity timeline (calls, meetings, emails, notes, tasks)
  - Notes history
- **Revenue Tracking**: Won/Lost status with actual revenue and reason tracking

## Development

### Running Locally
The application is already running via the Replit workflow. To restart:
1. Use the "Run" button in Replit
2. Or manually run: `node server.js & npm run dev`

### Making Changes
- Frontend code hot-reloads automatically with Vite HMR
- Backend changes require workflow restart
- Database schema is auto-initialized on server start

### Building for Production
```bash
npm run build
```
This compiles TypeScript and builds the React app to `./dist/`

## Deployment
Configured to deploy on Replit with:
- **Build**: `npm run build`
- **Run**: `node server.js`
- **Mode**: Autoscale (stateless, scales with traffic)

In production, the Express server serves the built React app from the `dist/` directory and provides API endpoints.

## API Endpoints
- `POST /api/send-email`: Send email via SMTP with tracking
- `GET /api/track/open/:leadId`: Tracking pixel endpoint (returns 1x1 GIF)
- `GET /api/track/status`: Poll for email open events
- `POST /api/ai/chat`: AI chat completion (uses Replit AI Integrations/OpenRouter)

## Database Schema
SQLite tables:
- `email_logs`: Records of sent emails (lead_id, to_email, subject, sent_at)
- `tracking_events`: Email tracking events (lead_id, type, timestamp)

## User Preferences
None specified yet.

## Known Issues / Limitations
- Uses local SQLite database (not suitable for multi-instance deployments)
- Email tracking requires public URL to be configured in SMTP settings
- No authentication/authorization system implemented

## Next Steps / Potential Improvements
- Add user authentication
- Migrate to PostgreSQL for production scalability
- Implement LinkedIn OAuth integration
- Add Google Sheets API integration for lead import/export
- Enhanced error handling and logging
- Email template library
