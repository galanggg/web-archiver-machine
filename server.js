const express = require('express')
const fs = require('fs')
const path = require('path')
const archiverLib = require('archiver')

const app = express()
const PORT = 3000
const ARCHIVES_DIR = path.join(__dirname, 'archives')

if (!fs.existsSync(ARCHIVES_DIR)) fs.mkdirSync(ARCHIVES_DIR)

// Route 1: The Web UI Dashboard
app.get('/', (req, res) => {
  const cardTemplate = fs.readFileSync(path.join(__dirname, 'public', 'card.html'), 'utf-8');

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

      let card = cardTemplate.replace(/{{TITLE}}/g, title);
      const originalUrlP = originalUrl ? `<p class="original-url">🔗 ${originalUrl}</p>` : '';
      card = card.replace('{{ORIGINAL_URL_P}}', originalUrlP);
      card = card.replace('{{DATE_STR}}', dateStr);
      card = card.replace('{{STATS_HTML}}', statsHtml);
      card = card.replace(/{{FOLDER}}/g, folder);
      
      return card
    })
    .join('')

  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf-8', (err, html) => {
    if (err) {
      res.status(500).send("Sorry, an error occurred.")
      return
    }

    const finalHtml = html.replace('{{CARDS_HTML}}', cardsHtml || '<p>No archives found.</p>')
    res.send(finalHtml)
  })
})


// Route 2: The Dynamic Zip Downloader
app.get('/download/:archiveId', (req, res) => {
  const archiveId = req.params.archiveId
  const folderPath = path.join(ARCHIVES_DIR, archiveId)

  if (!fs.existsSync(folderPath)) {
    return res.status(404).send('Archive not found')
  }

  res.attachment(`${archiveId}.zip`)
  const archive = archiverLib('zip', { zlib: { level: 9 } })

  archive.on('error', (err) => {
    res.status(500).send({ error: err.message })
  })

  archive.pipe(res)
  archive.directory(folderPath, false)
  archive.finalize()
})

// Route 3: Simplified Static File Serving
// No more dynamic injection needed because archiver.js does it permanently!
app.use('/view', (req, res, next) => {
  const pathParts = req.path.split('/').filter(Boolean)
  if (pathParts.length === 0) return res.status(404).send('Archive ID missing')

  const archiveId = pathParts[0]
  const requestPath = pathParts.slice(1).join('/') || 'index.html'
  const fullPath = path.join(ARCHIVES_DIR, archiveId, requestPath)

  if (!fs.existsSync(fullPath)) return next()

  return res.sendFile(fullPath)
})

// Route 4: Catch-All Server Fallback (Handles internal SPA routing)
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
