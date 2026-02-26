# Architecture & Methodology

The **Local Wayback Machine** uses a specialized approach: **Portable Headless SPA Archiving with Client-Side API Interception**.

Instead of relying on traditional web scraping methods, this project was engineered to solve the "Modern Web Problem"—specifically, the rise of Single-Page Applications (SPAs) built with React, Vue, and Next.js, which render data dynamically and break when captured using legacy tools.

Here is a breakdown of the four core pillars of my approach and why they were chosen.

### 1\. Headless Browser Capture (Puppeteer)

**The Approach:** I use a full Chromium browser instance to navigate to the target URL, wait for all network activity to idle (networkidle2), and extract the fully hydrated DOM.

**The "Why":**

- Traditional scrapers (like wget or HTTrack) only download the initial static HTML sent by the server. If pointed at a React app, they download a blank

  and fail.

- By using Puppeteer, I allow the target website to execute its JavaScript, fetch its initial data, and build the visual page exactly as a human user would see it before I take my snapshot.

### 2\. Ahead-of-Time (AOT) Interceptor Injection

**The Approach:** Instead of requiring a complex custom backend server to route offline traffic, I permanently inject a standalone JavaScript 'brain' (a payload containing a custom window.fetch override and a MutationObserver) directly into the of the saved .html files.

**The "Why":** \* The official Internet Archive (Wayback Machine) uses massive server-side infrastructure to intercept and rewrite API requests on the fly. I wanted my archives to be **100% portable**. By utilizing native browser APIs (like MutationObserver and overriding window.fetch and XMLHttpRequest) as my client-side tech stack, I ensure maximum cross-browser compatibility with zero external dependencies. This keeps the archived pages lightweight and completely standalone.

- By injecting the interceptor directly into the HTML during the archiving phase, the resulting .zip folder can be extracted and run on any machine using a basic static file server (like VS Code Live Server). The HTML file is self-aware and routes its own offline API traffic.

### 3\. Folder-Based Asset Extraction with Relative Pathing

**The Approach:** I intercept all network responses (CSS, JS, media, fonts) as binary buffers and save them into a strict assets/ directory structure. I then use Cheerio to rewrite all absolute URLs in the DOM to relative local paths (e.g., ./assets/media/image.jpg).

**The "Why":** \* Tools like _SingleFile_ attempt to solve offline archiving by converting every image and font into massive Base64 strings embedded inside one giant HTML file.

- While Base64 works for a single page, it destroys browser caching. If I crawl 10 pages of a website, embedding the same 2MB font 10 times results in 20MB of wasted space. My folder-based approach keeps the archive lightweight, cacheable, and identical to standard web development practices.

### 4\. Dynamic API Mocking & Cryptographic Hashing

**The Approach:** I capture background xhr and fetch requests during the crawl. Because APIs often use complex query parameters (e.g., /api/data?user=123), I generate a deterministic SHA-256 hash of the request signature and save the JSON payload using that hash.

**The "Why":**

- SPAs crash offline because their buttons trigger fetch() requests to the live internet. By saving these JSON payloads and mapping them via urlMap.json, my offline interceptor can serve the exact data the framework expects. This preserves interactive features like "Load More" buttons, client-side filtering, and tabs without an internet connection.
