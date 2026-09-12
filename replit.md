# E3 HR & Employee Management System

## Overview

This is a comprehensive HR management system built with a modern tech stack, featuring a React frontend with TypeScript and an Express.js backend. The system provides complete employee lifecycle management including recruitment, onboarding, performance tracking, attendance management, document handling, and event staff coordination.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized builds
- **Styling**: Tailwind CSS with shadcn/ui components
- **State Management**: TanStack Query (React Query) for server state
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation
- **Authentication**: Context-based auth with JWT tokens

### Backend Architecture
- **Runtime**: Node.js with TypeScript (using tsx for development)
- **Framework**: Express.js with middleware for authentication and logging
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: JWT-based with refresh tokens and bcrypt password hashing
- **File Handling**: Multer for document uploads

## Key Components

### Database Layer
- **ORM**: Drizzle with type-safe queries and migrations
- **Schema**: Comprehensive schema covering all HR domains (employees, attendance, leaves, documents, events, performance, recruitment)
- **Connection**: Neon serverless PostgreSQL with connection pooling

### Authentication & Authorization
- **JWT Implementation**: Separate access and refresh tokens
- **Role-based Access Control**: Admin, HR, and employee roles with granular permissions
- **Session Management**: Secure cookie handling with automatic token refresh
- **Development Mode**: Mock authentication for easier development

### External Integrations
- **Slack Integration**: Bot token-based messaging for announcements and notifications
- **Anthropic AI**: Claude 3.7 Sonnet integration for AI-powered features
- **WPS (Wage Protection System)**: Qatar-specific payroll compliance
- **Geofencing**: Location-based attendance tracking

### Core Modules
1. **Employee Management**: Complete employee lifecycle with document management
2. **Attendance & Time Tracking**: Clock in/out with geofencing and shift management
3. **Leave Management**: Multi-type leave system with approval workflows
4. **Payroll**: WPS-compliant salary processing with allowances and deductions
5. **Event Staff Management**: Event-specific staff assignment and performance tracking
6. **Performance Management**: Reviews, goals, feedback, and skill assessments
7. **Recruitment & Onboarding**: Full hiring pipeline with structured onboarding
8. **Communications**: Announcements, notifications, and Slack integration
9. **Reporting & Analytics**: Comprehensive reports with predictive analytics

## Data Flow

### Request Flow
1. Client requests go through authentication middleware
2. Role-based authorization checks permissions
3. Route handlers use storage service for database operations
4. Responses include proper error handling and logging

### Authentication Flow
1. Login generates access token (15min) and refresh token (7 days)
2. Protected routes verify access tokens
3. Automatic token refresh on expiration
4. Secure logout clears all tokens

### File Upload Flow
1. Multer middleware handles multipart forms
2. Files stored in `/uploads` directory
3. Database stores file metadata and paths
4. Document expiry tracking with notifications

## External Dependencies

### Core Dependencies
- **Database**: @neondatabase/serverless, drizzle-orm, drizzle-kit
- **Authentication**: jsonwebtoken, bcryptjs, cookie-parser
- **File Handling**: multer for uploads
- **Validation**: zod for type-safe validation
- **UI Components**: @radix-ui/* components with shadcn/ui
- **HTTP Client**: TanStack Query for API calls

### Integration Dependencies
- **Slack**: @slack/web-api for bot integration
- **AI**: @anthropic-ai/sdk for Claude integration
- **Development**: tsx, vite, tailwindcss, typescript

### Deployment Dependencies
- **Build**: esbuild for server bundling
- **Runtime**: Node.js 20 with PostgreSQL 16
- **Platform**: Replit with autoscale deployment

## Deployment Strategy

### Development Environment
- **Hot Reload**: Vite dev server with Express backend
- **Database**: Local PostgreSQL or Neon development instance
- **Authentication**: Mock mode enabled for easier testing
- **File Storage**: Local uploads directory

### Production Environment
- **Build Process**: Vite builds client, esbuild bundles server
- **Deployment**: Replit autoscale with automatic scaling
- **Database**: Neon serverless PostgreSQL with connection pooling
- **Security**: Environment variables for sensitive data
- **Static Files**: Vite-built assets served by Express

### Environment Configuration
- **DATABASE_URL**: PostgreSQL connection string
- **JWT_SECRET**: Token signing secret
- **SLACK_BOT_TOKEN**: Slack integration token
- **ANTHROPIC_API_KEY**: AI service key
- **NODE_ENV**: Environment mode (development/production)

## User Preferences

Preferred communication style: Simple, everyday language.

## Changelog

- August 31, 2025. Successfully completed and tested comprehensive role-based authentication with signup system - Removed joining/contract date fields as requested, created simplified 10-field signup form for different employee types (temporary, permanent, contract), fixed all database schema mismatches, implemented proper error handling for duplicate emails/usernames/QIDs, resolved authentication validation issues with null lastLogin fields, verified complete signup-to-login flow works properly, and maintained role-based dashboard functionality with employee type restrictions.
- August 22, 2025. Fixed attendance clock-in/out system - resolved date handling issues, fixed UI state management, corrected API request methods. All clock functions (in/out/break) now working properly with real-time UI updates.
- June 30, 2025. Fixed authentication system - resolved database schema mismatches, created proper user accounts with bcrypt password hashes, removed mock authentication, and fixed login API integration. Login now works with admin/password123 credentials.
- June 24, 2025. Initial setup