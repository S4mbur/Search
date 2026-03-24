# Submission Answers

Current crawled origin used for the answers below:

- `https://quotes.toscrape.com/`

Questions:

1. Make sure you have crawled data available and also uploaded to GitHub. Open the raw storage file:

   `data/storage/p.data`

2. Find a word that appears on multiple different URLs.

   Write down the word you chose: `paraphrased`

3. For that word, copy 3 entries from the file.

   Entry 1: `paraphrased https://quotes.toscrape.com/tag/paraphrased/page/1 https://quotes.toscrape.com/ 1 3`

   Entry 2: `paraphrased https://quotes.toscrape.com/ https://quotes.toscrape.com/ 0 1`

   Entry 3: `paraphrased https://quotes.toscrape.com/tag/edison/page/1 https://quotes.toscrape.com/ 1 1`

4. Search for that word via the API:

   `GET http://localhost:3600/search?query=paraphrased&sortBy=relevance`

5. Write down the #1 result's URL and relevance_score:

   - URL: `https://quotes.toscrape.com/tag/paraphrased/page/1`
   - relevance_score: `1025`

6. Manually calculate the score for each of your 3 entries using the formula:

   `score = (frequency x 10) + 1000 - (depth x 5)`

   - Entry 1 score: `( 3 x 10 ) + 1000 - ( 1 x 5 ) = 1025`
   - Entry 2 score: `( 1 x 10 ) + 1000 - ( 0 x 5 ) = 1010`
   - Entry 3 score: `( 1 x 10 ) + 1000 - ( 1 x 5 ) = 1005`

7. Does the highest score you calculated match the API's #1 result?

   `Yes`

8. How could you enhance the process in a Chain-of-Thought manner?

   A stronger Chain-of-Thought style workflow would turn this into a repeatable validation pipeline instead of a one-off manual check. First, the system should identify candidate words that appear across many URLs and automatically rank them by how useful they are for verification. Then it should fetch the matching raw storage entries, compute the relevance score for each entry step by step, query the API, and compare the expected top-ranked result with the actual API result. Finally, it should generate a short explanation whenever there is a mismatch, such as duplicate contexts, unexpected depth values, or inconsistent scoring logic between storage and the API.

   This process could be improved further by adding a small verification script that exports the chosen word, the top storage entries, the formula-based calculations, and the API response into a single report. That would reduce human error, make debugging faster, and provide a clearer audit trail showing that the ranking logic is correct from raw indexed data all the way to the search endpoint.
