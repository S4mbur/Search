const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

module.exports = {
  DATA_DIR,
  DB_PATH: process.env.DB_PATH || path.join(DATA_DIR, "crawler.sqlite"),
  STORAGE_DIR: process.env.STORAGE_DIR || path.join(DATA_DIR, "storage"),
  HOST: process.env.HOST || "127.0.0.1",
  PORT: Number(process.env.PORT || 3600),
  DEFAULT_MAX_CONCURRENCY: Number(process.env.DEFAULT_MAX_CONCURRENCY || 4),
  DEFAULT_MAX_QUEUE_SIZE: Number(process.env.DEFAULT_MAX_QUEUE_SIZE || 200),
  DEFAULT_MAX_REQUESTS_PER_SECOND: Number(
    process.env.DEFAULT_MAX_REQUESTS_PER_SECOND || 2,
  ),
  DEFAULT_REQUEST_TIMEOUT_MS: Number(
    process.env.DEFAULT_REQUEST_TIMEOUT_MS || 10000,
  ),
  DEFAULT_USER_AGENT:
    process.env.DEFAULT_USER_AGENT ||
    "SearchCrawlerAssignment/1.0 (+http://localhost)",
  SCHEDULER_INTERVAL_MS: Number(process.env.SCHEDULER_INTERVAL_MS || 200),
  MAX_EVENTS_PER_RESPONSE: Number(process.env.MAX_EVENTS_PER_RESPONSE || 200),
  MAX_SEARCH_RESULTS: Number(process.env.MAX_SEARCH_RESULTS || 100),
};
