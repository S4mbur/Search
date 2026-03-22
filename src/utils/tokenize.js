const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

function tokenize(text) {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  return matches.filter((token) => !STOP_WORDS.has(token));
}

function termFrequency(tokens) {
  const frequencies = new Map();

  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }

  return frequencies;
}

module.exports = {
  tokenize,
  termFrequency,
};
