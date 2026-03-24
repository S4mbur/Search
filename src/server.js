const http = require("node:http");
const { URL } = require("node:url");
const fs = require("node:fs");
const pathModule = require("node:path");

const FRONTEND_DIR = pathModule.join(__dirname, "..", "frontend");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function createServer({ crawlerService, config }) {
  return http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && requestUrl.pathname === "/health") {
        return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
      }

      if (req.method === "GET" && requestUrl.pathname === "/") {
        return serveStaticFile(res, pathModule.join(FRONTEND_DIR, "index.html"));
      }

      if (req.method === "GET" && requestUrl.pathname.startsWith("/frontend/")) {
        const relativePath = requestUrl.pathname.slice("/frontend/".length);
        const safePath = pathModule.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
        const filePath = pathModule.join(FRONTEND_DIR, safePath);
        return serveStaticFile(res, filePath);
      }

      if (req.method === "GET" && requestUrl.pathname === "/api") {
        return sendJson(res, 200, {
          service: "search-crawler-assignment",
          endpoints: [
            "POST /api/index",
            "GET /api/jobs",
            "GET /api/jobs/:jobId",
            "GET /api/jobs/:jobId/events",
            "GET /api/search?q=...",
            "GET /api/system",
            "GET /health",
          ],
        });
      }

      if (req.method === "POST" && requestUrl.pathname === "/api/index") {
        const body = await readJsonBody(req);
        const job = crawlerService.createIndexJob({
          originUrl: body.origin,
          maxDepth: Number(body.k),
          options: {
            maxConcurrency: body.maxConcurrency,
            maxQueueSize: body.maxQueueSize,
            maxRequestsPerSecond: body.maxRequestsPerSecond,
            requestTimeoutMs: body.requestTimeoutMs,
            userAgent: body.userAgent,
          },
        });

        return sendJson(res, 202, {
          job,
          statusUrl: `/api/jobs/${job.id}`,
          eventsUrl: `/api/jobs/${job.id}/events`,
        });
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/jobs") {
        const limit = Number(requestUrl.searchParams.get("limit") || 50);
        return sendJson(res, 200, {
          jobs: crawlerService.listJobs(limit),
        });
      }

      if (req.method === "GET" && requestUrl.pathname.startsWith("/api/jobs/")) {
        const parts = requestUrl.pathname.split("/").filter(Boolean);
        const jobId = parts[2];

        if (!jobId) {
          return sendJson(res, 404, { error: "Not found" });
        }

        if (parts.length === 3) {
          const job = crawlerService.getJob(jobId);
          if (!job) {
            return sendJson(res, 404, { error: "Job not found" });
          }

          return sendJson(res, 200, { job });
        }

        if (parts.length === 4 && parts[3] === "events") {
          const after = Number(requestUrl.searchParams.get("after") || 0);
          const limit = Math.min(
            Number(requestUrl.searchParams.get("limit") || 100),
            config.MAX_EVENTS_PER_RESPONSE,
          );

          return sendJson(res, 200, {
            events: crawlerService.listJobEvents(jobId, after, limit),
          });
        }
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/search") {
        const query = requestUrl.searchParams.get("q") || "";
        const limitParam = requestUrl.searchParams.get("limit");
        const limit = limitParam === null ? undefined : Number(limitParam);
        return sendJson(res, 200, crawlerService.search(query, limit));
      }

      if (req.method === "GET" && requestUrl.pathname === "/search") {
        const query = requestUrl.searchParams.get("query") || "";
        const sortBy = requestUrl.searchParams.get("sortBy") || "relevance";
        const limitParam = requestUrl.searchParams.get("limit");
        const limit = limitParam === null ? undefined : Number(limitParam);

        if (sortBy !== "relevance") {
          return sendJson(res, 400, {
            error: "Only sortBy=relevance is supported",
          });
        }

        return sendJson(res, 200, crawlerService.searchCompatibility(query, limit));
      }

      if (req.method === "GET" && requestUrl.pathname === "/api/system") {
        return sendJson(res, 200, crawlerService.getSystemStatus());
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message || "Unexpected server error",
      });
    }
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function serveStaticFile(res, filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = pathModule.join(filePath, "index.html");
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Not found");
      }
    }

    const ext = pathModule.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = fs.readFileSync(filePath);

    res.writeHead(200, {
      "content-type": contentType,
      "content-length": content.length,
      "cache-control": "no-cache",
    });
    res.end(content);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal server error");
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

module.exports = {
  createServer,
};
