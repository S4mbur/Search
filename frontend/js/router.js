const Router = {
  routes: {},
  currentRoute: null,
  cleanupFns: [],

  register(path, handler) {
    this.routes[path] = handler;
  },

  init() {
    window.addEventListener("hashchange", () => this.resolve());
    this.resolve();
  },

  resolve() {
    const hash = window.location.hash || "#/";
    const path = hash.slice(1) || "/";

    this.cleanup();

    document.querySelectorAll(".nav-link").forEach((link) => {
      const href = link.getAttribute("href");
      if (href === `#${path}`) {
        link.classList.add("active");
      } else if (path.startsWith("/jobs/") && link.dataset.route === "dashboard") {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });

    let handler = this.routes[path];
    let params = {};

    if (!handler) {
      for (const [routePath, routeHandler] of Object.entries(this.routes)) {
        const paramMatch = this.matchRoute(routePath, path);
        if (paramMatch) {
          handler = routeHandler;
          params = paramMatch;
          break;
        }
      }
    }

    if (handler) {
      this.currentRoute = path;
      handler(params);
    } else {
      this.show404();
    }
  },

  matchRoute(routePath, actualPath) {
    const routeParts = routePath.split("/");
    const actualParts = actualPath.split("/");

    if (routeParts.length !== actualParts.length) {
      return null;
    }

    const params = {};
    for (let i = 0; i < routeParts.length; i += 1) {
      if (routeParts[i].startsWith(":")) {
        params[routeParts[i].slice(1)] = actualParts[i];
      } else if (routeParts[i] !== actualParts[i]) {
        return null;
      }
    }

    return params;
  },

  navigate(path) {
    window.location.hash = `#${path}`;
  },

  onCleanup(fn) {
    this.cleanupFns.push(fn);
  },

  cleanup() {
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch (error) {}
    }

    this.cleanupFns = [];
  },

  show404() {
    const main = document.getElementById("main-content");
    main.innerHTML = `
      <div class="empty-state animate-fade-in">
        <div class="empty-state-icon">?</div>
        <div class="empty-state-title">Page Not Found</div>
        <div class="empty-state-text">The page you're looking for doesn't exist.</div>
        <a href="#/" class="btn btn-primary" style="margin-top: var(--space-4)">Go to Dashboard</a>
      </div>
    `;
  },
};
