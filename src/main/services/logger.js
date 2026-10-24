const fs = require("fs")
const path = require("path")

// 日志文件生成在项目根目录（和 main.js 同目录）
const LOG_FILE_PATH = path.join(__dirname, "..", "..", "..", "log.txt")

// 单行日志上限，防止 JSON.stringify 大对象撑爆日志文件
const MAX_LINE_LENGTH = 2000
// 缓冲条数上限，达到即立即刷盘
const MAX_BUFFER_SIZE = 50
// 定时刷盘间隔
const FLUSH_INTERVAL_MS = 500

let buffer = []
let flushTimer = null

// 初始化日志文件
function initLogFile() {
  const logDir = path.dirname(LOG_FILE_PATH)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  // 不再清空旧日志，直接续写
  if (!fs.existsSync(LOG_FILE_PATH)) {
    fs.writeFileSync(LOG_FILE_PATH, "", { encoding: "utf8" })
  }
}

function truncate(message) {
  const msg = String(message)
  if (msg.length <= MAX_LINE_LENGTH) return msg
  return msg.slice(0, MAX_LINE_LENGTH) + `…(+${msg.length - MAX_LINE_LENGTH} chars)`
}

// 异步刷盘：批量 appendFile，避免每条日志一次同步 IO 阻塞主进程
function flushLogFile() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (buffer.length === 0) return
  const data = buffer.join("")
  buffer = []
  fs.appendFile(LOG_FILE_PATH, data, "utf8", (err) => {
    if (err) console.error(`日志写入失败：${err.message}`)
  })
}

// 退出前同步刷盘，保证缓冲区不丢失
function flushSync() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (buffer.length === 0) return
  const data = buffer.join("")
  buffer = []
  try {
    fs.appendFileSync(LOG_FILE_PATH, data, "utf8")
  } catch (err) {
    console.error(`日志写入失败：${err.message}`)
  }
}

// 写入日志（带中文时间戳，UTF-8 无乱码）
function writeLog(type, message) {
  const timestamp = new Date().toLocaleString("zh-CN")
  const logContent = `[${timestamp}] [${type}] ${truncate(message)}\n`
  buffer.push(logContent)
  if (buffer.length >= MAX_BUFFER_SIZE) {
    flushLogFile()
    return
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flushLogFile, FLUSH_INTERVAL_MS)
  }
}

module.exports = {
  init: initLogFile,
  info: (msg) => writeLog("INFO", msg),
  warn: (msg) => writeLog("WARN", msg),
  error: (msg) => writeLog("ERROR", msg),
  flush: flushLogFile,
  flushSync: flushSync,
}
