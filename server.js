const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const ARCHIVES_DIR = path.join(__dirname, 'archives');

// Ensure the archives directory exists
if (!fs.existsSync(ARCHIVES_DIR)) {
    fs.mkdirSync(ARCHIVES_DIR);
}

// Route 1: The Web UI
app.get('/', (req, res) => {
    const folders = fs.readdirSync(ARCHIVES_DIR).filter(f => fs.statSync(path.join(ARCHIVES_DIR, f)).isDirectory());

    let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>My Local Wayback Machine</title>
            <style>
                body { font-family: system-ui, sans-serif; background: #f4f4f5; padding: 2rem; color: #18181b; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
                h1 { margin-top: 0; border-bottom: 2px solid #e4e4e7; padding-bottom: 1rem; }
                ul { list-style: none; padding: 0; }
                li { margin-bottom: 0.5rem; }
                a { display: block; padding: 1rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; text-decoration: none; color: #2563eb; font-weight: 500; }
                a:hover { background: #eff6ff; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📚 Archive Library</h1>
                <ul>
                    ${folders.map(folder => `<li><a href="/view/${folder}/" target="_blank">🌐 ${folder.replace(/_/g, ' ')}</a></li>`).join('')}
                </ul>
            </div>
        </body>
        </html>
    `;
    res.send(html);
});

// Route 2: Serve the archive and Inject the Interceptors
app.use('/view', (req, res, next) => {
    const pathParts = req.path.split('/').filter(Boolean);

    // If we just hit /view or /view/ let the catch-all handle or return 404
    if (pathParts.length === 0) return res.status(404).send('Archive ID missing');

    const archiveId = pathParts[0];
    const requestPath = pathParts.slice(1).join('/') || 'index.html';
    const fullPath = path.join(ARCHIVES_DIR, archiveId, requestPath);

    // If file doesn't exist, pass to the next route (the catch-all)
    if (!fs.existsSync(fullPath)) {
        return next();
    }

    // If HTML, inject interceptors!
    if (requestPath === 'index.html') {
        let htmlContent = fs.readFileSync(path.join(ARCHIVES_DIR, archiveId, 'index.html'), 'utf-8');
        let urlMap = {};
        try {
            const mapData = fs.readFileSync(path.join(ARCHIVES_DIR, archiveId, 'urlMap.json'), 'utf-8');
            urlMap = JSON.parse(mapData);
        } catch (e) {}

        const scriptToInject = `
        <script>
            console.log('[Wayback Server] Initializing Offline API & DOM Interceptor...');
            window.__ARCHIVE_ID__ = '${archiveId}';
            window.__URL_MAP__ = ${JSON.stringify(urlMap)};

            function findLocalMap(requestUrl) {
                if(!requestUrl) return null;
                const keys = Object.keys(window.__URL_MAP__);

                // 1. Exact Match
                if (window.__URL_MAP__[requestUrl]) return window.__URL_MAP__[requestUrl];

                // 2. Smart Pathname Match (Ignores dynamic query parameters like ?t=123)
                try {
                    const reqUrlObj = new URL(requestUrl, window.location.origin);
                    const reqPathname = reqUrlObj.pathname;

                    for (let key of keys) {
                        try {
                            const keyUrlObj = new URL(key);
                            if (keyUrlObj.pathname === reqPathname) {
                                return window.__URL_MAP__[key];
                            }
                        } catch(e) {}
                    }
                } catch(e) {}

                // 3. Fallback endsWith (Strips query params for safe matching)
                let searchStr = requestUrl.split('?')[0];
                for(let key of keys) {
                    if(key.split('?')[0].endsWith(searchStr)) return window.__URL_MAP__[key];
                }
                return null;
            }

            // 1. Override Fetch API
            const originalFetch = window.fetch;
            window.fetch = async function() {
                let urlStr = typeof arguments[0] === 'string' ? arguments[0] : arguments[0].url;
                let localPath = findLocalMap(urlStr);
                if (localPath) arguments[0] = '/view/' + window.__ARCHIVE_ID__ + '/' + localPath;
                return originalFetch.apply(this, arguments);
            };

            // 2. Override XHR
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                let localPath = findLocalMap(url.toString());
                if (localPath) url = '/view/' + window.__ARCHIVE_ID__ + '/' + localPath;
                return originalOpen.call(this, method, url, ...rest);
            };

            // 3. THE HYDRATION FIX: Watch DOM for JS rewriting images
            let observer;
            function startObserving() {
                if(!document.body) return;
                observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.type === 'attributes' && ['src', 'srcset', 'href'].includes(mutation.attributeName)) {
                            const el = mutation.target;
                            const currentVal = el.getAttribute(mutation.attributeName);

                            // Ignore if it's already a local archive path or data URI
                            if (!currentVal || currentVal.startsWith('/view/') || currentVal.startsWith('data:')) return;

                            let localPath = findLocalMap(currentVal);
                            if (localPath) {
                                console.log('👁️ [Archiver] Stopped JS from breaking image:', currentVal);
                                observer.disconnect(); // Pause observer to prevent infinite loop

                                if (mutation.attributeName === 'srcset') {
                                    const newSrcset = currentVal.split(',').map(part => {
                                        const p = part.trim().split(/\\s+/);
                                        let lp = findLocalMap(p[0]);
                                        return lp ? '/view/' + window.__ARCHIVE_ID__ + '/' + lp + (p[1] ? ' ' + p[1] : '') : part;
                                    }).join(', ');
                                    el.setAttribute('srcset', newSrcset);
                                } else {
                                    el.setAttribute(mutation.attributeName, '/view/' + window.__ARCHIVE_ID__ + '/' + localPath);
                                }
                                startObserving(); // Resume observer
                            }
                        }
                    });
                });
                observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'href'] });
            }
            window.addEventListener('DOMContentLoaded', startObserving);
        </script>
        `;

        htmlContent = htmlContent.replace('<head>', '<head>\n' + scriptToInject);
        res.setHeader('Content-Type', 'text/html');
        return res.send(htmlContent);
    }

    res.sendFile(fullPath);
});

// Route 3: THE CATCH-ALL SERVER FALLBACK
// If JS requests a raw path like "http://localhost:3000/images/logo.svg" directly, catch it here.
app.use((req, res, next) => {
    const referer = req.get('referer');
    if (referer && referer.includes('/view/')) {
        const match = referer.match(/\/view\/([^\/]+)/);
        if (match) {
            const archiveId = match[1];
            try {
                const mapData = fs.readFileSync(path.join(ARCHIVES_DIR, archiveId, 'urlMap.json'), 'utf-8');
                const urlMap = JSON.parse(mapData);

                // req.path automatically strips query params in Express! (e.g., /api/reviews/123)
                const requestedPath = req.path;

                for (let key in urlMap) {
                    try {
                        // Safely compare pathnames, ignoring query parameters from the archived URL
                        const keyUrlObj = new URL(key);
                        if (keyUrlObj.pathname === requestedPath || keyUrlObj.pathname.endsWith(requestedPath)) {
                            const localPath = urlMap[key];
                            const fullLocalPath = path.join(ARCHIVES_DIR, archiveId, localPath);
                            if (fs.existsSync(fullLocalPath)) {
                                console.log(`🛡️ [Server Catch-All] Rescued parameterized API/Asset: ${requestedPath}`);
                                return res.sendFile(fullLocalPath);
                            }
                        }
                    } catch (e) {
                        // Fallback for non-absolute URL strings in map
                        if (key.split('?')[0].endsWith(requestedPath)) {
                            const localPath = urlMap[key];
                            const fullLocalPath = path.join(ARCHIVES_DIR, archiveId, localPath);
                            if (fs.existsSync(fullLocalPath)) {
                                console.log(`🛡️ [Server Catch-All] Rescued parameterized API/Asset: ${requestedPath}`);
                                return res.sendFile(fullLocalPath);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("Error reading map for catch-all fallback:", e);
            }
        }
    }
    res.status(404).send('Not Found in Archive');
});

app.listen(PORT, () => {
    console.log(`\n🎉 Wayback Server is running!`);
    console.log(`👉 Open http://localhost:${PORT} in your browser.\n`);
});
