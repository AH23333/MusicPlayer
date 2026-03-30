const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const { app } = require("electron")
const logger = require("./logger")

function resolveMusicDlExecutablePath() {
  const candidates = []
  try {
    if (app && app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, "music-dl-api.exe"))
    }
  } catch (e) {}
  candidates.push(path.join(__dirname, "..", "..", "..", "music-dl-api.exe"))
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "music-dl-api.exe"))
  }
  const seen = new Set()
  for (const p of candidates) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    try {
      if (fs.existsSync(p)) {
        logger.info(`music-dl-api 路径: ${p}`)
        return p
      }
    } catch (e) {}
  }
  const fallback = path.join(__dirname, "..", "..", "..", "music-dl-api.exe")
  logger.warn(`music-dl-api 未在常见位置找到，将尝试: ${fallback}`)
  return fallback
}

class MusicDlService {
  constructor() {
    this.executablePath = null
    this.port = 1989
    this.process = null
  }

  // 启动服务
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.executablePath = resolveMusicDlExecutablePath()
        if (!fs.existsSync(this.executablePath)) {
          logger.warn(
            `未找到 music-dl-api.exe：${this.executablePath}，将跳过子进程（搜索可用 Meting；打包时请配置 extraResource）`
          )
          resolve()
          return
        }

        this.process = spawn(this.executablePath, [], {
          stdio: "ignore",
          detached: false,
          windowsHide: true,
        })

        this.process.on("error", (error) => {
          logger.error("音乐下载服务启动失败:", error)
          reject(error)
        })

        this.process.on("exit", (code) => {
          logger.info(`音乐下载服务退出，退出码: ${code}`)
          this.process = null
        })

        setTimeout(() => {
          resolve()
        }, 3000)
      } catch (error) {
        logger.error("启动音乐下载服务时出错:", error)
        reject(error)
      }
    })
  }

  // 停止服务
  async stop() {
    return new Promise((resolve, reject) => {
      try {
        if (this.process) {
          this.process.kill()
          this.process = null
          logger.info("音乐下载服务已停止")
        }
        resolve()
      } catch (error) {
        logger.error("停止音乐下载服务时出错:", error)
        reject(error)
      }
    })
  }

  // 检查服务是否正在运行
  isRunning() {
    return this.process !== null
  }

  // 获取服务的基础 URL
  getBaseUrl() {
    return `http://localhost:${this.port}`
  }
}

// 导出单例
module.exports = new MusicDlService()
