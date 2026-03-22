function renderSearchPage() {
  const main = document.getElementById("main-content");
  const hashParts = window.location.hash.split("?");
  const urlParams = new URLSearchParams(hashParts[1] || "");
  const initialQuery = urlParams.get("q") || "";

  main.innerHTML = `
    <div class="search-container animate-fade-in">
      <div class="search-hero">
        <h1 class="page-title">Search</h1>
        <p class="page-subtitle">Search indexed pages across all crawl jobs</p>
      </div>

      <div class="search-input-wrap">
        <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          id="search-input"
          class="form-input"
          placeholder="Search indexed pages..."
          value="${Components.escapeHtml(initialQuery)}"
          autocomplete="off"
          autofocus
        >
      </div>

      <div id="search-meta" class="search-meta" style="display:none;"></div>
      <div id="search-results"></div>
    </div>
  `;

  const searchInput = document.getElementById("search-input");
  const searchMeta = document.getElementById("search-meta");
  const searchResults = document.getElementById("search-results");
  let searchTimeout = null;

  async function performSearch(query) {
    if (!query.trim()) {
      searchMeta.style.display = "none";
      searchResults.innerHTML = Components.emptyState(
        "Q",
        "Enter a search query",
        "Type your query and press Enter to search indexed pages.",
      );
      return;
    }

    window.history.replaceState(null, "", `#/search?q=${encodeURIComponent(query)}`);

    searchResults.innerHTML = Components.loading("Searching...");
    searchMeta.style.display = "none";

    try {
      const data = await API.search(query);
      updateConnectionStatus(true);

      searchMeta.style.display = "flex";
      searchMeta.innerHTML = `
        <span>${data.total} result${data.total !== 1 ? "s" : ""} found</span>
        <div class="search-terms">
          <span style="color:var(--text-muted)">Terms:</span>
          ${(data.terms || []).map((term) => `<span class="search-term-tag">${Components.escapeHtml(term)}</span>`).join("")}
        </div>
      `;

      if (data.results.length === 0) {
        searchResults.innerHTML = Components.emptyState(
          "0",
          "No results found",
          `No indexed pages match "${Components.escapeHtml(query)}". Try a different query or start a new crawl.`,
          '<a href="#/crawl/new" class="btn btn-primary btn-sm" style="margin-top: var(--space-4)">New Crawl Job</a>',
        );
        return;
      }

      searchResults.innerHTML = `
        <div class="search-results">
          ${data.results.map((result, index) => renderSearchResult(result, index)).join("")}
        </div>
      `;
    } catch (error) {
      updateConnectionStatus(false);
      searchResults.innerHTML = Components.errorBanner(error.message);
    }
  }

  function renderSearchResult(result, index) {
    const delay = Math.min(index * 50, 500);
    return `
      <div class="search-result-card" style="animation-delay: ${delay}ms;">
        <div class="search-result-title">
          ${Components.escapeHtml(result.title || "Untitled Page")}
          <span class="search-result-score">Score ${result.score}</span>
        </div>
        <a href="${Components.escapeHtml(result.relevantUrl)}" target="_blank" rel="noopener" class="search-result-url">
          ${Components.escapeHtml(result.relevantUrl)}
        </a>
        ${result.excerpt ? `<p class="search-result-excerpt">${Components.escapeHtml(result.excerpt)}</p>` : ""}
        <div class="search-result-meta">
          <div class="search-result-meta-item">
            <span>Origin:</span>
            <span class="value">${Components.escapeHtml(truncateUrl(result.originUrl, 40))}</span>
          </div>
          <div class="search-result-meta-item">
            <span>Depth:</span>
            <span class="value">${result.depth}</span>
          </div>
          <div class="search-result-meta-item">
            <span>Matched Terms:</span>
            <span class="value">${result.matchedTerms}</span>
          </div>
        </div>
      </div>
    `;
  }

  function truncateUrl(url, maxLen) {
    if (!url || url.length <= maxLen) {
      return url;
    }

    return `${url.slice(0, maxLen)}...`;
  }

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(searchTimeout);
      performSearch(searchInput.value);
    }
  });

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (searchInput.value.trim().length >= 2) {
        performSearch(searchInput.value);
      }
    }, 400);
  });

  Router.onCleanup(() => {
    clearTimeout(searchTimeout);
  });

  if (initialQuery) {
    performSearch(initialQuery);
  } else {
    searchResults.innerHTML = Components.emptyState(
      "Q",
      "Enter a search query",
      "Type your query and press Enter to search indexed pages.",
    );
  }
}
