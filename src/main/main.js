const { app, BrowserWindow } = require("electron")
const path = require("path")
const logger = require("./services/logger")
const { initIpcHandlers } = require("./ipcHandlers")
const musicDlService = require("./services/musicDlService")

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  })

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"))
  logger.info("窗口创建完成，预加载脚本已配置")
}

// 启动时初始化日志文件和 IPC 处理器
app.whenReady().then(() => {
  logger.init() // 初始化日志文件
  logger.info("Electron应用启动")

  // 启动音乐下载服务
  musicDlService
    .start()
    .then(() => {
      logger.info("音乐下载服务启动成功")
    })
    .catch((error) => {
      logger.error("音乐下载服务启动失败:", error)
    })

  initIpcHandlers() // 初始化 IPC 处理器
  createWindow()
  // 移除自动检查更新，避免API调用
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", async () => {
  // 停止音乐下载服务
  try {
    await musicDlService.stop()
    logger.info("音乐下载服务已停止")
  } catch (error) {
    logger.error("停止音乐下载服务时出错:", error)
  }
})
