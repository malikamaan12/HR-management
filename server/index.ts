import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

import { validateAuthConfiguration } from './services/auth';
import { validateAppConfiguration } from './config';
import { createReadinessHandler } from './services/readiness';
import { pool } from './db';
import {runOperationalReminders} from './services/operational-reminders';
import {runHelpdeskAutomation} from './services/helpdesk-automation';
import {runReportSchedules} from './services/reportWorkspace';
import {ensureInductionSafetyCourses} from './services/induction-course-library';
import {securityHeaders, privateApiResponses, sameOriginWrites, apiRateLimit, requestError} from './middleware/security';
validateAuthConfiguration();
validateAppConfiguration();
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders());
app.use('/api', privateApiResponses, sameOriginWrites, apiRateLimit);
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
const readinessQuery = { text: 'SELECT 1 FROM users LIMIT 0', query_timeout: 2000 };
app.get('/readyz', createReadinessHandler(() => pool.query(readinessQuery)));
app.use('/api/learning/induction', express.json({limit:'2mb', inflate:false}));
app.use('/api/contracts', express.json({limit:'256kb', inflate:false}));
app.use('/api/separations', express.json({limit:'256kb', inflate:false}));
app.use(express.json({limit:'100kb', inflate:false}));
app.use(express.urlencoded({ extended: false, limit:'100kb', parameterLimit:100, inflate:false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await ensureInductionSafetyCourses();
  const server = await registerRoutes(app);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  app.use(requestError);
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = Number(process.env.PORT || 5000);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
    setTimeout(() => void runHelpdeskAutomation().catch(() => console.error('Helpdesk automation failed')), 30000).unref();
    setInterval(() => void runHelpdeskAutomation().catch(() => console.error('Helpdesk automation failed')), 5 * 60 * 1000).unref();
    setTimeout(() => void runOperationalReminders().catch(() => console.error('Operational reminders failed')), 30000).unref();
    setInterval(() => void runOperationalReminders().catch(() => console.error('Operational reminders failed')), 15 * 60 * 1000).unref();
    setTimeout(() => void runReportSchedules().catch(() => console.error('Scheduled reports failed')), 45000).unref();
    setInterval(() => void runReportSchedules().catch(() => console.error('Scheduled reports failed')), 15 * 60 * 1000).unref();
  });
})();
