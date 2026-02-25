const cheerio = require('cheerio')

function processHtml(
  pristineHtml,
  cleanUrl,
  urlMap,
  baseDomain,
  getLocalHtmlPath,
) {
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
    return text.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, innerUrl) => {
      if (innerUrl.startsWith('data:') || innerUrl.startsWith('#')) return match
      try {
        const absoluteUrl = new URL(innerUrl, cleanUrl).href
        const localPath = rewriteAssetUrl(absoluteUrl)
        return `url(${quote}${localPath}${quote})`
      } catch (e) {
        return match
      }
    })
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

  return $.html()
}

module.exports = { processHtml }
