import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { connectToMongoDB } from "./mongo";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    // Connect to MongoDB (non-blocking)
    connectToMongoDB()
      .then(() => log("✅ MongoDB connected successfully"))
      .catch((err) => {
        log(`❌ MongoDB connection error: ${err?.message || "Unknown error"}`);
        console.error("MongoDB connection failed:", err);
      });

    // Register routes and get HTTP server
    const server = await registerRoutes(app);

    // Error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
      throw err;
    });

    // Dev/Prod handling of static and Vite
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Choose proper host and port
    const isProduction = process.env.NODE_ENV === "production";
    const PORT = process.env.PORT || 3004;

    server.listen(
      PORT,
      () => {
        log(`🚀 Server running on http://${isProduction ? "0.0.0.0" : "localhost"}:${PORT}`);
      }
    );
  } catch (error: any) {
    log(`❌ Server initialization error: ${error?.message || "Unknown error"}`);
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();
