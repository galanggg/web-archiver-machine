const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio'); // <-- Added cheerio

// Get the target URL from the command line arguments
const targetUrl = process.argv[2];

if (!targetUrl) {
    console.error('❌ Please provide a URL to archive.');
    console.error('Usage: node archiver.js <URL>');
    process.exit(1);
}

// Ensure the URL is valid
let parsedUrl;
try {
    parsedUrl = new URL(targetUrl);
} catch (err) {
    console.error('❌ Invalid URL provided.');
    process.exit(1);
}

// 1. Foundation: Establish the deterministic directory structure
const domain = parsedUrl.hostname.replace(/[^a-z0-9]/gi, '_'); // Sanitize domain name
const timestamp = Date.now();
const archiveDir = path.join(__dirname, 'archives', `${domain}_${timestamp}`);
const assetsDir = path.join(archiveDir, 'assets');

// Define specific asset directories
const dirs = {
    html: archiveDir, // Root of this specific archive
    css: path.join(assetsDir, 'css'),
    js: path.join(assetsDir, 'js'),
    media: path.join(assetsDir, 'media'),
    api: path.join(assetsDir, 'api') // <-- Added API directory
};

// Create directories synchronously
Object.values(dirs).forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Map to keep track of Original URL -> Local File Path
const urlMap = new Map();

console.log(`📂 Created archive directory: ${archiveDir}`);

(async () => {
    // 2. Headless Engine: Launch Puppeteer
    console.log('🚀 Launching headless browser...');
    const browser = await puppeteer.launch({
        headless: "new", // Use the new headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Enable request interception to capture network traffic
    await page.setRequestInterception(true);

    // Allow all requests to continue naturally (we are capturing the *responses*)
    page.on('request', request => {
        // We do not block anything on Day 1, let the page load completely
        request.continue();
    });

    // 3. Asset Acquisition: Listen to incoming responses
    page.on('response', async response => {
        const url = response.url();
        const status = response.status();

        // Ignore redirects, errors, and data URIs (Data URIs are already embedded)
        if (status >= 300 || url.startsWith('data:')) return;

        const resourceType = response.request().resourceType();
        const contentType = response.headers()['content-type'] || '';

        // Categorize the asset based on resource type or content type
        let subDir = null;
        if (resourceType === 'stylesheet' || contentType.includes('text/css')) {
            subDir = 'css';
        } else if (resourceType === 'script' || contentType.includes('javascript')) {
            subDir = 'js';
        } else if (['image', 'media', 'font'].includes(resourceType) || contentType.includes('image/') || contentType.includes('font/')) {
            subDir = 'media';
        } else if (resourceType === 'xhr' || resourceType === 'fetch' || contentType.includes('application/json')) {
            subDir = 'api'; // <-- Added API capture
        }

        // If it's a tracked asset, save it
        if (subDir) {
            try {
                // Safely await the buffer payload
                const buffer = await response.buffer();

                // Parse the filename from the URL
                const reqUrl = new URL(url);
                let filename = path.basename(reqUrl.pathname);
                if (!filename || subDir === 'api') filename = 'data'; // Fallback name

                // Generate a short hash based on the full URL to prevent file naming collisions
                const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
                const ext = subDir === 'api' ? '.json' : path.extname(filename);
                const baseName = path.basename(filename, ext);

                // Construct final localized filename
                const finalFilename = `${baseName}_${hash}${ext || '.bin'}`;
                const savePath = path.join(dirs[subDir], finalFilename);

                // Write to disk
                fs.writeFileSync(savePath, buffer);

                // Track the mapping for URL rewriting later
                const relativePath = `assets/${subDir}/${finalFilename}`;
                urlMap.set(url, relativePath);

                console.log(`⬇️ Downloaded [${subDir}]: ${finalFilename}`);
            } catch (err) {
                // Buffers can fail if the request was aborted by the browser
                console.error(`⚠️ Failed to buffer ${url}: ${err.message}`);
            }
        }
    });

    console.log(`🌐 Navigating to ${targetUrl} ...`);
    try {
        // Navigate and wait for the network to be idle (ensures most assets are loaded)
        await page.goto(targetUrl, {
            waitUntil: 'networkidle2',
            timeout: 60000 // 60 seconds timeout
        });

        // 4. Save the fully rendered HTML DOM and Rewrite URLs
        console.log('📄 Capturing fully rendered DOM and rewriting URLs...');
        const html = await page.content();

        // Load HTML into Cheerio for manipulation
        const $ = cheerio.load(html);

        // Helper function to rewrite URLs
        const rewriteUrl = (originalUrl) => {
            if (!originalUrl || originalUrl.startsWith('data:')) return originalUrl;
            try {
                // Resolve relative URLs (e.g., "/logo.png") to absolute URLs based on the target website
                const absoluteUrl = new URL(originalUrl, targetUrl).href;
                // If we downloaded this asset, replace it with the local relative path
                if (urlMap.has(absoluteUrl)) {
                    return urlMap.get(absoluteUrl);
                }
            } catch (e) {
                // Ignore malformed URLs
            }
            return originalUrl; // Keep original if we didn't capture it
        };

        // Rewrite <img>, <script>, <audio>, <video>, <iframe>
        $('img, script, audio, video, iframe').each((i, el) => {
            const src = $(el).attr('src');
            if (src) {
                $(el).attr('src', rewriteUrl(src));
            }
        });

        // Rewrite <link> (CSS, Favicons)
        $('link').each((i, el) => {
            const href = $(el).attr('href');
            if (href) {
                $(el).attr('href', rewriteUrl(href));
            }
        });

        // Save modified HTML
        fs.writeFileSync(path.join(dirs.html, 'index.html'), $.html());
        console.log('✅ index.html rewritten and saved successfully.');

        // 5. Save the Map for Day 3 (API Server Replay)
        const mapData = Object.fromEntries(urlMap);
        fs.writeFileSync(path.join(archiveDir, 'urlMap.json'), JSON.stringify(mapData, null, 2));
        console.log('🗺️  urlMap.json saved. (Will be used by our local server tomorrow)');

    } catch (err) {
        console.error(`❌ Navigation failed: ${err.message}`);
    } finally {
        // Cleanup
        console.log('🛑 Closing browser...');
        await browser.close();
        console.log(`🎉 Archiving phase 1 complete! Files saved in: /archives/${domain}_${timestamp}`);
    }
})();
