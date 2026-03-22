const { normalizeUrl } = require("./normalize-url");

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return "";
  }

  return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
}

function htmlToText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const hrefPattern = /<a\b[^>]*href\s*=\s*(['"])(.*?)\1/gi;

  let match;
  while ((match = hrefPattern.exec(html)) !== null) {
    const href = match[2]?.trim();
    if (!href) {
      continue;
    }

    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      continue;
    }

    const normalized = normalizeUrl(href, baseUrl);
    if (normalized) {
      links.add(normalized);
    }
  }

  return [...links];
}

module.exports = {
  extractLinks,
  extractTitle,
  htmlToText,
};
