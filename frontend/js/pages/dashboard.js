function renderDashboard() {
  const main = document.getElementById("main-content");
  main.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">System overview and recent crawl jobs</p>
      </div>

      <div class="dashboard-stats">
        <div class="stat-grid" id="dashboard-stats-grid">
          ${Components.loading("Loading system status...")}
        </div>
      </div>

      <div class="dashboard-jobs">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Recent Jobs</span>
            <span class="last-updated" id="dashboard-updated"></span>
          </div>
          <div class="card-body" style="padding: 0;" id="dashboard-jobs-body">
            ${Components.loading("Loading jobs...")}
          </div>
        </div>
      </div>
    </div>
  `;

  let pollTimer = null;

  async function fetchDashboard() {
    try {
      const data = await API.getSystemStatus();
      updateConnectionStatus(true);
      renderStats(data);
      renderJobsTable(data.jobs || []);
      document.getElementById("dashboard-updated").textContent =
        `Updated ${Components.formatTime(new Date().toISOString())}`;
    } catch (error) {
      updateConnectionStatus(false);
      document.getElementById("dashboard-stats-grid").innerHTML =
        Components.errorBanner(error.message);
    }
  }

  function renderStats(data) {
    const grid = document.getElementById("dashboard-stats-grid");
    grid.innerHTML = [
      Components.statCard("Indexed Pages", data.pages, "pages", 1),
      Components.statCard("Visited URLs", data.visited, "visited", 2),
      Components.statCard("Active Jobs", data.activeJobs, "active", 3),
      Components.statCard("Queue Depth", data.queued, "queue", 4),
      Components.statCard("Pending", data.pending, "pending", 5),
      Components.statCard("In-Flight", data.inflight, "inflight", 6),
    ].join("");
  }

  function renderJobsTable(jobs) {
    const body = document.getElementById("dashboard-jobs-body");

    if (jobs.length === 0) {
      body.innerHTML = Components.emptyState(
        "0",
        "No crawl jobs yet",
        "Start your first crawl job to begin indexing web pages.",
        '<a href="#/crawl/new" class="btn btn-primary" style="margin-top: var(--space-4)">New Crawl Job</a>',
      );
      return;
    }

    body.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Origin URL</th>
              <th>Status</th>
              <th style="text-align:right">Indexed</th>
              <th style="text-align:right">Crawled</th>
              <th style="text-align:right">Errors</th>
              <th>Created</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${jobs.map((job) => Components.jobTableRow(job)).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  fetchDashboard();
  pollTimer = setInterval(fetchDashboard, 4000);
  Router.onCleanup(() => clearInterval(pollTimer));
}
