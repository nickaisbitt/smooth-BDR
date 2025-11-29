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
2. Configured Vite to run on port 5000 with host 0.0.0.0 for Replit proxy compatibility
3. Added API proxy in Vite config to forward `/api/*` requests to backend (port 3000)
4. Updated backend server to explicitly bind to 0.0.0.0:3000 for production deployment compatibility
5. Enhanced .gitignore with database and environment variable patterns
6. Created workflow to run both backend and frontend concurrently
7. Configured deployment for production (autoscale mode with npm build and node server.js)

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

### Required Environment Variables
The application requires the following environment variables:
- `GEMINI_API_KEY` or `API_KEY`: Google Gemini API key for AI-powered email generation

To set up:
1. Get your Gemini API key from [Google AI Studio](https://ai.google.dev/)
2. Add it as a secret in Replit or set as environment variable

### SMTP Configuration
Email sending requires SMTP configuration provided through the UI:
- Host, Port, Username, Password
- Supports secure and non-secure connections
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
