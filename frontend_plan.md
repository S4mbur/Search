# Frontend Plan

This document describes how the frontend should be built later so it fits the backend that already exists.

## Goal

Build a small operator-facing web UI for:

- starting crawl jobs
- searching indexed pages
- monitoring crawl/system state
- inspecting per-job event history

The UI should feel operational rather than marketing-oriented.

## Recommended stack

- React
- Vite
- TypeScript
- React Router
- TanStack Query
- plain CSS modules or a small utility layer

Avoid a heavy admin template. The UI should stay simple and fast.

## Pages

### 1. Dashboard

Purpose:

- show global system state at a glance

Widgets:

- total indexed pages
- total visited URLs
- active jobs
- total ready queue depth
- total pending depth
- total in-flight count
- recent jobs table

Polling:

- `/api/system` every 3-5 seconds

### 2. New Crawl Job

Purpose:

- allow a user to create an indexing job

Form fields:

- origin URL
- depth `k`
- max concurrency
- max queue size
- max requests per second
- request timeout

Validation:

- origin must be a valid `http(s)` URL
- depth must be integer `>= 0`
- numeric controls must be positive

Submit:

- `POST /api/index`

After success:

- redirect to job detail page

### 3. Job Detail

Purpose:

- show real-time crawl progress for a single job

Sections:

- summary card
- progress metrics
- queue/backpressure indicators
- event log stream

Summary fields:

- job ID
- origin URL
- max depth
- status
- created at
- completed at
- active fetches

Metrics fields:

- discovered count
- crawled count
- indexed page count
- skipped visited count
- duplicate discovery count
- non-HTML count
- error count
- queue high-water mark

Operational fields:

- queue count
- pending count
- in-flight count
- backpressure active
- token bucket state

Polling:

- `/api/jobs/:jobId` every 2 seconds while active
- `/api/jobs/:jobId/events?after=<lastSeenId>` every 2 seconds

Important UX detail:

- event polling should append only new records, not reload the whole log

### 4. Search

Purpose:

- search already indexed content while jobs may still be running

Layout:

- query input at top
- result count + normalized terms
- result list

Result card fields:

- page title
- relevant URL
- origin URL
- discovery depth
- excerpt
- score
- matched terms

Interaction:

- pressing Enter triggers search
- debounce input by 250-400ms only if doing live search

Request:

- `GET /api/search?q=<query>&limit=20`

Empty states:

- no query entered
- no results found
- backend unavailable

## Information architecture

Recommended route structure:

- `/`
- `/crawl/new`
- `/jobs/:jobId`
- `/search`

Recommended top navigation:

- Dashboard
- New Crawl
- Search

## Component structure

Suggested component tree:

- `AppLayout`
- `TopNav`
- `PageHeader`
- `StatCard`
- `JobTable`
- `CreateJobForm`
- `JobSummaryPanel`
- `JobMetricsGrid`
- `BackpressureBadge`
- `EventLogList`
- `SearchBar`
- `SearchResultsList`
- `SearchResultCard`
- `ApiErrorBanner`
- `LoadingState`
- `EmptyState`

## State management

Use TanStack Query for all server state.

Recommended query keys:

- `["system"]`
- `["jobs", limit]`
- `["job", jobId]`
- `["jobEvents", jobId, afterId]`
- `["search", query, limit]`

Guidance:

- keep form state local with React state
- keep server data in query cache
- do optimistic UI only for the create-job submit button, not for crawl progress

## Data flow

### Create job flow

1. user fills form
2. frontend validates input
3. frontend posts to `/api/index`
4. backend returns created job
5. frontend navigates to `/jobs/:jobId`
6. job page starts polling status and events

### Search flow

1. user enters query
2. frontend calls `/api/search`
3. backend returns ranked results
4. UI renders result cards
5. user can revisit search while indexing continues in background

### Monitoring flow

1. dashboard polls `/api/system`
2. job page polls `/api/jobs/:jobId`
3. event log uses incremental polling with `after=<lastEventId>`

## UI behavior details

- show a distinct badge when backpressure is active
- show queue count and pending count side by side
- show last update timestamp on dashboard and job detail
- disable create-job submit while request is in flight
- preserve search query in URL search params
- paginate or virtualize event logs if they grow large

## Styling direction

Keep the UI operational and intentionally technical:

- light background with strong contrast
- neutral palette with one clear accent color
- monospace for URLs and job IDs
- compact cards, visible density, no oversized hero sections
- subtle status colors:
  - green for completed
  - blue for running
  - amber for backpressure
  - red for failed/error-heavy states

## Suggested API client layer

Create a small `api.ts` wrapper with functions:

- `createJob(payload)`
- `getSystemStatus()`
- `getJobs(limit)`
- `getJob(jobId)`
- `getJobEvents(jobId, afterId)`
- `search(query, limit)`

Keep response mapping centralized there so page components stay clean.

## Suggested folder structure

```text
frontend/
  src/
    app/
      router.tsx
      queryClient.ts
    api/
      client.ts
      crawler.ts
    components/
      layout/
      dashboard/
      jobs/
      search/
      shared/
    pages/
      DashboardPage.tsx
      NewCrawlPage.tsx
      JobDetailPage.tsx
      SearchPage.tsx
    styles/
      tokens.css
      globals.css
```

## What not to do

- do not hide operational detail behind vague labels
- do not depend on websocket infrastructure unless needed
- do not build a heavy charting system first
- do not overcomplicate auth or user management for this assignment

## Nice-to-have enhancements

- copy buttons for URLs/job IDs
- small sparkline for queue/pending trend
- collapsible raw JSON inspector for debugging
- filter event log by level
- search result pagination
