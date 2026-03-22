const API = {
  BASE_URL: "",

  async request(method, path, body = null) {
    const options = {
      method,
      headers: {},
    };

    if (body) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.BASE_URL}${path}`, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      return data;
    } catch (error) {
      if (error.name === "TypeError" && error.message.includes("fetch")) {
        throw new Error("Cannot connect to the backend server. Is it running?");
      }

      throw error;
    }
  },

  async createJob(payload) {
    return this.request("POST", "/api/index", payload);
  },

  async getJobs(limit = 50) {
    return this.request("GET", `/api/jobs?limit=${limit}`);
  },

  async getJob(jobId) {
    return this.request("GET", `/api/jobs/${jobId}`);
  },

  async getJobEvents(jobId, afterId = 0, limit = 100) {
    return this.request("GET", `/api/jobs/${jobId}/events?after=${afterId}&limit=${limit}`);
  },

  async search(query, limit) {
    const params = new URLSearchParams({ q: query });
    if (limit) {
      params.set("limit", limit);
    }

    return this.request("GET", `/api/search?${params.toString()}`);
  },

  async getSystemStatus() {
    return this.request("GET", "/api/system");
  },

  async healthCheck() {
    return this.request("GET", "/health");
  },
};
