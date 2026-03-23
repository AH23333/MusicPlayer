const { spawn } = require("child_process")
const path = require("path")
const logger = require("./logger")

class MusicDlService {
  constructor() {
    this.executablePath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "music-dl-api.exe"
    )
    this.port = 1989
    this.process = null
  }

  // 启动服务
  async start() {
    return new Promise((resolve, reject) => {
      try {
        // 启动服务
        this.process = spawn(this.executablePath, {
          stdio: "inherit",
          detached: true,
        })

        // 监听错误
        this.process.on("error", (error) => {
          logger.error("音乐下载服务启动失败:", error)
          reject(error)
        })

        // 监听退出
        this.process.on("exit", (code) => {
          logger.info(`音乐下载服务退出，退出码: ${code}`)
          this.process = null
        })

        // 等待服务启动
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
