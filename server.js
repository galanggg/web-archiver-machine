const express = require('express')
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const archiverLib = require('archiver')

const app = express()
const PORT = process.env.PORT || 3000
const ARCHIVES_DIR = path.join(__dirname, 'archives')

if (!fs.existsSync(ARCHIVES_DIR))
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true })

// Template Caching: Read once on startup
let indexTemplate = ''
let cardTemplate = ''
try {
  indexTemplate = fs.readFileSync(
    path.join(__dirname, 'public', 'index.html'),
    'utf-8',
  )
  cardTemplate = fs.readFileSync(
    path.join(__dirname, 'public', 'card.html'),
    'utf-8',
  )
} catch (e) {
  console.error(
    "❌ Failed to load HTML templates. Ensure 'public/index.html' and 'public/card.html' exist.",
  )
  process.exit(1)
}

// Route 1: The Web UI Dashboard
app.get('/', async (req, res) => {
  try {
    const entries = await fsp.readdir(ARCHIVES_DIR, { withFileTypes: true })
    const folders = entries.filter((f) => f.isDirectory()).map((f) => f.name)

    // Parallelize reading stats to sort folders
    const folderStats = await Promise.all(
      folders.map(async (folder) => {
        try {
          const time = parseInt(folder.split('_').pop()) || 0
          return { folder, time }
        } catch (e) {
          return { folder, time: 0 }
        }
      }),
    )

    folderStats.sort((a, b) => b.time - a.time)

    // Parallelize reading metadata
    const cardsData = await Promise.all(
      folderStats.map(async ({ folder }) => {
        const metaPath = path.join(ARCHIVES_DIR, folder, 'metadata.json')

        let title = folder
        let originalUrl = ''
        let dateStr = 'Unknown Date'
        let statsHtml = ''

        try {
          const metaStr = await fsp.readFile(metaPath, 'utf-8')
          const meta = JSON.parse(metaStr)
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
        } catch (e) {
          // Ignore missing or malformed metadata
        }

        let card = cardTemplate.replace(/{{TITLE}}/g, title)
        const originalUrlP = originalUrl
          ? `<p class="original-url">🔗 ${originalUrl}</p>`
          : ''
        card = card.replace('{{ORIGINAL_URL_P}}', originalUrlP)
        card = card.replace('{{DATE_STR}}', dateStr)
        card = card.replace('{{STATS_HTML}}', statsHtml)
        card = card.replace(/{{FOLDER}}/g, folder)

        return card
      }),
    )

    const cardsHtml = cardsData.join('')
    const finalHtml = indexTemplate.replace(
      '{{CARDS_HTML}}',
      cardsHtml || '<p>No archives found.</p>',
    )
    res.send(finalHtml)
  } catch (error) {
    console.error('❌ Error building dashboard:', error)
    res.status(500).send('Sorry, an error occurred.')
  }
})

// Route 2: The Dynamic Zip Downloader
app.get('/download/:archiveId', async (req, res) => {
  const archiveId = req.params.archiveId
  const folderPath = path.join(ARCHIVES_DIR, archiveId)

  try {
    await fsp.access(folderPath)
  } catch (err) {
    return res.status(404).send('Archive not found')
  }

  res.attachment(`${archiveId}.zip`)
  // Optimization: Reduce compression level from 9 to 5 to save CPU and reduce freezing
  const archive = archiverLib('zip', { zlib: { level: 5 } })

  archive.on('error', (err) => {
    res.status(500).send({ error: err.message })
  })

  archive.pipe(res)
  archive.directory(folderPath, false)
  archive.finalize()
})

// Route 3: Simplified Static File Serving
app.use('/view', (req, res, next) => {
  const pathParts = req.path.split('/').filter(Boolean)
  if (pathParts.length === 0) return res.status(404).send('Archive ID missing')

  const archiveId = pathParts[0]
  const requestPath = pathParts.slice(1).join('/') || 'index.html'
  const fullPath = path.join(ARCHIVES_DIR, archiveId, requestPath)

  // Use fs.access instead of fs.existsSync
  fs.access(fullPath, fs.constants.F_OK, (err) => {
    if (err) return next()
    return res.sendFile(fullPath)
  })
})

// Route 4: Catch-All Server Fallback (Handles internal SPA routing)
app.use(async (req, res, next) => {
  const referer = req.get('referer')
  if (referer && referer.includes('/view/')) {
    const match = referer.match(/\/view\/([^\/]+)/)
    if (match) {
      const archiveId = match[1]
      try {
        const urlMapStr = await fsp.readFile(
          path.join(ARCHIVES_DIR, archiveId, 'urlMap.json'),
          'utf-8',
        )
        const urlMap = JSON.parse(urlMapStr)
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
              try {
                await fsp.access(fullLocalPath)
                return res.sendFile(fullLocalPath)
              } catch (e) {}
            }
          } catch (e) {
            if (key.split('?')[0].endsWith(requestedPath)) {
              const fullLocalPath = path.join(
                ARCHIVES_DIR,
                archiveId,
                urlMap[key],
              )
              try {
                await fsp.access(fullLocalPath)
                return res.sendFile(fullLocalPath)
              } catch (e) {}
            }
          }
        }
      } catch (e) {
        // Fall through
      }
    }
  }
  res.status(404).send('Not Found in Archive')
})

app.listen(PORT, () => {
  console.log(`\n🎉 Wayback Server is running at http://localhost:${PORT}\n`)
})
