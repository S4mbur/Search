const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUrl } = require("../src/utils/normalize-url");
const { extractLinks, extractTitle, htmlToText } = require("../src/utils/html");
const { tokenize, termFrequency } = require("../src/utils/tokenize");

test("normalizeUrl normalizes default ports, fragments, and relative URLs", () => {
  assert.equal(
    normalizeUrl("https://Example.com:443/docs/#section"),
    "https://example.com/docs",
  );
  assert.equal(
    normalizeUrl("/team/", "https://example.com/company"),
    "https://example.com/team",
  );
  assert.equal(normalizeUrl("mailto:test@example.com"), null);
});

test("html helpers extract title, body text, and links", () => {
  const html = `
    <html>
      <head>
        <title>Example &amp; Demo</title>
        <style>.hidden { display:none; }</style>
      </head>
      <body>
        <script>window.ignore = true;</script>
        <h1>Hello crawler</h1>
        <a href="/about">About</a>
        <a href="https://example.com/docs">Docs</a>
        <a href="#skip">Skip</a>
      </body>
    </html>
  `;

  assert.equal(extractTitle(html), "Example & Demo");
  assert.match(htmlToText(html), /Hello crawler/);
  assert.deepEqual(extractLinks(html, "https://example.com"), [
    "https://example.com/about",
    "https://example.com/docs",
  ]);
});

test("tokenize and termFrequency keep useful query tokens", () => {
  const tokens = tokenize("The crawler search crawler indexes pages quickly.");
  assert.deepEqual(tokens, [
    "crawler",
    "search",
    "crawler",
    "indexes",
    "pages",
    "quickly",
  ]);

  const frequencies = termFrequency(tokens);
  assert.equal(frequencies.get("crawler"), 2);
  assert.equal(frequencies.get("search"), 1);
});
