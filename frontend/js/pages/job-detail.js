function renderJobDetail(params) {
  const jobId = params.jobId;
  const main = document.getElementById("main-content");
  main.innerHTML = Components.loading("Loading job details...");

  let pollTimer = null;
  let eventPollTimer = null;
  let lastEventId = 0;
  let allEvents = [];

  async function fetchJob() {
    try {
      const data = await API.getJob(jobId);
      updateConnectionStatus(true);
      renderJobPage(data.job);
      return data.job;
    } catch (error) {
      updateConnectionStatus(false);
      main.innerHTML = `
        <div class="animate-fade-in">
          ${Components.errorBanner(error.message)}
          <a href="#/" class="btn btn-secondary">Back to Dashboard</a>
        </div>
      `;
      return null;
    }
  }

  async function fetchEvents() {
    try {
      const data = await API.getJobEvents(jobId, lastEventId, 100);
      if (data.events && data.events.length > 0) {
        allEvents = allEvents.concat(data.events);
        lastEventId = data.events[data.events.length - 1].id;
        renderEventLog();
      }
    } catch (error) {}
  }

  function renderJobPage(job) {
    const isActive = ["queued", "running"].includes(job.status);
    const metrics = job.metrics || {};
    const progress = metrics.discoveredCount > 0
      ? Math.round((metrics.processedCount / metrics.discoveredCount) * 100)
      : 0;

    main.innerHTML = `
      <div class="animate-fade-in">
        <a href="#/" class="btn btn-ghost btn-sm" style="margin-bottom: var(--space-4);">
          Back to Dashboard
        </a>

        <div class="job-detail-header">
          <div>
            <div class="page-title">
              <span class="job-id-text">${Components.escapeHtml(job.id)}</span>
              ${Components.statusBadge(job.status)}
              ${Components.backpressureBadge(job.backpressureActive)}
            </div>
            <div class="job-meta">
              <div class="job-meta-item">
                <span class="label">Origin:</span>
                <a href="${Components.escapeHtml(job.originUrl)}" target="_blank" rel="noopener" class="value">${Components.escapeHtml(job.originUrl)}</a>
              </div>
              <div class="job-meta-item">
                <span class="label">Max Depth:</span>
                <span class="value">${job.maxDepth}</span>
              </div>
              <div class="job-meta-item">
                <span class="label">Created:</span>
                <span class="value">${Components.relativeTime(job.createdAt)}</span>
              </div>
              ${job.completedAt ? `
                <div class="job-meta-item">
                  <span class="label">Duration:</span>
                  <span class="value">${Components.getJobDuration(job)}</span>
                </div>
              ` : ""}
            </div>
          </div>
        </div>

        <div class="job-sections">
          ${isActive ? `
            <div class="card">
              <div class="job-progress-section">
                <div class="job-progress-info">
                  <span class="job-progress-label">Progress</span>
                  <span class="job-progress-value">${progress}%</span>
                </div>
                <div class="job-progress-bar-wrap">
                  ${Components.progressBar(metrics.processedCount, metrics.discoveredCount)}
                </div>
                <div class="job-progress-info">
                  <span class="job-progress-value">${Components.formatNumber(metrics.processedCount)}</span>
                  <span class="job-progress-label">/ ${Components.formatNumber(metrics.discoveredCount)}</span>
                </div>
              </div>
            </div>
          ` : ""}

          <div class="card">
            <div class="card-header">
              <span class="card-title">Crawl Metrics</span>
              ${isActive ? '<span class="badge badge-running">Live</span>' : ""}
            </div>
            <div class="card-body">
              <div class="metric-grid">
                ${Components.metricItem("Discovered", metrics.discoveredCount || 0)}
                ${Components.metricItem("Crawled", metrics.crawledCount || 0)}
                ${Components.metricItem("Indexed Pages", metrics.indexedPageCount || 0)}
                ${Components.metricItem("Processed", metrics.processedCount || 0)}
                ${Components.metricItem("Skipped (Visited)", metrics.skippedVisitedCount || 0)}
                ${Components.metricItem("Reused Indexed", metrics.reusedIndexedCount || 0)}
                ${Components.metricItem("Duplicates", metrics.duplicateDiscoveryCount || 0)}
                ${Components.metricItem("Non-HTML", metrics.nonHtmlCount || 0)}
                ${Components.metricItem("Errors", metrics.errorCount || 0)}
                ${Components.metricItem("Queue HWM", metrics.queueHighWaterMark || 0)}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Operational State</span>
            </div>
            <div class="card-body">
              <div class="metric-grid">
                ${Components.metricItem("Queue", job.queueCount || 0)}
                ${Components.metricItem("Pending", job.pendingCount || 0)}
                ${Components.metricItem("In-Flight", job.inflightCount || 0)}
                ${Components.metricItem("Active Fetches", job.activeFetches || 0)}
                ${Components.metricItem("Backpressure", job.backpressureActive ? "Active" : "Inactive")}
                ${Components.metricItem("Rate Limit", job.rateLimitState ? `${job.rateLimitState.tokens} / ${job.rateLimitState.maxRequestsPerSecond}` : "N/A")}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Configuration</span>
            </div>
            <div class="card-body">
              <div class="metric-grid">
                ${Components.metricItem("Max Concurrency", job.config?.maxConcurrency || "N/A")}
                ${Components.metricItem("Max Queue Size", job.config?.maxQueueSize || "N/A")}
                ${Components.metricItem("Max Req/sec", job.config?.maxRequestsPerSecond || "N/A")}
                ${Components.metricItem("Timeout (ms)", job.config?.requestTimeoutMs || "N/A")}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Event Log</span>
              <span class="last-updated" id="event-count">${allEvents.length} events</span>
            </div>
            <div class="card-body" style="padding: 0;">
              <div class="event-log" id="event-log-list">
                ${allEvents.length === 0 ? Components.loading("Loading events...") : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (allEvents.length > 0) {
      renderEventLog();
    }
  }

  function renderEventLog() {
    const logEl = document.getElementById("event-log-list");
    const countEl = document.getElementById("event-count");
    if (!logEl) {
      return;
    }

    const displayed = allEvents.slice(-200);
    logEl.innerHTML = displayed.map((event) => Components.eventItem(event)).join("");

    if (countEl) {
      countEl.textContent = `${allEvents.length} events`;
    }

    logEl.scrollTop = logEl.scrollHeight;
  }

  fetchJob().then((job) => {
    if (!job) {
      return;
    }

    fetchEvents();

    const isActive = ["queued", "running"].includes(job.status);
    if (isActive) {
      pollTimer = setInterval(fetchJob, 2000);
      eventPollTimer = setInterval(fetchEvents, 2000);
    } else {
      fetchEvents();
    }
  });

  Router.onCleanup(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    if (eventPollTimer) {
      clearInterval(eventPollTimer);
    }
  });
}
