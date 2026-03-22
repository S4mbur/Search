const Components = {
  statusBadge(status) {
    const map = {
      completed: { class: "badge-completed", label: "Completed" },
      running: { class: "badge-running", label: "Running" },
      queued: { class: "badge-queued", label: "Queued" },
      failed: { class: "badge-failed", label: "Failed" },
    };
    const config = map[status] || { class: "badge-queued", label: status };
    return `<span class="badge ${config.class}">${config.label}</span>`;
  },

  backpressureBadge(active) {
    if (!active) {
      return "";
    }

    return `<span class="badge badge-backpressure">Backpressure</span>`;
  },

  statCard(label, value, iconClass, staggerIndex = 0) {
    return `
      <div class="stat-card animate-fade-in stagger-${staggerIndex}">
        <div class="stat-icon ${iconClass}">
          ${this.statIcon(iconClass)}
        </div>
        <div class="stat-label">${label}</div>
        <div class="stat-value">${this.formatNumber(value)}</div>
      </div>
    `;
  },

  statIcon(type) {
    const icons = {
      pages: "PG",
      visited: "URL",
      active: "RUN",
      queue: "Q",
      pending: "PD",
      inflight: "IN",
    };
    return icons[type] || "SYS";
  },

  formatNumber(num) {
    if (num === undefined || num === null) {
      return "N/A";
    }

    if (typeof num !== "number") {
      num = Number(num);
    }

    if (Number.isNaN(num)) {
      return "N/A";
    }

    return num.toLocaleString();
  },

  relativeTime(dateStr) {
    if (!dateStr) {
      return "N/A";
    }

    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 5) {
      return "just now";
    }
    if (diffSec < 60) {
      return `${diffSec}s ago`;
    }
    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }
    if (diffHour < 24) {
      return `${diffHour}h ago`;
    }

    return `${diffDay}d ago`;
  },

  formatTime(dateStr) {
    if (!dateStr) {
      return "N/A";
    }

    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", { hour12: false });
  },

  loading(text = "Loading...") {
    return `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <div class="loading-text">${text}</div>
      </div>
    `;
  },

  emptyState(icon, title, text, actionHtml = "") {
    return `
      <div class="empty-state animate-fade-in">
        <div class="empty-state-icon">${icon}</div>
        <div class="empty-state-title">${title}</div>
        <div class="empty-state-text">${text}</div>
        ${actionHtml}
      </div>
    `;
  },

  errorBanner(message) {
    return `
      <div class="error-banner animate-fade-in">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span>${message}</span>
      </div>
    `;
  },

  jobTableRow(job) {
    const duration = this.getJobDuration(job);
    return `
      <tr onclick="Router.navigate('/jobs/${job.id}')">
        <td class="mono" style="font-size: var(--text-xs); color: var(--text-tertiary);">${job.id.slice(0, 20)}...</td>
        <td class="url-cell">${this.escapeHtml(job.originUrl)}</td>
        <td>${this.statusBadge(job.status)}</td>
        <td class="number-cell">${this.formatNumber(job.metrics?.indexedPageCount || 0)}</td>
        <td class="number-cell">${this.formatNumber(job.metrics?.crawledCount || 0)}</td>
        <td class="number-cell">${this.formatNumber(job.metrics?.errorCount || 0)}</td>
        <td style="font-size: var(--text-xs); color: var(--text-tertiary);">${this.relativeTime(job.createdAt)}</td>
        <td style="font-size: var(--text-xs); color: var(--text-tertiary);">${duration}</td>
      </tr>
    `;
  },

  getJobDuration(job) {
    if (!job.createdAt) {
      return "N/A";
    }

    const start = new Date(job.createdAt);
    const end = job.completedAt ? new Date(job.completedAt) : new Date();
    const diffMs = end - start;
    const sec = Math.floor(diffMs / 1000);

    if (sec < 60) {
      return `${sec}s`;
    }

    const min = Math.floor(sec / 60);
    const remainSec = sec % 60;

    if (min < 60) {
      return `${min}m ${remainSec}s`;
    }

    const hr = Math.floor(min / 60);
    const remainMin = min % 60;
    return `${hr}h ${remainMin}m`;
  },

  eventItem(event) {
    const levelMap = { info: "I", warn: "W", error: "E" };
    let msg = this.escapeHtml(event.message);

    if (event.data?.url) {
      msg += ` <span class="event-url">${this.escapeHtml(event.data.url)}</span>`;
    }

    return `
      <div class="event-item">
        <span class="event-time">${this.formatTime(event.createdAt)}</span>
        <span class="event-level ${event.level}">${levelMap[event.level] || "?"}</span>
        <span class="event-message">${msg}</span>
      </div>
    `;
  },

  progressBar(current, total) {
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    return `
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${pct}%"></div>
      </div>
    `;
  },

  metricItem(label, value) {
    return `
      <div class="metric-item">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${typeof value === "number" ? this.formatNumber(value) : value}</span>
      </div>
    `;
  },

  async copyToClipboard(text, btnEl) {
    try {
      await navigator.clipboard.writeText(text);
      if (btnEl) {
        btnEl.classList.add("copied");
        btnEl.innerHTML = "OK";
        setTimeout(() => {
          btnEl.classList.remove("copied");
          btnEl.innerHTML = "Copy";
        }, 1500);
      }
    } catch (error) {}
  },

  showToast(message, type = "success", duration = 3000) {
    let container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(20px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  escapeHtml(text) {
    if (!text) {
      return "";
    }

    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },
};
