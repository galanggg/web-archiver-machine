const puppeteer = require('puppeteer')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const cheerio = require('cheerio')

// --- 1. CLI Argument Parsing ---
const args = process.argv.slice(2)
const targetUrl = args[0]
const MAX_DEPTH = 1 // 0 = Homepage only. 1 = Homepage + 1 click deep.

if (!targetUrl) {
  console.error('❌ Please provide a URL to archive.')
  process.exit(1)
}

// Check for the --schedule flag
let scheduleIntervalMinutes = 0
const scheduleIdx = args.indexOf('--schedule')
if (scheduleIdx !== -1 && args[scheduleIdx + 1]) {
  scheduleIntervalMinutes = parseInt(args[scheduleIdx + 1], 10)
}

// --- 2. The Reusable Archiver Function ---
async function runArchive(startUrl) {
  let parsedUrl
  try {
    parsedUrl = new URL(startUrl)
  } catch (err) {
    console.error(`❌ Invalid URL provided: ${startUrl}`)
    return
  }

  const baseDomain = parsedUrl.hostname
  const domainClean = baseDomain.replace(/[^a-z0-9]/gi, '_')

  const timestamp = Date.now()
  const archiveDir = path.join(
    __dirname,
    'archives',
    `${domainClean}_${timestamp}`,
  )
  const assetsDir = path.join(archiveDir, 'assets')

  const dirs = {
    html: archiveDir,
    css: path.join(assetsDir, 'css'),
    js: path.join(assetsDir, 'js'),
    media: path.join(assetsDir, 'media'),
    api: path.join(assetsDir, 'api'),
  }

  Object.values(dirs).forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })

  const urlMap = new Map()
  console.log(`\n📂 Created new archive directory: ${archiveDir}`)

  function getLocalHtmlPath(pageUrl) {
    try {
      const urlObj = new URL(pageUrl)
      if (urlObj.hostname !== baseDomain) return pageUrl

      let pathname = urlObj.pathname
      if (pathname === '/' || pathname === '') return 'index.html'

      let name = pathname
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^a-zA-Z0-9-]/g, '_')
      if (name === '') return 'index.html'
      if (!name.endsWith('.html')) name += '.html'

      if (urlObj.search) {
        const hash = crypto
          .createHash('md5')
          .update(urlObj.search)
          .digest('hex')
          .slice(0, 4)
        name = name.replace('.html', `_${hash}.html`)
      }
      return name
    } catch (e) {
      return pageUrl
    }
  }

  console.log('🚀 Launching automated headless crawler...')
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    )
    await page.setRequestInterception(true)

    let isClickingPhase = false

    page.on('request', (request) => {
      if (
        isClickingPhase &&
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        request.abort()
      } else {
        request.continue()
      }
    })

    page.on('response', async (response) => {
      const url = response.url()
      const status = response.status()

      if (
        status >= 300 ||
        url.startsWith('data:') ||
        response.request().method() === 'OPTIONS'
      )
        return

      const resourceType = response.request().resourceType()
      const contentType = response.headers()['content-type'] || ''

      let subDir = null
      if (resourceType === 'stylesheet' || contentType.includes('text/css'))
        subDir = 'css'
      else if (resourceType === 'script' || contentType.includes('javascript'))
        subDir = 'js'
      else if (
        ['image', 'media', 'font'].includes(resourceType) ||
        contentType.includes('image/') ||
        contentType.includes('font/')
      )
        subDir = 'media'
      else if (
        resourceType === 'xhr' ||
        resourceType === 'fetch' ||
        contentType.includes('application/json')
      )
        subDir = 'api'

      if (subDir) {
        try {
          const buffer = await response.buffer()
          const reqUrl = new URL(url)
          let filename = path.basename(reqUrl.pathname)
          if (!filename || subDir === 'api') filename = 'data'

          const hash = crypto
            .createHash('md5')
            .update(url)
            .digest('hex')
            .slice(0, 8)
          const ext = subDir === 'api' ? '.json' : path.extname(filename)
          const baseName = path.basename(filename, ext)

          const finalFilename = `${baseName}_${hash}${ext || '.bin'}`
          const savePath = path.join(dirs[subDir], finalFilename)

          if (!urlMap.has(url)) {
            fs.writeFileSync(savePath, buffer)
            const relativePath = `assets/${subDir}/${finalFilename}`
            urlMap.set(url, relativePath)
          }
        } catch (err) {}
      }
    })

    const queue = [{ url: startUrl, depth: 0 }]
    const visitedPages = new Set()
    let mainPageTitle = ''
    let pagesArchived = 0

    console.log(`\n🕷️ Starting Crawl with Max Depth: ${MAX_DEPTH}`)

    while (queue.length > 0) {
      const currentItem = queue.shift()
      const cleanUrl = currentItem.url.split('#')[0]

      if (visitedPages.has(cleanUrl)) continue
      visitedPages.add(cleanUrl)

      const htmlFilename = getLocalHtmlPath(cleanUrl)
      if (htmlFilename === cleanUrl) continue

      console.log(`\n======================================================`)
      console.log(`🌐 [Depth ${currentItem.depth}] Archiving: ${cleanUrl}`)
      console.log(`💾 Saving as: ${htmlFilename}`)
      console.log(`======================================================`)

      isClickingPhase = false

      try {
        await page.goto(cleanUrl, { waitUntil: 'networkidle2', timeout: 60000 })

        if (pagesArchived === 0) {
          mainPageTitle = await page.title()
        }

        const pristineHtml = await page.content()

        if (currentItem.depth < MAX_DEPTH) {
          const links = await page.$$eval('a', (anchors) =>
            anchors.map((a) => a.href),
          )
          for (let link of links) {
            try {
              const absUrl = new URL(link, cleanUrl).href.split('#')[0]
              const urlObj = new URL(absUrl)
              if (urlObj.hostname === baseDomain && !visitedPages.has(absUrl)) {
                if (
                  !absUrl.match(/\.(png|jpg|jpeg|gif|css|js|pdf|zip|mp4)$/i)
                ) {
                  queue.push({ url: absUrl, depth: currentItem.depth + 1 })
                }
              }
            } catch (e) {}
          }
          console.log(
            `📥 Added new links to queue. Items remaining: ${queue.length}`,
          )
        }

        isClickingPhase = true
        await page.evaluate(async () => {
          document.addEventListener(
            'click',
            (e) => {
              const target = e.target.closest('a, form')
              if (target) e.preventDefault()
            },
            { capture: true },
          )

          const clickables = document.querySelectorAll(
            'button, [role="tab"], [role="button"]',
          )
          for (let el of clickables) {
            try {
              const rect = el.getBoundingClientRect()
              if (rect.width > 0 && rect.height > 0) {
                el.click()
                await new Promise((r) => setTimeout(r, 300))
              }
            } catch (err) {}
          }
        })
        await new Promise((resolve) => setTimeout(resolve, 2000))

        // Added { decodeEntities: false } to prevent Cheerio from mutating framework inline JSON scripts (React/Vue fixes)
        const $ = cheerio.load(pristineHtml, { decodeEntities: false })

        const rewriteAssetUrl = (originalUrl) => {
          if (
            !originalUrl ||
            originalUrl.startsWith('data:') ||
            originalUrl.startsWith('#')
          )
            return originalUrl
          try {
            const cleanOriginal = originalUrl.replace(/&amp;/g, '&')
            const absoluteUrl = new URL(cleanOriginal, cleanUrl).href

            if (urlMap.has(absoluteUrl)) return urlMap.get(absoluteUrl)

            const decodedAbsolute = decodeURIComponent(absoluteUrl)
            for (let [key, value] of urlMap.entries()) {
              if (decodeURIComponent(key) === decodedAbsolute) return value
            }

            // Disable query-stripping for dynamic Next.js images
            if (
              !absoluteUrl.includes('/_next/image') &&
              !absoluteUrl.includes('?url=')
            ) {
              const urlWithoutQuery = absoluteUrl.split('?')[0]
              for (let [key, value] of urlMap.entries()) {
                if (key.split('?')[0] === urlWithoutQuery) return value
              }
            }
          } catch (e) {}
          return originalUrl
        }

        const processCssText = (text) => {
          if (!text) return text
          return text.replace(
            /url\((['"]?)(.*?)\1\)/gi,
            (match, quote, innerUrl) => {
              if (innerUrl.startsWith('data:') || innerUrl.startsWith('#'))
                return match
              try {
                const absoluteUrl = new URL(innerUrl, cleanUrl).href
                const localPath = rewriteAssetUrl(absoluteUrl)
                return `url(${quote}${localPath}${quote})`
              } catch (e) {
                return match
              }
            },
          )
        }

        $('style').each((i, el) => {
          const cssText = $(el).html()
          if (cssText && cssText.includes('url(')) {
            $(el).html(processCssText(cssText))
          }
        })

        $('[style]').each((i, el) => {
          const styleText = $(el).attr('style')
          if (styleText && styleText.includes('url(')) {
            $(el).attr('style', processCssText(styleText))
          }
        })

        $('img, script, audio, video, iframe, source').each((i, el) => {
          const src = $(el).attr('src')
          if (src) $(el).attr('src', rewriteAssetUrl(src))
          const srcset = $(el).attr('srcset')
          if (srcset) {
            $(el).attr(
              'srcset',
              srcset
                .split(',')
                .map((part) => {
                  const parts = part.trim().split(/\s+/)
                  return `${rewriteAssetUrl(parts[0])}${parts.length > 1 ? ` ${parts[1]}` : ''}`
                })
                .join(', '),
            )
          }
        })

        $('link').each((i, el) => {
          const href = $(el).attr('href')
          if (href) $(el).attr('href', rewriteAssetUrl(href))
        })

        $('a').each((i, el) => {
          const href = $(el).attr('href')
          if (
            href &&
            !href.startsWith('javascript:') &&
            !href.startsWith('mailto:')
          ) {
            try {
              const absUrl = new URL(href, cleanUrl).href.split('#')[0]
              const urlObj = new URL(absUrl)
              if (urlObj.hostname === baseDomain) {
                const localHtml = getLocalHtmlPath(absUrl)
                $(el).attr('href', localHtml)
              }
            } catch (e) {}
          }
        })

        fs.writeFileSync(path.join(dirs.html, htmlFilename), $.html())
        console.log(`✅ Saved ${htmlFilename}`)
        pagesArchived++
      } catch (err) {
        console.error(`❌ Error archiving ${cleanUrl}: ${err.message}`)
      }
    }

    const mapData = Object.fromEntries(urlMap)
    fs.writeFileSync(
      path.join(archiveDir, 'urlMap.json'),
      JSON.stringify(mapData, null, 2),
    )

    // --- NEW: BURN IN THE STANDALONE INTERCEPTOR ---
    console.log(
      `\n⚙️ Burning standalone offline interceptor into HTML files...`,
    )

    // We replace < characters in the JSON to prevent XSS/script-breaking during injection
    const standaloneScript = `
        <script>
            console.log('[Standalone Archiver] Offline Interceptor Active');
            window.__URL_MAP__ = ${JSON.stringify(mapData).replace(/</g, '\\u003c')};

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
                // Standalone uses relative paths from the current HTML file
                if (localPath) arguments[0] = './' + localPath;
                return originalFetch.apply(this, arguments);
            };

            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                let localPath = findLocalMap(url.toString());
                if (localPath) url = './' + localPath;
                return originalOpen.call(this, method, url, ...rest);
            };

            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && ['src', 'srcset', 'href'].includes(mutation.attributeName)) {
                        const el = mutation.target;
                        const currentVal = el.getAttribute(mutation.attributeName);
                        // Prevent infinite loops by ignoring data URIs and already-rewritten relative paths
                        if (!currentVal || currentVal.startsWith('data:') || currentVal.startsWith('./')) return;

                        let localPath = findLocalMap(currentVal);
                        if (localPath) {
                            observer.disconnect();
                            if (mutation.attributeName === 'srcset') {
                                el.setAttribute('srcset', currentVal.split(',').map(part => {
                                    const p = part.trim().split(/\\s+/);
                                    let lp = findLocalMap(p[0]);
                                    return lp ? './' + lp + (p[1] ? ' ' + p[1] : '') : part;
                                }).join(', '));
                            } else {
                                el.setAttribute(mutation.attributeName, './' + localPath);
                            }
                            startObserving();
                        }
                    }

                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) {
                                const processNode = (el) => {
                                    ['src', 'href'].forEach(attr => {
                                        if (el.hasAttribute && el.hasAttribute(attr)) {
                                            const val = el.getAttribute(attr);
                                            if (val && !val.startsWith('data:') && !val.startsWith('./')) {
                                                let local = findLocalMap(val);
                                                if (local) {
                                                    observer.disconnect();
                                                    el.setAttribute(attr, './' + local);
                                                    startObserving();
                                                }
                                            }
                                        }
                                    });
                                };

                                processNode(node);
                                if (node.querySelectorAll) {
                                    node.querySelectorAll('[src], [href]').forEach(processNode);
                                }
                            }
                        });
                    }
                });
            });

            function startObserving() {
                if(!document.documentElement) return;
                observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'href'] });
            }

            startObserving();
            window.addEventListener('DOMContentLoaded', startObserving);
        </script>
        `

    // Inject the script into EVERY saved HTML file so multi-page crawls work perfectly standalone
    const htmlFiles = fs
      .readdirSync(dirs.html)
      .filter((file) => file.endsWith('.html'))
    for (const file of htmlFiles) {
      const filePath = path.join(dirs.html, file)
      let content = fs.readFileSync(filePath, 'utf-8')
      if (content.includes('<head>')) {
        content = content.replace('<head>', '<head>\n' + standaloneScript)
      } else {
        content = standaloneScript + '\n' + content // Fallback if no head exists
      }
      fs.writeFileSync(filePath, content)
      console.log(`💉 Injected standalone brain into ${file}`)
    }

    const metadata = {
      id: `${domainClean}_${timestamp}`,
      originalUrl: startUrl,
      title: mainPageTitle || baseDomain,
      timestamp: timestamp,
      formattedDate: new Date(timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      totalAssets: urlMap.size,
      totalPages: pagesArchived,
    }
    fs.writeFileSync(
      path.join(archiveDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
    )

    console.log(
      `\n🎉 Archiving complete! Saved ${pagesArchived} pages and ${urlMap.size} assets.`,
    )
  } catch (error) {
    console.error(`❌ Fatal error during archiving: ${error}`)
  } finally {
    await browser.close()
  }
}

// --- 3. The Scheduling Execution Logic ---
if (scheduleIntervalMinutes > 0) {
  console.log(
    `\n⏰ Scheduled mode activated! Archiving every ${scheduleIntervalMinutes} minutes.`,
  )
  runArchive(targetUrl)
  setInterval(
    () => {
      console.log(`\n======================================================`)
      console.log(
        `⏰ [SCHEDULED RUN] Starting automated archive for ${targetUrl}`,
      )
      console.log(`======================================================`)
      runArchive(targetUrl)
    },
    scheduleIntervalMinutes * 60 * 1000,
  )
} else {
  runArchive(targetUrl)
}
