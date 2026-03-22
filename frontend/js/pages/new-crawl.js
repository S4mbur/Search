function renderNewCrawl() {
  const main = document.getElementById("main-content");
  main.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h1 class="page-title">New Crawl Job</h1>
        <p class="page-subtitle">Configure and start a new web crawl</p>
      </div>

      <div class="new-crawl-form">
        <form id="crawl-form" class="card">
          <div class="card-body">
            <div id="form-error"></div>

            <div class="form-group">
              <label class="form-label" for="input-origin">Origin URL</label>
              <input
                type="url"
                id="input-origin"
                class="form-input mono"
                placeholder="https://example.com"
                required
                autofocus
              >
              <span class="form-hint">The starting URL to begin crawling from</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="input-depth">Crawl Depth (k)</label>
              <input
                type="number"
                id="input-depth"
                class="form-input"
                value="2"
                min="0"
                max="10"
                required
              >
              <span class="form-hint">Maximum number of hops from the origin URL (0 = origin only)</span>
            </div>

            <div class="form-section-title">Advanced Options</div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="input-concurrency">Max Concurrency</label>
                <input type="number" id="input-concurrency" class="form-input" value="4" min="1" max="20">
                <span class="form-hint">Parallel fetches per job</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="input-queue-size">Max Queue Size</label>
                <input type="number" id="input-queue-size" class="form-input" value="200" min="1">
                <span class="form-hint">Queue capacity before backpressure</span>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="input-rps">Max Requests/sec</label>
                <input type="number" id="input-rps" class="form-input" value="2" min="0.1" step="0.1">
                <span class="form-hint">Rate limit per second</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="input-timeout">Request Timeout (ms)</label>
                <input type="number" id="input-timeout" class="form-input" value="10000" min="1000" step="1000">
                <span class="form-hint">Timeout for each HTTP request</span>
              </div>
            </div>
          </div>

          <div class="card-footer">
            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-lg" id="submit-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
                Start Crawl
              </button>
              <a href="#/" class="btn btn-ghost">Cancel</a>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById("crawl-form");
  const submitBtn = document.getElementById("submit-btn");
  const formError = document.getElementById("form-error");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.innerHTML = "";

    const origin = document.getElementById("input-origin").value.trim();
    const k = parseInt(document.getElementById("input-depth").value, 10);
    const maxConcurrency = parseInt(document.getElementById("input-concurrency").value, 10);
    const maxQueueSize = parseInt(document.getElementById("input-queue-size").value, 10);
    const maxRequestsPerSecond = parseFloat(document.getElementById("input-rps").value);
    const requestTimeoutMs = parseInt(document.getElementById("input-timeout").value, 10);

    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Only http and https URLs are supported");
      }
    } catch (error) {
      formError.innerHTML = Components.errorBanner("Please enter a valid http(s) URL");
      return;
    }

    if (Number.isNaN(k) || k < 0) {
      formError.innerHTML = Components.errorBanner("Depth must be a non-negative integer");
      return;
    }

    if (maxConcurrency < 1 || maxQueueSize < 1 || maxRequestsPerSecond <= 0 || requestTimeoutMs < 1000) {
      formError.innerHTML = Components.errorBanner("Please check the advanced options values");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <div class="loading-spinner" style="width:18px;height:18px;border-width:2px;"></div>
      Starting...
    `;

    try {
      const result = await API.createJob({
        origin,
        k,
        maxConcurrency,
        maxQueueSize,
        maxRequestsPerSecond,
        requestTimeoutMs,
      });

      Components.showToast("Crawl job started successfully!", "success");
      Router.navigate(`/jobs/${result.job.id}`);
    } catch (error) {
      formError.innerHTML = Components.errorBanner(error.message);
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        Start Crawl
      `;
    }
  });
}
