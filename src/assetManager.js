const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function createResponseHandler(dirs, urlMap) {
  return async (response) => {
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
  }
}

module.exports = { createResponseHandler }
