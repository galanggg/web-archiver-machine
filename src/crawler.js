const puppeteer = require('puppeteer')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { processHtml } = require('./htmlProcessor')
const { createResponseHandler } = require('./assetManager')

async function runArchive(startUrl, MAX_DEPTH = 1) {
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
  // Adjust archiveDir path to be relative to the project root (up one level from src/)
  const archiveDir = path.join(
    __dirname,
    '..',
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
  console.log(`
📂 Created new archive directory: ${archiveDir}`)

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

    page.on('response', createResponseHandler(dirs, urlMap))

    const queue = [{ url: startUrl, depth: 0 }]
    const visitedPages = new Set()
    let mainPageTitle = ''
    let pagesArchived = 0

    console.log(`
🕷️ Starting Crawl with Max Depth: ${MAX_DEPTH}`)

    while (queue.length > 0) {
      const currentItem = queue.shift()
      const cleanUrl = currentItem.url.split('#')[0]

      if (visitedPages.has(cleanUrl)) continue
      visitedPages.add(cleanUrl)

      const htmlFilename = getLocalHtmlPath(cleanUrl)
      if (htmlFilename === cleanUrl) continue

      console.log(`
======================================================`)
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

        const rewrittenHtml = processHtml(
          pristineHtml,
          cleanUrl,
          urlMap,
          baseDomain,
          getLocalHtmlPath,
        )
        fs.writeFileSync(path.join(dirs.html, htmlFilename), rewrittenHtml)
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
    console.log(`⚙️ Burning standalone offline interceptor into HTML files...`)

    // We replace < characters in the JSON to prevent XSS/script-breaking during injection
    const standaloneScriptTemplate = fs.readFileSync(
      path.join(__dirname, 'interceptor.template.html'),
      'utf-8',
    )
    const standaloneScript = standaloneScriptTemplate.replace(
      '{{URL_MAP_PLACEHOLDER}}',
      JSON.stringify(mapData).replace(/</g, '\u003c'),
    )

    // Inject the script into EVERY saved HTML file so multi-page crawls work perfectly standalone
    const htmlFiles = fs
      .readdirSync(dirs.html)
      .filter((file) => file.endsWith('.html'))
    for (const file of htmlFiles) {
      const filePath = path.join(dirs.html, file)
      let content = fs.readFileSync(filePath, 'utf-8')
      if (content.includes('<head>')) {
        content = content.replace('<head>', '<head>' + standaloneScript)
      } else {
        content = standaloneScript + '' + content // Fallback if no head exists
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
      `
🎉 Archiving complete! Saved ${pagesArchived} pages and ${urlMap.size} assets.`,
    )
  } catch (error) {
    console.error(`❌ Fatal error during archiving: ${error}`)
  } finally {
    await browser.close()
  }
}

module.exports = { runArchive }
