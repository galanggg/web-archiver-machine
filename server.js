const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 3000
const ARCHIVES_DIR = path.join(__dirname, 'archives')

if (!fs.existsSync(ARCHIVES_DIR)) fs.mkdirSync(ARCHIVES_DIR)

app.get('/', (req, res) => {
  let folders = fs
    .readdirSync(ARCHIVES_DIR)
    .filter((f) => fs.statSync(path.join(ARCHIVES_DIR, f)).isDirectory())

  folders.sort((a, b) => {
    const timeA = parseInt(a.split('_').pop()) || 0
    const timeB = parseInt(b.split('_').pop()) || 0
    return timeB - timeA
  })

  const cardsHtml = folders
    .map((folder) => {
      const metaPath = path.join(ARCHIVES_DIR, folder, 'metadata.json')

      let title = folder
      let originalUrl = ''
      let dateStr = 'Unknown Date'
      let statsHtml = ''

      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          title = meta.title || folder
          originalUrl = meta.originalUrl || ''
          dateStr =
            meta.formattedDate || new Date(meta.timestamp).toLocaleString()

          if (meta.totalPages || meta.totalAssets) {
            statsHtml = `<div class="stats-row">`
            if (meta.totalPages)
              statsHtml += `<span class="pill badge-blue">${meta.totalPages} Pages</span>`
            if (meta.totalAssets)
              statsHtml += `<span class="pill badge-gray">${meta.totalAssets} Assets</span>`
            statsHtml += `</div>`
          }
        } catch (e) {}
      }

      return `
            <a href="/view/${folder}/" class="card" target="_blank">
                <div class="card-icon">
                    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                </div>
                <div class="card-content">
                    <h2 class="domain" title="${title}">${title}</h2>
                    ${originalUrl ? `<p class="original-url">🔗 ${originalUrl}</p>` : ''}
                    <div class="date-row">
                        <p class="date">Captured: ${dateStr}</p>
                        ${statsHtml}
                    </div>
                </div>
                <div class="card-arrow">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </div>
            </a>
        `
    })
    .join('')

  res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Local Wayback Machine</title>
            <style>
                :root { --bg: #f8fafc; --text-main: #0f172a; --text-muted: #64748b; --card-bg: #ffffff; --primary: #3b82f6; --border: #e2e8f0; }
                body { font-family: system-ui, -apple-system, sans-serif; background-color: var(--bg); color: var(--text-main); margin: 0; padding: 2rem; }
                .container { max-width: 1000px; margin: 0 auto; }
                header { margin-bottom: 3rem; text-align: center; }
                h1 { font-size: 2.5rem; font-weight: 800; margin: 0; }
                .subtitle { color: var(--text-muted); font-size: 1.1rem; margin-top: 0.5rem; }
                .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }
                .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; display: flex; align-items: center; text-decoration: none; color: inherit; transition: all 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
                .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); border-color: #bfdbfe; }
                .card-icon { background: #eff6ff; color: var(--primary); padding: 0.75rem; border-radius: 10px; margin-right: 1.25rem; }
                .card-content { flex: 1; min-width: 0; }
                .domain { margin: 0 0 0.25rem 0; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .original-url { margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .date-row { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;}
                .date { margin: 0; font-size: 0.85rem; color: var(--text-muted); }
                .stats-row { display: flex; gap: 0.5rem; }
                .pill { font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 12px; }
                .badge-blue { background: #dbeafe; color: #1e40af; }
                .badge-gray { background: #f1f5f9; color: #475569; }
                .card-arrow { color: #cbd5e1; transition: color 0.2s; margin-left: 1rem; }
                .card:hover .card-arrow { color: var(--primary); }
            </style>
        </head>
        <body>
            <div class="container">
                <header><h1>Web Archiver</h1><p class="subtitle">Your personal, offline time machine.</p></header>
                <div class="grid">${cardsHtml || '<p>No archives found.</p>'}</div>
            </div>
        </body>
        </html>
    `)
})

app.use('/view', (req, res, next) => {
  const pathParts = req.path.split('/').filter(Boolean)
  if (pathParts.length === 0) return res.status(404).send('Archive ID missing')

  const archiveId = pathParts[0]
  const requestPath = pathParts.slice(1).join('/') || 'index.html'
  const fullPath = path.join(ARCHIVES_DIR, archiveId, requestPath)

  if (!fs.existsSync(fullPath)) return next()

  // Inject script into ALL .html files, not just index.html
  if (requestPath.endsWith('.html') || requestPath === 'index.html') {
    let htmlContent = fs.readFileSync(fullPath, 'utf-8')
    let urlMap = {}
    try {
      urlMap = JSON.parse(
        fs.readFileSync(
          path.join(ARCHIVES_DIR, archiveId, 'urlMap.json'),
          'utf-8',
        ),
      )
    } catch (e) {}

    const scriptToInject = `
        <script>
            console.log('[Wayback Server] Offline Interceptor Active for ' + window.location.pathname);
            window.__ARCHIVE_ID__ = '${archiveId}';
            window.__URL_MAP__ = ${JSON.stringify(urlMap)};

            function findLocalMap(requestUrl) {
                if(!requestUrl) return null;
                const keys = Object.keys(window.__URL_MAP__);
                if (window.__URL_MAP__[requestUrl]) return window.__URL_MAP__[requestUrl];
                try {
                    const reqUrlObj = new URL(requestUrl, window.location.origin);
                    const reqPathname = reqUrlObj.pathname;
                    for (let key of keys) {
                        try {
                            if (new URL(key).pathname === reqPathname) return window.__URL_MAP__[key];
                        } catch(e) {}
                    }
                } catch(e) {}
                let searchStr = requestUrl.split('?')[0];
                for(let key of keys) {
                    if(key.split('?')[0].endsWith(searchStr)) return window.__URL_MAP__[key];
                }
                return null;
            }

            const originalFetch = window.fetch;
            window.fetch = async function() {
                let urlStr = typeof arguments[0] === 'string' ? arguments[0] : arguments[0].url;
                let localPath = findLocalMap(urlStr);
                if (localPath) arguments[0] = '/view/' + window.__ARCHIVE_ID__ + '/' + localPath;
                return originalFetch.apply(this, arguments);
            };

            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                let localPath = findLocalMap(url.toString());
                if (localPath) url = '/view/' + window.__ARCHIVE_ID__ + '/' + localPath;
                return originalOpen.call(this, method, url, ...rest);
            };

            let observer;
            function startObserving() {
                if(!document.body) return;
                observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.type === 'attributes' && ['src', 'srcset', 'href'].includes(mutation.attributeName)) {
                            const el = mutation.target;
                            const currentVal = el.getAttribute(mutation.attributeName);
                            if (!currentVal || currentVal.startsWith('/view/') || currentVal.startsWith('data:')) return;

                            let localPath = findLocalMap(currentVal);
                            if (localPath) {
                                observer.disconnect();
                                if (mutation.attributeName === 'srcset') {
                                    el.setAttribute('srcset', currentVal.split(',').map(part => {
                                        const p = part.trim().split(/\\s+/);
                                        let lp = findLocalMap(p[0]);
                                        return lp ? '/view/' + window.__ARCHIVE_ID__ + '/' + lp + (p[1] ? ' ' + p[1] : '') : part;
                                    }).join(', ');
                                } else {
                                    el.setAttribute(mutation.attributeName, '/view/' + window.__ARCHIVE_ID__ + '/' + localPath);
                                }
                                startObserving();
                            }
                        }
                    });
                });
                observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'href'] });
            }
            window.addEventListener('DOMContentLoaded', startObserving);
        </script>
        `

    htmlContent = htmlContent.replace('<head>', '<head>\n' + scriptToInject)
    res.setHeader('Content-Type', 'text/html')
    return res.send(htmlContent)
  }
  res.sendFile(fullPath)
})

app.use((req, res, next) => {
  const referer = req.get('referer')
  if (referer && referer.includes('/view/')) {
    const match = referer.match(/\/view\/([^\/]+)/)
    if (match) {
      const archiveId = match[1]
      try {
        const urlMap = JSON.parse(
          fs.readFileSync(
            path.join(ARCHIVES_DIR, archiveId, 'urlMap.json'),
            'utf-8',
          ),
        )
        const requestedPath = req.path
        for (let key in urlMap) {
          try {
            const keyUrlObj = new URL(key)
            if (
              keyUrlObj.pathname === requestedPath ||
              keyUrlObj.pathname.endsWith(requestedPath)
            ) {
              const fullLocalPath = path.join(
                ARCHIVES_DIR,
                archiveId,
                urlMap[key],
              )
              if (fs.existsSync(fullLocalPath))
                return res.sendFile(fullLocalPath)
            }
          } catch (e) {
            if (key.split('?')[0].endsWith(requestedPath)) {
              const fullLocalPath = path.join(
                ARCHIVES_DIR,
                archiveId,
                urlMap[key],
              )
              if (fs.existsSync(fullLocalPath))
                return res.sendFile(fullLocalPath)
            }
          }
        }
      } catch (e) {}
    }
  }
  res.status(404).send('Not Found in Archive')
})

app.listen(PORT, () => {
  console.log(`\n🎉 Wayback Server is running at http://localhost:${PORT}\n`)
})
