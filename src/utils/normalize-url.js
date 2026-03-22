const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function normalizeUrl(input, baseUrl) {
  try {
    const url = baseUrl ? new URL(input, baseUrl) : new URL(input);

    if (!HTTP_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    url.hash = "";
    url.username = "";
    url.password = "";
    url.hostname = url.hostname.toLowerCase();

    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

module.exports = {
  normalizeUrl,
};
