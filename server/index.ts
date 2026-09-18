import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

import { validateAuthConfiguration } from './services/auth';
import { validateAppConfiguration } from './config';
import { createReadinessHandler } from './services/readiness';
import { pool } from './db';
import {runOperationalReminders} from './services/operational-reminders';
import {runHelpdeskAutomation} from './services/helpdesk-automation';
import {ensureInductionSafetyCourses} from './services/induction-course-library';
validateAuthConfiguration();
validateAppConfiguration();
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
const readinessQuery = { text: 'SELECT 1 FROM users LIMIT 0', query_timeout: 2000 };
app.get('/readyz', createReadinessHandler(() => pool.query(readinessQuery)));
app.use('/api/learning/induction', express.json({limit:'2mb'}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = status >= 500 ? "Internal Server Error" : err.message;

    res.status(status).json({ message });
    if (status >= 500) console.error("Request failed", { status });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

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
  });
})();
