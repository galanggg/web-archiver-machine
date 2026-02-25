const { runArchive } = require('./src/crawler')

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

// --- 2. The Scheduling Execution Logic ---
if (scheduleIntervalMinutes > 0) {
  console.log(
    `\n⏰ Scheduled mode activated! Archiving every ${scheduleIntervalMinutes} minutes.`,
  )
  runArchive(targetUrl, MAX_DEPTH)
  setInterval(
    () => {
      console.log(`\n======================================================`)
      console.log(
        `⏰ [SCHEDULED RUN] Starting automated archive for ${targetUrl}`,
      )
      console.log(`======================================================`)
      runArchive(targetUrl, MAX_DEPTH)
    },
    scheduleIntervalMinutes * 60 * 1000,
  )
} else {
  runArchive(targetUrl, MAX_DEPTH)
}
