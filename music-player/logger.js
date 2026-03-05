// logger.js 完整最终版（当前目录生成 log.txt，无 app 依赖）
const fs = require("fs")
const path = require("path")

// 日志文件生成在项目根目录（和 main.js 同目录）
const LOG_FILE_PATH = path.join(__dirname, "log.txt")

// 初始化日志文件
function initLogFile() {
  const logDir = path.dirname(LOG_FILE_PATH)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  // 每次启动清空旧日志（可选注释）
  if (fs.existsSync(LOG_FILE_PATH)) {
    fs.writeFileSync(LOG_FILE_PATH, "", { encoding: "utf8" })
  }
}

// 写入日志（带中文时间戳，UTF-8 无乱码）
function writeLog(type, message) {
  const timestamp = new Date().toLocaleString("zh-CN")
  const logContent = `[${timestamp}] [${type}] ${message}\n`
  fs.appendFileSync(LOG_FILE_PATH, logContent, { encoding: "utf8" })
}

module.exports = {
  init: initLogFile,
  info: (msg) => writeLog("INFO", msg),
  warn: (msg) => writeLog("WARN", msg),
  error: (msg) => writeLog("ERROR", msg),
}
