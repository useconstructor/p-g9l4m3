# Local product regression

The regression builds a fresh source copy, starts Next with a private local SQLite file, and runs native Chromium. macOS `sandbox-exec` denies outbound traffic for the app and allows only its own loopback port for Chromium. It never reads a repository `.env`, allocates provider credentials, or changes a deployed database.

Use existing installed dependencies and an existing headless browser (the script downloads nothing):

```sh
PROJECT_TEST_NODE_MODULES=/absolute/path/to/node_modules \
PROJECT_TEST_PLAYWRIGHT_ROOT=/absolute/path/to/modules/containing/playwright \
PROJECT_TEST_CHROMIUM=/absolute/path/to/chrome-headless-shell \
npm run test:product-qa
```

Results, source hashes and server/build logs are retained under gitignored `tmp-tests/product-qa-*`. The owned browser/server close in `finally`; the local fictional database remains for diagnosing failures.

Checks cover both owners' isolation, Unicode casing, literal `%`, `_`, backslash and whitespace searches, unchanged ordering, every declared raster icon's HTTP status/MIME/dimensions, pin focus/draft preservation without stealing moved focus, associated keyboard labels and focus-ring contrast, and bounded long-list middle/lower selection at 1440/768/390 with visible unobstructed sticky save controls and retained mobile scroll.

Raster deployment assets are committed explicitly. To regenerate them from the existing brand SVG, run `npm run generate:icons`; this uses sharp already installed with Next. These are product icons, not test screenshots.

These local regressions are not deployed HTTPS, native partition, Constructor Views or full project acceptance. The independent frozen viewport verifier's all-declared-fonts-loaded assertion can fail locally for unused 700 weight before reaching geometry; that limitation is kept separate and no font is artificially loaded to pass it.
