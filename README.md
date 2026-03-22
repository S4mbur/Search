# Search Crawler Assignment

This project implements the backend and CLI for the web crawler/search assignment. It is intentionally built with low dependency surface area and mostly language-native features:

- `Node.js 22`
- native `fetch`
- native `http`
- native `node:sqlite`
- filesystem-local persistence in `data/crawler.sqlite`

The system supports:

- `index(origin, k)` style crawl jobs
- global deduplication so the same page is not crawled twice
- bounded queue depth and per-job rate limiting for backpressure
- live search while indexing is still active
- job/system status inspection
- resume after interruption by recovering in-flight work

## Architecture

The system is a single-process backend with three main pieces:

1. `CrawlerService`
   - owns the scheduler
   - enforces concurrency and per-job rate limits
   - performs HTML fetch, link extraction, normalization, and indexing

2. `SQLite store`
   - persists jobs, queue, pending buffer, in-flight URLs, indexed pages, search terms, and crawl events
   - lets search read newly indexed pages immediately
   - allows interrupted jobs to resume without starting from scratch

3. `HTTP API + CLI`
   - backend API for future frontend integration
   - local CLI for demoing the assignment without a UI

## Why search works during indexing

Each fetched HTML page is written to SQLite immediately together with its term frequencies and `(relevant_url, origin_url, depth)` discovery context. Search reads directly from this persisted incremental index, so newly discovered results become visible as soon as each page finishes processing. No end-of-job batch step is required.

## How backpressure works

Each job has:

- `maxConcurrency`
- `maxRequestsPerSecond`
- `maxQueueSize`

When newly discovered URLs would push the active queue past `maxQueueSize`, they are moved into a persistent `pending` buffer instead of the ready queue. The scheduler periodically promotes buffered URLs back into the queue as capacity opens up. This prevents runaway memory growth while preserving completeness.

## Project structure

- `src/app.js`: app entrypoint
- `src/server.js`: HTTP API
- `src/cli.js`: CLI commands
- `src/crawler/CrawlerService.js`: scheduler, crawling, indexing
- `src/db.js`: SQLite schema and persistence helpers
- `src/utils/*`: URL, HTML, tokenization helpers
- `test/*`: utility and integration tests
- `product_prd.md`: PRD for AI-assisted implementation
- `recommendation.md`: production next-step recommendations
- `frontend_plan.md`: detailed frontend implementation guide

## Requirements

- Node.js `22+`

No external packages are required.

## Run locally

```bash
npm start
```

The API starts on:

```text
http://127.0.0.1:3000
```

## CLI usage

Start the server:

```bash
node src/cli.js server
```

Create a crawl job:

```bash
node src/cli.js index https://example.com 2 --maxConcurrency 4 --maxQueueSize 200 --maxRequestsPerSecond 2
```

List jobs:

```bash
node src/cli.js jobs
```

View system status:

```bash
node src/cli.js status
```

View a job:

```bash
node src/cli.js status <jobId>
```

View job events:

```bash
node src/cli.js events <jobId>
```

Search:

```bash
node src/cli.js search crawler pipeline
```

## HTTP API

### `POST /api/index`

Request:

```json
{
  "origin": "https://example.com",
  "k": 2,
  "maxConcurrency": 4,
  "maxQueueSize": 200,
  "maxRequestsPerSecond": 2,
  "requestTimeoutMs": 10000
}
```

### `GET /api/jobs`

Returns recent jobs and their current progress.

### `GET /api/jobs/:jobId`

Returns full status for a single crawl job.

### `GET /api/jobs/:jobId/events?after=0`

Returns append-only event logs for long polling or incremental UI updates.

### `GET /api/search?q=query`

Returns relevant triples:

```json
{
  "relevantUrl": "https://example.com/docs",
  "originUrl": "https://example.com",
  "depth": 1
}
```

Additional fields such as `score`, `title`, and `excerpt` are included for UI convenience.

By default, search returns all currently relevant matches. An optional `limit` query param can be supplied by the frontend later if needed.

### `GET /api/system`

Returns global counts and recent jobs, including queue depth and backpressure state.

## Resume behavior

If the process stops while pages are in-flight, those URLs are kept in persistent storage and re-queued when the service starts again. Already indexed pages and discovery metadata are not lost.

## Tests

```bash
npm test
```

The test suite covers:

- URL normalization
- HTML parsing
- tokenization
- integration flow for indexing, search, backpressure, and indexed-page reuse across jobs

## Reasonable assumptions

- only `http(s)` URLs are crawled
- only `text/html` responses are indexed
- relevancy is based on simple term-frequency matching
- robots.txt, sitemap support, and advanced ranking are out of scope for this assignment version
