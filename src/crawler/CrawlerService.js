const { randomUUID } = require("node:crypto");
const { extractLinks, extractTitle, htmlToText } = require("../utils/html");
const { normalizeUrl } = require("../utils/normalize-url");
const { tokenize, termFrequency } = require("../utils/tokenize");

class CrawlerService {
  constructor({
    db,
    config,
    fetchImpl = global.fetch,
    compatibilityStorage = null,
  }) {
    this.db = db;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.compatibilityStorage = compatibilityStorage;
    this.schedulerHandle = null;
    this.schedulerBusy = false;
    this.isStopping = false;
    this.roundRobinIndex = 0;
    this.inFlightUrls = new Set();
    this.activeTasks = new Map();
    this.activePerJob = new Map();
    this.jobLocks = new Map();
    this.rateBuckets = new Map();
  }

  async start() {
    if (this.schedulerHandle) {
      return;
    }

    this.resumeActiveJobs();
    this.rebuildCompatibilityStorage();
    this.schedulerHandle = setInterval(
      () => void this.runScheduler(),
      this.config.SCHEDULER_INTERVAL_MS,
    );
  }

  async stop() {
    this.isStopping = true;

    if (this.schedulerHandle) {
      clearInterval(this.schedulerHandle);
      this.schedulerHandle = null;
    }

    await Promise.allSettled([...this.activeTasks.values()]);
  }

  createIndexJob({ originUrl, maxDepth, options = {} }) {
    const normalizedOrigin = normalizeUrl(originUrl);
    if (!normalizedOrigin) {
      throw new Error("origin must be a valid http(s) URL");
    }

    if (!Number.isInteger(maxDepth) || maxDepth < 0) {
      throw new Error("k must be a non-negative integer");
    }

    const now = this.now();
    const job = {
      id: `job_${Date.now()}_${randomUUID().slice(0, 8)}`,
      originUrl: normalizedOrigin,
      maxDepth,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      lastError: null,
      config: this.buildJobConfig(options),
      metrics: this.buildInitialMetrics(now),
    };

    this.db.withTransaction(() => {
      this.db.createJob(job);
      this.db.registerDiscoveredUrl(job.id, job.originUrl, 0, null, now);
      this.db.enqueue(job.id, job.originUrl, 0, null, "queue", now);
      this.db.appendEvent(job.id, "info", "Job created", {
        originUrl: job.originUrl,
        maxDepth: job.maxDepth,
        config: job.config,
      });
    });

    job.metrics.discoveredCount = 1;
    job.metrics.queuedCount = 1;
    job.metrics.queueHighWaterMark = 1;
    job.updatedAt = this.now();
    this.db.saveJob(job);
    this.rateBuckets.set(job.id, {
      tokens: job.config.maxRequestsPerSecond,
      lastRefillAt: Date.now(),
    });

    return this.getJob(job.id);
  }

  getJob(jobId) {
    const job = this.db.getJob(jobId);
    if (!job) {
      return null;
    }

    return this.decorateJob(job);
  }

  listJobs(limit = 50) {
    return this.db.listJobs(limit).map((job) => this.decorateJob(job));
  }

  listJobEvents(jobId, afterId = 0, limit = 100) {
    return this.db.listEvents(jobId, afterId, limit);
  }

  search(query, limit) {
    const terms = [...new Set(tokenize(query))];
    let safeLimit;
    if (limit !== undefined && limit !== null && `${limit}` !== "") {
      safeLimit = Math.min(
        Math.max(Number(limit) || 1, 1),
        this.config.MAX_SEARCH_RESULTS,
      );
    }

    const results = this.db.search(terms, safeLimit);

    return {
      query,
      terms,
      total: results.length,
      results,
    };
  }

  searchCompatibility(query, limit) {
    const normalized = String(query || "").trim().toLowerCase();
    const safeLimit =
      limit !== undefined && limit !== null && `${limit}` !== ""
        ? Math.min(Math.max(Number(limit) || 1, 1), this.config.MAX_SEARCH_RESULTS)
        : undefined;
    const results = this.db.searchCompatibility(normalized, safeLimit);

    return {
      query: normalized,
      sortBy: "relevance",
      total: results.length,
      results: results.map((result) => ({
        url: result.url,
        origin_url: result.originUrl,
        depth: result.depth,
        frequency: result.frequency,
        relevance_score: result.relevanceScore,
      })),
    };
  }

  getSystemStatus() {
    return {
      ...this.db.getSystemStatus(),
      inMemory: {
        activeTasks: this.activeTasks.size,
        activeUrls: this.inFlightUrls.size,
      },
      jobs: this.listJobs(20),
    };
  }

  async waitForJobCompletion(jobId, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = this.getJob(jobId);
      if (!job) {
        throw new Error(`Unknown job: ${jobId}`);
      }

      if (["completed", "failed"].includes(job.status)) {
        return job;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Timed out waiting for job ${jobId}`);
  }

  resumeActiveJobs() {
    const jobs = this.db.listActiveJobs();
    for (const job of jobs) {
      this.rateBuckets.set(job.id, {
        tokens: job.config.maxRequestsPerSecond,
        lastRefillAt: Date.now(),
      });

      const requeued = this.db.requeueInflightItems(job.id);
      if (requeued > 0) {
        this.db.appendEvent(job.id, "info", "Recovered in-flight URLs after restart", {
          requeued,
        });
      }

      const counts = this.db.getQueueCounts(job.id);
      if (counts.queueCount === 0 && counts.pendingCount === 0 && counts.inflightCount === 0) {
        job.status = "completed";
        job.completedAt = this.now();
        job.updatedAt = this.now();
        job.metrics.finishedAt = job.completedAt;
        this.db.saveJob(job);
      } else {
        this.db.appendEvent(job.id, "info", "Job resumed by service startup");
      }
    }
  }

  async runScheduler() {
    if (this.schedulerBusy || this.isStopping) {
      return;
    }

    this.schedulerBusy = true;
    try {
      const jobs = this.db.listActiveJobs();

      for (const job of jobs) {
        this.rebalancePendingQueue(job);
      }

      while (true) {
        const nextJob = this.pickNextJob(this.db.listActiveJobs());
        if (!nextJob) {
          break;
        }

        const dispatchStartedAt = this.now();
        const item = this.db.popNextQueuedItemToInflight(nextJob.id, dispatchStartedAt);
        if (!item) {
          break;
        }

        this.consumeToken(nextJob);
        this.activePerJob.set(
          nextJob.id,
          (this.activePerJob.get(nextJob.id) || 0) + 1,
        );

        const taskKey = `${nextJob.id}:${item.url}`;
        const task = this.processQueueItem(nextJob.id, item)
          .catch((error) => {
            this.db.appendEvent(nextJob.id, "error", "Unhandled queue item failure", {
              url: item.url,
              error: error.message,
            });
          })
          .finally(async () => {
            this.activePerJob.set(
              nextJob.id,
              Math.max(0, (this.activePerJob.get(nextJob.id) || 1) - 1),
            );
            this.activeTasks.delete(taskKey);
            await this.finalizeJobIfIdle(nextJob.id);
          });

        this.activeTasks.set(taskKey, task);
      }
    } finally {
      this.schedulerBusy = false;
    }
  }

  pickNextJob(jobs) {
    if (jobs.length === 0 || this.activeTasks.size >= this.config.DEFAULT_MAX_CONCURRENCY) {
      return null;
    }

    const eligible = jobs.filter((job) => {
      const decorated = this.decorateJob(job);
      return decorated.queueCount > 0 && this.canDispatch(decorated);
    });

    if (eligible.length === 0) {
      return null;
    }

    const selected = eligible[this.roundRobinIndex % eligible.length];
    this.roundRobinIndex += 1;
    return selected;
  }

  canDispatch(job) {
    const activeForJob = this.activePerJob.get(job.id) || 0;
    if (activeForJob >= job.config.maxConcurrency) {
      return false;
    }

    this.refillBucket(job);
    const bucket = this.rateBuckets.get(job.id);
    return bucket && bucket.tokens >= 1;
  }

  refillBucket(job) {
    const now = Date.now();
    const bucket = this.rateBuckets.get(job.id) || {
      tokens: job.config.maxRequestsPerSecond,
      lastRefillAt: now,
    };
    const elapsedSeconds = (now - bucket.lastRefillAt) / 1000;

    bucket.tokens = Math.min(
      job.config.maxRequestsPerSecond,
      bucket.tokens + elapsedSeconds * job.config.maxRequestsPerSecond,
    );
    bucket.lastRefillAt = now;
    this.rateBuckets.set(job.id, bucket);
  }

  consumeToken(job) {
    const bucket = this.rateBuckets.get(job.id);
    if (!bucket) {
      return;
    }

    bucket.tokens = Math.max(0, bucket.tokens - 1);
  }

  rebalancePendingQueue(job) {
    const counts = this.db.getQueueCounts(job.id);
    const availableCapacity = Math.max(0, job.config.maxQueueSize - counts.queueCount);
    if (availableCapacity <= 0 || counts.pendingCount === 0) {
      return;
    }

    const moved = this.db.promotePendingToQueue(job.id, availableCapacity);
    if (moved > 0) {
      this.db.appendEvent(job.id, "info", "Moved URLs from pending buffer back to queue", {
        moved,
      });
    }
  }

  async processQueueItem(jobId, item) {
    const job = this.db.getJob(jobId);
    if (!job) {
      return;
    }

    if (job.status === "queued") {
      job.status = "running";
      job.updatedAt = this.now();
      this.db.saveJob(job);
    }

    if (this.inFlightUrls.has(item.url)) {
      this.db.clearInflightItem(jobId, item.url);
      this.deferUrl(job, item, "URL already being fetched by another worker");
      return;
    }

    if (this.db.hasVisited(item.url)) {
      this.db.clearInflightItem(jobId, item.url);
      await this.handlePreviouslyVisited(job, item);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), job.config.requestTimeoutMs);
    const fetchedAt = this.now();

    this.inFlightUrls.add(item.url);

    try {
      const response = await this.fetchImpl(item.url, {
        signal: controller.signal,
        headers: {
          "user-agent": job.config.userAgent,
          accept: "text/html,application/xhtml+xml",
        },
      });

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const activityAt = this.now();

      if (!response.ok) {
        this.db.markVisited(item.url, jobId, fetchedAt);
        await this.mutateJob(jobId, (latest) => {
          latest.lastError = `Fetch failed for ${item.url} with status ${response.status}`;
          latest.metrics.errorCount += 1;
          latest.metrics.processedCount += 1;
          latest.metrics.lastActivityAt = activityAt;
          latest.updatedAt = this.now();
        });
        this.db.appendEvent(jobId, "warn", "Fetch failed", {
          url: item.url,
          statusCode: response.status,
        });
        return;
      }

      if (!contentType.includes("text/html")) {
        this.db.markVisited(item.url, jobId, fetchedAt);
        await this.mutateJob(jobId, (latest) => {
          latest.metrics.nonHtmlCount += 1;
          latest.metrics.processedCount += 1;
          latest.metrics.lastActivityAt = activityAt;
          latest.updatedAt = this.now();
        });
        this.db.appendEvent(jobId, "info", "Skipped non-HTML response", {
          url: item.url,
          contentType,
        });
        return;
      }

      const html = await response.text();
      const title = extractTitle(html);
      const bodyText = htmlToText(html);
      const excerpt = bodyText.slice(0, 280);
      const tokens = tokenize(`${title} ${bodyText}`);
      const frequencies = termFrequency(tokens);
      const discoveredAt = this.now();

      this.db.withTransaction(() => {
        this.db.upsertPage({
          url: item.url,
          title,
          excerpt,
          bodyText,
          contentType,
          statusCode: response.status,
          crawledAt: discoveredAt,
        });
        this.db.replacePageTerms(item.url, frequencies, tokens.length);
        this.db.addPageContext({
          url: item.url,
          jobId,
          originUrl: job.originUrl,
          depth: item.depth,
          discoveredFrom: item.discoveredFrom,
          discoveredAt,
        });
        this.db.markVisited(item.url, jobId, fetchedAt);
      });

      const links = item.depth < job.maxDepth ? extractLinks(html, item.url) : [];
      const discoverySummary = this.processDiscoveredLinks(job, item, links, discoveredAt);

      await this.mutateJob(jobId, (latest) => {
        latest.metrics.crawledCount += 1;
        latest.metrics.indexedPageCount += 1;
        latest.metrics.processedCount += 1;
        latest.metrics.duplicateDiscoveryCount += discoverySummary.duplicates;
        latest.metrics.discoveredCount += discoverySummary.newDiscoveries;
        latest.metrics.queuedCount += discoverySummary.queued;
        latest.metrics.pendingCount += discoverySummary.pending;
        latest.metrics.reusedIndexedCount += discoverySummary.reusedIndexed;
        latest.metrics.lastActivityAt = discoveredAt;
        latest.metrics.queueHighWaterMark = Math.max(
          latest.metrics.queueHighWaterMark,
          this.db.getQueueCounts(jobId).queueCount,
        );
        latest.updatedAt = discoveredAt;
      });

      this.db.appendEvent(jobId, "info", "Page indexed", {
        url: item.url,
        depth: item.depth,
        outgoingLinks: links.length,
        discovered: discoverySummary.newDiscoveries,
        queued: discoverySummary.queued,
        pending: discoverySummary.pending,
      });
      this.rebuildCompatibilityStorage();
    } catch (error) {
      this.db.markVisited(item.url, jobId, fetchedAt);
      await this.mutateJob(jobId, (latest) => {
        latest.lastError = error.message;
        latest.metrics.errorCount += 1;
        latest.metrics.processedCount += 1;
        latest.metrics.lastActivityAt = this.now();
        latest.updatedAt = this.now();
      });
      this.db.appendEvent(jobId, "error", "Crawler request failed", {
        url: item.url,
        error: error.message,
      });
    } finally {
      clearTimeout(timeout);
      this.inFlightUrls.delete(item.url);
      this.db.clearInflightItem(jobId, item.url);
    }
  }

  async handlePreviouslyVisited(job, item) {
    const page = this.db.getPage(item.url);
    if (page) {
      this.db.addPageContext({
        url: item.url,
        jobId: job.id,
        originUrl: job.originUrl,
        depth: item.depth,
        discoveredFrom: item.discoveredFrom,
        discoveredAt: this.now(),
      });
    }

    await this.mutateJob(job.id, (latest) => {
      latest.metrics.processedCount += 1;
      latest.metrics.skippedVisitedCount += 1;
      latest.metrics.reusedIndexedCount += page ? 1 : 0;
      latest.metrics.lastActivityAt = this.now();
      latest.updatedAt = this.now();
    });
    if (page) {
      this.rebuildCompatibilityStorage();
    }
    this.db.appendEvent(job.id, "info", "Skipped already visited URL", {
      url: item.url,
      depth: item.depth,
      hadIndexedPage: Boolean(page),
    });
  }

  processDiscoveredLinks(job, item, links, discoveredAt) {
    const summary = {
      newDiscoveries: 0,
      queued: 0,
      pending: 0,
      reusedIndexed: 0,
      duplicates: 0,
    };

    let counts = this.db.getQueueCounts(job.id);

    for (const link of links) {
      this.db.addCrawlEdge({
        fromUrl: item.url,
        toUrl: link,
        jobId: job.id,
        originUrl: job.originUrl,
        depth: item.depth + 1,
        createdAt: discoveredAt,
      });

      const isNew = this.db.registerDiscoveredUrl(
        job.id,
        link,
        item.depth + 1,
        item.url,
        discoveredAt,
      );

      if (!isNew) {
        summary.duplicates += 1;
        continue;
      }

      summary.newDiscoveries += 1;

      const page = this.db.getPage(link);
      if (page) {
        this.db.addPageContext({
          url: link,
          jobId: job.id,
          originUrl: job.originUrl,
          depth: item.depth + 1,
          discoveredFrom: item.url,
          discoveredAt,
        });
        summary.reusedIndexed += 1;
        continue;
      }

      if (this.db.hasVisited(link)) {
        continue;
      }

      const targetTable =
        counts.queueCount < job.config.maxQueueSize ? "queue" : "pending";
      const inserted = this.db.enqueue(
        job.id,
        link,
        item.depth + 1,
        item.url,
        targetTable,
        discoveredAt,
      );

      if (inserted) {
        if (targetTable === "queue") {
          summary.queued += 1;
          counts.queueCount += 1;
        } else {
          summary.pending += 1;
          counts.pendingCount += 1;
        }
      }
    }

    return summary;
  }

  deferUrl(job, item, reason) {
    const counts = this.db.getQueueCounts(job.id);
    const targetTable = counts.queueCount < job.config.maxQueueSize ? "queue" : "pending";
    this.db.enqueue(job.id, item.url, item.depth, item.discoveredFrom, targetTable, this.now());
    this.db.appendEvent(job.id, "info", reason, {
      url: item.url,
      targetTable,
    });
  }

  async finalizeJobIfIdle(jobId) {
    await this.mutateJob(jobId, (job) => {
      const counts = this.db.getQueueCounts(jobId);
      const activeForJob = this.activePerJob.get(jobId) || 0;

      if (
        job.status !== "completed" &&
        counts.queueCount === 0 &&
        counts.pendingCount === 0 &&
        counts.inflightCount === 0 &&
        activeForJob === 0
      ) {
        job.status = "completed";
        job.completedAt = this.now();
        job.metrics.finishedAt = job.completedAt;
        job.updatedAt = job.completedAt;
        this.db.appendEvent(jobId, "info", "Job completed", {
          crawledCount: job.metrics.crawledCount,
          discoveredCount: job.metrics.discoveredCount,
        });
      }
    });
  }

  decorateJob(job) {
    const counts = this.db.getQueueCounts(job.id);
    return {
      ...job,
      queueCount: counts.queueCount,
      pendingCount: counts.pendingCount,
      inflightCount: counts.inflightCount,
      activeFetches: this.activePerJob.get(job.id) || 0,
      backpressureActive:
        counts.pendingCount > 0 || counts.queueCount >= job.config.maxQueueSize,
      rateLimitState: {
        tokens: Number((this.rateBuckets.get(job.id)?.tokens || 0).toFixed(2)),
        maxRequestsPerSecond: job.config.maxRequestsPerSecond,
      },
    };
  }

  buildJobConfig(options) {
    const maxConcurrency = Number(
      options.maxConcurrency || this.config.DEFAULT_MAX_CONCURRENCY,
    );
    const maxQueueSize = Number(
      options.maxQueueSize || this.config.DEFAULT_MAX_QUEUE_SIZE,
    );
    const maxRequestsPerSecond = Number(
      options.maxRequestsPerSecond || this.config.DEFAULT_MAX_REQUESTS_PER_SECOND,
    );
    const requestTimeoutMs = Number(
      options.requestTimeoutMs || this.config.DEFAULT_REQUEST_TIMEOUT_MS,
    );

    if (
      !Number.isInteger(maxConcurrency) ||
      maxConcurrency <= 0 ||
      !Number.isInteger(maxQueueSize) ||
      maxQueueSize <= 0 ||
      Number.isNaN(maxRequestsPerSecond) ||
      maxRequestsPerSecond <= 0 ||
      !Number.isInteger(requestTimeoutMs) ||
      requestTimeoutMs <= 0
    ) {
      throw new Error("Invalid crawler options");
    }

    return {
      maxConcurrency,
      maxQueueSize,
      maxRequestsPerSecond,
      requestTimeoutMs,
      userAgent: String(options.userAgent || this.config.DEFAULT_USER_AGENT),
    };
  }

  buildInitialMetrics(now) {
    return {
      discoveredCount: 0,
      crawledCount: 0,
      indexedPageCount: 0,
      processedCount: 0,
      queuedCount: 0,
      pendingCount: 0,
      skippedVisitedCount: 0,
      duplicateDiscoveryCount: 0,
      reusedIndexedCount: 0,
      nonHtmlCount: 0,
      errorCount: 0,
      queueHighWaterMark: 0,
      startedAt: now,
      lastActivityAt: now,
      finishedAt: null,
    };
  }

  async mutateJob(jobId, mutator) {
    const previous = this.jobLocks.get(jobId) || Promise.resolve();
    let current;

    current = previous
      .catch(() => undefined)
      .then(() => {
        const job = this.db.getJob(jobId);
        if (!job) {
          return null;
        }

        mutator(job);
        if (!job.updatedAt) {
          job.updatedAt = this.now();
        }
        this.db.saveJob(job);
        return job;
      });

    this.jobLocks.set(jobId, current);
    try {
      return await current;
    } finally {
      if (this.jobLocks.get(jobId) === current) {
        this.jobLocks.delete(jobId);
      }
    }
  }

  now() {
    return new Date().toISOString();
  }

  rebuildCompatibilityStorage() {
    if (!this.compatibilityStorage) {
      return;
    }

    this.compatibilityStorage.rebuild();
  }
}

module.exports = {
  CrawlerService,
};
