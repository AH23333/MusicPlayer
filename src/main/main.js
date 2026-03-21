const { app, BrowserWindow } = require("electron")
const path = require("path")
const logger = require("./services/logger")
const { initIpcHandlers } = require("./ipcHandlers")

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
  initIpcHandlers() // 初始化 IPC 处理器
  createWindow()
  // 移除自动检查更新，避免API调用
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})