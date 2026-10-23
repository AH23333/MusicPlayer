const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Tray,
  Menu,
  Notification,
  nativeImage,
  screen,
  protocol,
  net,
} = require("electron")
const path = require("path")
const zlib = require("zlib")
const fs = require("fs")
const logger = require("./services/logger")
const { initIpcHandlers } = require("./ipcHandlers")
const musicDlService = require("./services/musicDlService")

// EPIPE 守卫：stdout/stderr 接的管道（如终端会话）关闭后，再有 console 输出会抛
// EPIPE。Windows 下管道写是同步的，必须包住 console 调用本身才能拦住同步 throw。
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === "function") {
    stream.on("error", (err) => {
      if (err && (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED")) {
        return
      }
      throw err
    })
  }
}
for (const name of ["log", "info", "warn", "error"]) {
  const orig = typeof console[name] === "function" ? console[name].bind(console) : null
  if (orig) {
    console[name] = (...args) => {
      try {
        orig(...args)
      } catch (err) {
        if (err && err.code === "EPIPE") return
        throw err
      }
    }
  }
}

// 注册同源媒体代理协议（必须在 app.ready 前）：
// 让跨域音频经 mpmedia:// 代理，避免 createMediaElementSource（频谱/均衡器）时被 CORS 污染为静音。
protocol.registerSchemesAsPrivileged([
  {
    scheme: "mpmedia",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
])

let mainWindow
let tray = null
let desktopLyricsWin = null
let desktopLyricsOpacity = 0.92
let desktopLyricsLocked = false
let savedBounds = null
let isQuitting = false
let miniModeActive = false
// 通知图标缓存：避免每次切歌都重新生成 64px PNG
let notifyIconCache = null

// 生成绿色音符托盘图标（无需外部资源）
function createTrayIcon(size = 22) {
  const S = size
  // 单八分音符：符干 + 符头(椭圆) + 符尾(三角)
  const inEllipse = (x, y, cx, cy, rx, ry) => {
    const d = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry)
    return d <= 1
  }
  const tri = [
    [Math.round(S * 0.58), Math.round(S * 0.14)],
    [Math.round(S * 0.88), Math.round(S * 0.28)],
    [Math.round(S * 0.58), Math.round(S * 0.46)],
  ]
  const inTri = (px, py) => {
    const [a, b, c] = tri
    const v0x = c[0] - a[0], v0y = c[1] - a[1]
    const v1x = b[0] - a[0], v1y = b[1] - a[1]
    const v2x = px - a[0], v2y = py - a[1]
    const dot = v0x * v0x + v0y * v0y
    const dot1 = v0x * v1x + v0y * v1y
    const dot2 = v0x * v2x + v0y * v2y
    const dot3 = v1x * v1x + v1y * v1y
    const dot4 = v1x * v2x + v1y * v2y
    const inv = 1 / (dot * dot3 - dot1 * dot1)
    const u = (dot3 * dot2 - dot1 * dot4) * inv
    const v = (dot * dot4 - dot1 * dot2) * inv
    return u >= 0 && v >= 0 && u + v < 1
  }
  const barX0 = Math.round(S * 0.5),
    barX1 = Math.round(S * 0.62),
    barY0 = Math.round(S * 0.14),
    barY1 = Math.round(S * 0.72)
  const headCx = S * 0.36,
    headCy = S * 0.72,
    rx = S * 0.21,
    ry = S * 0.16
  const isNote = (x, y) => {
    if (x >= barX0 && x <= barX1 && y >= barY0 && y <= barY1) return true
    if (inEllipse(x, y, headCx, headCy, rx, ry)) return true
    if (inTri(x + 0.5, y + 0.5)) return true
    return false
  }
  // 原始 RGBA
  const raw = Buffer.alloc(S * (S * 4 + 1))
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0 // filter byte
    for (let x = 0; x < S; x++) {
      const o = y * (S * 4 + 1) + 1 + x * 4
      if (isNote(x, y)) {
        raw[o] = 29; raw[o + 1] = 185; raw[o + 2] = 84; raw[o + 3] = 255
      } else {
        raw[o] = 0; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = 0
      }
    }
  }
  const crcTable = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })()
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const t = Buffer.from(type, "ascii")
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  const idat = zlib.deflateSync(raw)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ])
  return nativeImage.createFromBuffer(png)
}

function sendControl(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("media-control", action)
  }
}

function createTray() {
  if (tray) return
  const icon = createTrayIcon(22)
  tray = new Tray(icon)
  tray.setToolTip("音乐播放器")
  const buildMenu = () =>
    Menu.buildFromTemplate([
      { label: "播放 / 暂停", click: () => sendControl("toggle") },
      { label: "上一首", click: () => sendControl("prev") },
      { label: "下一首", click: () => sendControl("next") },
      { type: "separator" },
      { label: "桌面歌词", click: () => toggleDesktopLyrics() },
      { label: "锁定/解锁桌面歌词", click: () => setDesktopLyricsLock(!desktopLyricsLocked) },
      { label: "迷你模式", click: () => setMiniMode(true) },
      { label: "显示主界面", click: () => restoreMainWindow() },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ])
  tray.setContextMenu(buildMenu())
  tray.on("click", () => {
    if (mainWindow.isVisible()) mainWindow.hide()
    else restoreMainWindow()
  })
}

function restoreMainWindow() {
  if (!mainWindow) return
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function setMiniMode(enter) {
  if (!mainWindow) return
  if (enter) {
    if (!savedBounds) savedBounds = mainWindow.getBounds()
    miniModeActive = true
    mainWindow.setResizable(false)
    mainWindow.setAlwaysOnTop(true, "floating")
    const w = 320,
      h = 118
    const wa = screen.getPrimaryDisplay().workAreaSize
    mainWindow.setBounds({
      width: w,
      height: h,
      x: Math.round(wa.width - w - 24),
      y: Math.round(wa.height - h - 24),
    })
    mainWindow.setMinimumSize(320, 118)
    mainWindow.show()
  } else {
    miniModeActive = false
    mainWindow.setResizable(true)
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setMinimumSize(900, 600)
    if (savedBounds) mainWindow.setBounds(savedBounds)
    else mainWindow.setSize(1080, 720)
    saveMainWindowStateNow()
  }
}

// 桌面歌词位置记忆（userData/desktop-lyrics-bounds.json）
function dlBoundsPath() {
  return path.join(app.getPath("userData"), "desktop-lyrics-bounds.json")
}
function loadDlBounds() {
  try {
    const d = JSON.parse(fs.readFileSync(dlBoundsPath(), "utf8"))
    if (d && isFinite(d.x) && isFinite(d.y) && isFinite(d.width)) return d
  } catch (err) {}
  return null
}
let dlBoundsSaveTimer = null
function saveDlBoundsSoon() {
  clearTimeout(dlBoundsSaveTimer)
  dlBoundsSaveTimer = setTimeout(() => {
    try {
      if (!desktopLyricsWin || desktopLyricsWin.isDestroyed()) return
      const b = desktopLyricsWin.getBounds()
      fs.writeFileSync(
        dlBoundsPath(),
        JSON.stringify({ x: b.x, y: b.y, width: b.width })
      )
    } catch (err) {}
  }, 800)
}

// 桌面歌词状态记忆：透明度 / 锁定（userData/desktop-lyrics-state.json）
function dlStatePath() {
  return path.join(app.getPath("userData"), "desktop-lyrics-state.json")
}
function loadDlState() {
  try {
    const d = JSON.parse(fs.readFileSync(dlStatePath(), "utf8"))
    if (d && typeof d === "object") {
      if (isFinite(d.opacity)) desktopLyricsOpacity = Math.min(1, Math.max(0.1, d.opacity))
      if (typeof d.locked === "boolean") desktopLyricsLocked = d.locked
    }
  } catch (err) {}
}
function saveDlState() {
  try {
    fs.writeFileSync(
      dlStatePath(),
      JSON.stringify({ opacity: desktopLyricsOpacity, locked: desktopLyricsLocked })
    )
  } catch (err) {}
}

// 主窗口位置尺寸记忆（userData/main-window-state.json）
function mainWindowStatePath() {
  return path.join(app.getPath("userData"), "main-window-state.json")
}
function loadMainWindowState() {
  try {
    const d = JSON.parse(fs.readFileSync(mainWindowStatePath(), "utf8"))
    if (!d || !isFinite(d.x) || !isFinite(d.y) || !isFinite(d.width) || !isFinite(d.height)) return null
    // 校验：窗口矩形须与至少一块屏幕工作区有交集（防止显示器拔除后窗口跑到屏幕外）
    const rect = { x: d.x, y: d.y, width: d.width, height: d.height }
    const visible = screen
      .getAllDisplays()
      .some((disp) => {
        const wa = disp.workArea
        return (
          rect.x < wa.x + wa.width &&
          rect.x + rect.width > wa.x &&
          rect.y < wa.y + wa.height &&
          rect.y + rect.height > wa.y
        )
      })
    if (!visible) return null
    return d
  } catch (err) {}
  return null
}
let mainWindowStateTimer = null
function saveMainWindowStateNow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || miniModeActive) return
    const maximized = mainWindow.isMaximized()
    const cur = mainWindow.getBounds()
    let st = loadMainWindowState() || { x: cur.x, y: cur.y, width: cur.width, height: cur.height }
    // 最大化时只记录标志，保留上次的普通 bounds 作为还原尺寸
    if (!maximized) {
      st = { x: cur.x, y: cur.y, width: cur.width, height: cur.height, maximized: false }
    } else {
      st.maximized = true
    }
    fs.writeFileSync(mainWindowStatePath(), JSON.stringify(st))
  } catch (err) {}
}
function saveMainWindowStateSoon() {
  clearTimeout(mainWindowStateTimer)
  mainWindowStateTimer = setTimeout(saveMainWindowStateNow, 800)
}

function createDesktopLyricsWindow() {
  const dm = screen.getPrimaryDisplay().workAreaSize
  const saved = loadDlBounds()
  const w = saved ? Math.max(400, Math.min(1400, saved.width)) : Math.min(1000, dm.width - 40)
  const h = 140
  const x = saved
    ? Math.max(0, Math.min(saved.x, dm.width - w))
    : Math.round((dm.width - w) / 2)
  const y = saved
    ? Math.max(0, Math.min(saved.y, dm.height - h))
    : dm.height - 200
  desktopLyricsWin = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  })
  desktopLyricsWin.setAlwaysOnTop(true, "screen-saver")
  desktopLyricsWin.setOpacity(desktopLyricsOpacity)
  desktopLyricsWin.loadFile(
    path.join(__dirname, "..", "renderer", "desktop-lyrics.html")
  )
  // 拖动后记忆位置
  desktopLyricsWin.on("moved", saveDlBoundsSoon)
  // 歌词窗口就绪后，让主窗口渲染进程推送一次主题色
  desktopLyricsWin.webContents.once("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("desktop-lyrics-accent-request")
    // 恢复上次的锁定状态（点击穿透）
    if (desktopLyricsLocked) setDesktopLyricsLock(true)
  })
  desktopLyricsWin.on("closed", () => {
    desktopLyricsWin = null
    desktopLyricsLocked = false
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("desktop-lyrics-state", false)
  })
}

// 桌面歌词锁定：鼠标点击穿透（forward 保留 hover），从托盘菜单解锁
function setDesktopLyricsLock(locked) {
  desktopLyricsLocked = !!locked
  saveDlState()
  if (!desktopLyricsWin || desktopLyricsWin.isDestroyed()) return
  desktopLyricsWin.setIgnoreMouseEvents(desktopLyricsLocked, { forward: true })
  desktopLyricsWin.webContents.send("desktop-lyrics-lock-state", desktopLyricsLocked)
}

function toggleDesktopLyrics(force) {
  const shouldShow =
    typeof force === "boolean" ? force : !(desktopLyricsWin && desktopLyricsWin.isVisible())
  if (shouldShow) {
    if (!desktopLyricsWin) createDesktopLyricsWindow()
    else desktopLyricsWin.show()
  } else if (desktopLyricsWin) {
    desktopLyricsWin.hide()
  }
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("desktop-lyrics-state", shouldShow)
}

// 同源媒体代理：mpmedia://audio?u=<encodeURIComponent(真实URL)>
// 透传 Range 以支持 206 分段与拖拽，跟随重定向，并补 CORS 头使 Web Audio 不被污染。
function registerMediaProtocol() {
  protocol.handle("mpmedia", async (request) => {
    const t0 = Date.now()
    let target = ""
    try {
      const reqUrl = new URL(request.url)
      target = reqUrl.searchParams.get("u")
      if (!target) return new Response("bad url", { status: 400 })
      const headers = new Headers()
      const range = request.headers.get("range")
      if (range) headers.set("range", range)
      const resp = await net.fetch(target, {
        headers,
        redirect: "follow",
        signal: request.signal,
      })
      // 只白名单透传媒体必需响应头：net.fetch 已对 body 解码/去分块，
      // 原样带回 content-encoding / transfer-encoding 会让媒体流解析挂起。
      const out = new Headers()
      for (const k of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
        "etag",
        "last-modified",
      ]) {
        const v = resp.headers.get(k)
        if (v) out.set(k, v)
      }
      out.set("Access-Control-Allow-Origin", "*")
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: out,
      })
    } catch (err) {
      // 客户端切歌/中止时 request.signal 触发，取消上游、释放连接，不算错误
      if (err && (err.name === "AbortError" || /abort/i.test(err.message || ""))) {
        return new Response("aborted", { status: 499 })
      }
      console.log("[mpmedia] proxy error", err.message, "after", Date.now() - t0, "ms", target.slice(0, 70))
      return new Response("proxy error: " + err.message, { status: 502 })
    }
  })
}

function createWindow() {
  // 应用图标：打包后位于 asar 内，路径对 dev / packaged 均成立
  const appIcon = app.isPackaged
    ? path.join(process.resourcesPath, "app", "assets", "icon.ico")
    : path.join(__dirname, "..", "..", "assets", "icon.ico")

  // 恢复上次窗口位置尺寸
  const savedWin = loadMainWindowState()
  const useSaved = savedWin && !savedWin.maximized
  mainWindow = new BrowserWindow({
    width: useSaved ? Math.max(900, savedWin.width) : 1080,
    height: useSaved ? Math.max(600, savedWin.height) : 720,
    x: useSaved ? savedWin.x : undefined,
    y: useSaved ? savedWin.y : undefined,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0e0f13",
    autoHideMenuBar: true,
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 音乐应用需后台持续运行：托盘收起/最小化时桌面歌词、定时器不中断
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  })
  if (savedWin && savedWin.maximized) mainWindow.maximize()

  mainWindow.setMenu(null)
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"))
  logger.info("窗口创建完成，预加载脚本已配置")

  // 转发渲染端 console，便于排查
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const tag = ["LOG", "WARN", "ERROR"][level] || "LOG"
    console.log(`[renderer:${tag}] ${message}  (${sourceId.split(/[\\/]/).pop()}:${line})`)
  })
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.log(`[renderer:GONE] ${details.reason}`)
  })
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.log(`[renderer:LOADFAIL] ${code} ${desc}`)
  })

  // 关闭按钮：默认隐藏到托盘，退出走托盘菜单
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    } else {
      saveMainWindowStateNow()
    }
  })

  // 窗口位置尺寸记忆（迷你模式不记录）
  mainWindow.on("resize", saveMainWindowStateSoon)
  mainWindow.on("moved", saveMainWindowStateSoon)
  mainWindow.on("maximize", saveMainWindowStateSoon)
  mainWindow.on("unmaximize", saveMainWindowStateSoon)

  // 无边框窗口控制
  ipcMain.on("window-minimize", () => mainWindow.minimize())
  ipcMain.on("window-maximize", () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on("window-close", () => mainWindow.close())

  // 迷你模式
  ipcMain.on("set-mini-mode", (_e, enter) => setMiniMode(enter))

  // 桌面歌词
  ipcMain.on("desktop-lyrics-toggle", (_e, force) => toggleDesktopLyrics(force))
  ipcMain.on("desktop-lyrics-line", (_e, data) => {
    if (desktopLyricsWin && !desktopLyricsWin.isDestroyed())
      desktopLyricsWin.webContents.send("desktop-lyrics-line", data)
  })
  ipcMain.on("desktop-lyrics-opacity", (_e, val) => {
    desktopLyricsOpacity = Math.min(1, Math.max(0.1, val))
    saveDlState()
    if (desktopLyricsWin) desktopLyricsWin.setOpacity(desktopLyricsOpacity)
  })
  // 桌面歌词播放控制（复用托盘/媒体键控制通道）
  ipcMain.on("desktop-lyrics-player-ctl", (_e, action) => {
    if (action === "toggle" || action === "prev" || action === "next")
      sendControl(action)
  })
  // 桌面歌词锁定（点击穿透，托盘菜单解锁）
  ipcMain.on("desktop-lyrics-lock", (_e, locked) => setDesktopLyricsLock(locked))
  // 主窗口 → 桌面歌词：播放状态（控制条图标）
  ipcMain.on("desktop-lyrics-player-state", (_e, playing) => {
    if (desktopLyricsWin && !desktopLyricsWin.isDestroyed())
      desktopLyricsWin.webContents.send("desktop-lyrics-player-state", !!playing)
  })
  // 主窗口 → 桌面歌词：主题色同步
  ipcMain.on("desktop-lyrics-accent", (_e, hex) => {
    if (typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      if (desktopLyricsWin && !desktopLyricsWin.isDestroyed())
        desktopLyricsWin.webContents.send("desktop-lyrics-accent", hex)
    }
  })

  // 切歌系统通知
  ipcMain.on("notify-song", (_e, info) => {
    try {
      if (Notification.isSupported() && info && info.title) {
        const n = new Notification({
          title: info.title,
          body: info.artist || "",
          icon: notifyIconCache || (notifyIconCache = createTrayIcon(64)),
          silent: true,
        })
        n.on("click", () => restoreMainWindow())
        n.show()
      }
    } catch (err) {
      console.log("[notify] error", err.message)
    }
  })
}

app.whenReady().then(() => {
  logger.init()
  logger.info("Electron应用启动")

  // 全局媒体键
  try {
    globalShortcut.register("MediaPlayPause", () => sendControl("toggle"))
    globalShortcut.register("MediaNextTrack", () => sendControl("next"))
    globalShortcut.register("MediaPreviousTrack", () => sendControl("prev"))
    globalShortcut.register("MediaStop", () => sendControl("pause"))
  } catch (err) {
    console.log("[globalShortcut] 注册失败", err.message)
  }

  musicDlService
    .start()
    .then(() => logger.info("音乐下载服务启动成功"))
    .catch((error) => logger.error("音乐下载服务启动失败:", error))

  initIpcHandlers()
  registerMediaProtocol()
  loadDlState()
  createWindow()
  createTray()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // 托盘常驻，不主动退出
  }
})

app.on("before-quit", () => {
  isQuitting = true
  try {
    globalShortcut.unregisterAll()
  } catch (e) {}
})

app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll()
  } catch (e) {}
  // 刷盘日志缓冲，终止 music-dl-api.exe 子进程，避免孤儿进程残留
  try {
    logger.flushSync()
  } catch (e) {}
  try {
    musicDlService.stop()
  } catch (e) {}
})
