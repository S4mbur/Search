function updateConnectionStatus(connected) {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");

  if (connected) {
    dot.className = "status-dot connected";
    text.textContent = "Connected";
  } else {
    dot.className = "status-dot error";
    text.textContent = "Disconnected";
  }
}

async function checkHealth() {
  try {
    await API.healthCheck();
    updateConnectionStatus(true);
  } catch (error) {
    updateConnectionStatus(false);
  }
}

Router.register("/", renderDashboard);
Router.register("/crawl/new", renderNewCrawl);
Router.register("/jobs/:jobId", renderJobDetail);
Router.register("/search", renderSearchPage);

document.addEventListener("DOMContentLoaded", () => {
  Router.init();
  checkHealth();
  setInterval(checkHealth, 15000);
});
