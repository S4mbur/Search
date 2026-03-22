# Product PRD

## Product name

Search Crawler Assignment Backend

## Objective

Build a localhost-runnable crawler/search system that exposes two primary capabilities:

1. `index(origin, k)`
2. `search(query)`

The system should be intentionally scoped for a 3-5 hour implementation while still showing strong architectural judgment around scale, correctness, backpressure, and incremental search.

## Users

- evaluator/interviewer running the project locally
- developer integrating a future frontend
- operator wanting to inspect crawl progress and system load

## Functional requirements

### 1. Indexing

The system must:

- accept an `origin` URL and crawl depth `k`
- crawl up to `k` hops from the origin
- never crawl the same page twice globally
- normalize URLs before deduplication
- extract links from HTML pages
- maintain origin/depth discovery context for each indexed page
- expose crawl progress while the job is active

### 2. Search

The system must:

- accept a plain text query
- tokenize the query
- return relevant URLs already indexed
- return triples of `(relevant_url, origin_url, depth)`
- expose new matches while indexing is still ongoing

### 3. System visibility

The system must allow the operator to:

- create crawl jobs
- search indexed content
- inspect job progress
- inspect queue depth
- inspect backpressure status
- inspect recent crawl events

### 4. Durability

The system should preferably:

- survive restarts
- recover job state
- requeue interrupted in-flight work

## Non-functional requirements

- run locally
- minimal external dependencies
- single-machine design
- bounded resource consumption
- clear code structure
- easy to demo

## Architecture

### Runtime

- Node.js 22
- native `fetch`
- native `http`
- native `node:sqlite`

### Storage model

SQLite stores:

- crawl jobs
- discovered URLs
- ready queue
- pending buffer
- in-flight URLs
- indexed pages
- page search terms
- discovery contexts
- event logs

### Scheduler model

The scheduler should:

- run periodically
- apply per-job rate limiting via token buckets
- respect per-job concurrency limits
- respect queue capacity
- spill excess discovered URLs into a persistent pending buffer
- promote pending work back into the queue when capacity is available

## Search relevance definition

For this assignment, a page is relevant if one or more normalized query terms match indexed terms from the page. Ranking is based on:

1. number of matched query terms
2. summed term frequency
3. shallower discovery depth

This is intentionally simple, explainable, and easy to improve later.

## API contract

### `POST /api/index`

Input:

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

Output:

- job identifier
- current job state
- status/event URLs

### `GET /api/search?q=...`

Output:

- normalized query terms
- ranked results
- triples with origin/depth context

### `GET /api/jobs`

Output:

- recent jobs
- queue depth
- pending depth
- active fetch count
- backpressure state

### `GET /api/jobs/:jobId/events`

Output:

- append-only event log for polling-based UI updates

### `GET /api/system`

Output:

- total pages indexed
- visited URL count
- active job count
- total queue depth
- total pending depth
- recent jobs

## Edge cases

- invalid URLs
- non-HTML responses
- timeouts
- duplicate links on the same page
- same URL discovered by multiple jobs
- process interruption while URLs are in-flight

## Out of scope

- distributed crawling
- robots.txt compliance
- JavaScript rendering with a headless browser
- PageRank
- fuzzy search
- authentication
- production deployment

## Acceptance criteria

- a user can start a crawl job locally
- a user can inspect job state while crawling is active
- a user can run search before the crawl fully finishes
- the same page is not fetched twice
- queue depth is bounded and visible
- interrupted work can be resumed
- project includes README and production recommendation
