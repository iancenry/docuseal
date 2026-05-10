'use strict'

const puppeteer = require('puppeteer')

async function main() {
  let data = ''

  process.stdin.setEncoding('utf-8')

  for await (const chunk of process.stdin) {
    data += chunk
  }

  const input = JSON.parse(data)
  const html = input.html
  const format = input.format || 'A4'

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage'
    ]
  })

  try {
    const page = await browser.newPage()

    // Match A4 print dimensions (210mm x 297mm at 96 CSS DPI) for accurate field positioning
    await page.setViewport({ width: 794, height: 1123 })

    // Block external resource requests to prevent SSRF
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (url.startsWith('data:') || url === 'about:blank') {
        req.continue()
      } else {
        req.abort('blockedbyclient')
      }
    })

    // Use print media for layout to match page.pdf() rendering
    await page.emulateMediaType('print')

    await page.setContent(html, { waitUntil: 'load', timeout: 30000 })

    // Get field positions from the rendered DOM
    const fieldData = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-docuseal-field]')

      return Array.from(els).map((el) => {
        const rect = el.getBoundingClientRect()

        return {
          name: el.getAttribute('data-docuseal-field'),
          type: el.getAttribute('data-field-type') || 'text',
          index: parseInt(el.getAttribute('data-field-index'), 10),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      })
    })

    // Remove field marker text but preserve the space
    await page.evaluate(() => {
      document.querySelectorAll('[data-docuseal-field]').forEach((el) => {
        el.textContent = '\u00A0'
        el.style.color = 'transparent'
        el.style.border = 'none'
        el.style.background = 'none'
      })
    })

    // Render PDF
    const pdf = await page.pdf({
      format,
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
    })

    const result = {
      fields: fieldData,
      pdf: Buffer.from(pdf).toString('base64')
    }

    process.stdout.write(JSON.stringify(result))
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  process.stderr.write(String(err.stack || err.message || err))
  process.exit(1)
})
