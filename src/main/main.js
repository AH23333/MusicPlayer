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
  powerSaveBlocker,
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
// 单实例锁：多开会二次拉起 music-dl-api（端口冲突）并出现双托盘，
// 第二实例直接退出，由已有实例接收 argv（文件关联打开场景）
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else {
  // 第二实例退出前会触发：聚焦已有窗口并转发其命令行（关联打开的音频文件）
  app.on("second-instance", (_event, argv) => {
    restoreMainWindow()
    pushOpenFiles(collectAudioFilesFromArgv(argv))
  })
}

// 通知图标缓存：避免每次切歌都重新生成 64px PNG
let notifyIconCache = null

// ============ 文件关联 / 命令行打开音频 ============
const AUDIO_EXTS = [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".wma"]
let pendingOpenFiles = []

function isAudioFilePath(p) {
  if (typeof p !== "string" || p === "" || p.startsWith("-")) return false
  try {
    const abs = path.resolve(p)
    if (!AUDIO_EXTS.includes(path.extname(abs).toLowerCase())) return false
    return fs.existsSync(abs)
  } catch (e) {
    return false
  }
}

// 过滤 argv 中的命令行音频文件路径（跳过 electron 本身、"."、flag 参数）
function collectAudioFilesFromArgv(argv) {
  return (argv || []).filter(isAudioFilePath).map((p) => path.resolve(p))
}

// 把关联打开的音频文件转发给渲染进程；窗口未就绪时暂存，待渲染进程拉取
function pushOpenFiles(files) {
  const list = (files || []).filter(isAudioFilePath).map((p) => path.resolve(p))
  if (!list.length) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("open-audio-files", list)
  } else {
    pendingOpenFiles = pendingOpenFiles.concat(list)
  }
}

// macOS 通过 open-file 事件拿到关联文件（需在 app.ready 前注册才能捕获启动时的文件）
app.on("open-file", (event, filePath) => {
  event.preventDefault()
  if (isAudioFilePath(filePath)) pushOpenFiles([filePath])
})

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
    const w = 400,
      h = 116
    const wa = screen.getPrimaryDisplay().workAreaSize
    mainWindow.setBounds({
      width: w,
      height: h,
      x: Math.round(wa.width - w - 24),
      y: Math.round(wa.height - h - 24),
    })
    mainWindow.setMinimumSize(400, 116)
    mainWindow.show()
  } else {
    miniModeActive = false
    mainWindow.setResizable(true)
    // 先恢复窗口尺寸，再放宽最小尺寸限制：
    // 若先 setMinimumSize(900,600)，400x116 的迷你窗口会被强制先扩到 900x600，
    // 随后 setBounds 再变一次——窗口连续两次 resize 造成退出迷你模式卡顿
    if (savedBounds) mainWindow.setBounds(savedBounds)
    else mainWindow.setSize(1080, 720)
    mainWindow.setMinimumSize(900, 600)
    mainWindow.setAlwaysOnTop(false)
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
// 右键菜单展开期间不持久化窗口高度（临时拉高透明窗以容纳菜单）
let dlMenuExpanded = false
let dlPreMenuHeight = 0
function saveDlBoundsSoon() {
  if (dlMenuExpanded) return
  clearTimeout(dlBoundsSaveTimer)
  dlBoundsSaveTimer = setTimeout(() => {
    try {
      if (!desktopLyricsWin || desktopLyricsWin.isDestroyed()) return
      const b = desktopLyricsWin.getBounds()
      fs.writeFileSync(
        dlBoundsPath(),
        JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height })
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
  const h =
    saved && isFinite(saved.height)
      ? Math.max(90, Math.min(400, saved.height))
      : 140
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
    resizable: true,
    minWidth: 360,
    minHeight: 90,
    maxHeight: 400,
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
  // 拖动 / 缩放后记忆位置与大小（resize 持续触发，经防抖落盘）
  desktopLyricsWin.on("moved", saveDlBoundsSoon)
  desktopLyricsWin.on("resized", saveDlBoundsSoon)
  desktopLyricsWin.on("resize", saveDlBoundsSoon)
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

// 桌面歌词锁定：鼠标点击穿透（forward 保留 hover）；可从渲染层徽标/托盘菜单解锁
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
  // 桌面歌词锁定（点击穿透；锁定后渲染层悬停徽标/工具条可临时恢复交互解锁）
  ipcMain.on("desktop-lyrics-lock", (_e, locked) => setDesktopLyricsLock(locked))
  // 仅在锁定状态下生效：悬停非穿透入口时收回穿透，移开恢复穿透
  ipcMain.on("desktop-lyrics-set-interactive", (_e, interactive) => {
    if (!desktopLyricsWin || desktopLyricsWin.isDestroyed() || !desktopLyricsLocked) return
    if (interactive) desktopLyricsWin.setIgnoreMouseEvents(false)
    else desktopLyricsWin.setIgnoreMouseEvents(true, { forward: true })
  })
  // 桌面歌词手动拖拽（去掉 drag region 后由渲染层 pointer 事件驱动：
  // 渲染层按事件 screen 坐标算 delta 传来，主进程按 delta 移动窗口）
  let dlDragBase = null
  ipcMain.on("desktop-lyrics-drag-start", () => {
    if (!desktopLyricsWin || desktopLyricsWin.isDestroyed()) return
    dlDragBase = { win: desktopLyricsWin.getPosition() }
  })
  ipcMain.on("desktop-lyrics-drag-move", (_e, dx, dy) => {
    if (!desktopLyricsWin || desktopLyricsWin.isDestroyed() || !dlDragBase) return
    if (!isFinite(dx) || !isFinite(dy)) return
    desktopLyricsWin.setPosition(Math.round(dlDragBase.win[0] + dx), Math.round(dlDragBase.win[1] + dy))
  })
  ipcMain.on("desktop-lyrics-drag-end", () => {
    if (!dlDragBase) return
    dlDragBase = null
    saveDlBoundsSoon()
  })
  // 桌面歌词重置窗口大小（右键菜单，底边固定）
  ipcMain.on("desktop-lyrics-reset-size", () => {
    if (!desktopLyricsWin || desktopLyricsWin.isDestroyed()) return
    const dm = screen.getPrimaryDisplay().workAreaSize
    const w = Math.min(1000, dm.width - 40)
    const cur = desktopLyricsWin.getBounds()
    const bottom = cur.y + cur.height
    dlMenuExpanded = false
    desktopLyricsWin.setBounds({ x: cur.x, y: bottom - 140, width: w, height: 140 })
    saveDlBoundsSoon()
  })
  // 桌面歌词右键菜单临时拉高窗口：菜单高于窗口时向上扩展（底边固定），关闭菜单后还原
  ipcMain.on("desktop-lyrics-menu-size", (_e, neededH) => {
    if (!desktopLyricsWin || desktopLyricsWin.isDestroyed()) return
    if (neededH > 0) {
      const cur = desktopLyricsWin.getBounds()
      const wa = screen.getPrimaryDisplay().workArea
      const bottom = cur.y + cur.height
      const maxH = Math.min(400, bottom - wa.y)
      const h = Math.max(cur.height, Math.min(neededH, maxH))
      if (h > cur.height) {
        dlMenuExpanded = true
        dlPreMenuHeight = cur.height
        desktopLyricsWin.setBounds({ x: cur.x, y: bottom - h, width: cur.width, height: h })
      }
    } else if (dlMenuExpanded) {
      dlMenuExpanded = false
      const cur = desktopLyricsWin.getBounds()
      const bottom = cur.y + cur.height
      const h = dlPreMenuHeight || 140
      desktopLyricsWin.setBounds({ x: cur.x, y: bottom - h, width: cur.width, height: h })
    }
  })
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

// 渲染进程就绪后拉取启动时关联打开的音频文件（窗口未就绪期间暂存的）
ipcMain.handle("get-pending-open-files", () => {
  const files = pendingOpenFiles
  pendingOpenFiles = []
  return files
})

// 播放时阻止系统休眠/挂起（屏幕允许熄灭），暂停即释放
// on: true/false 变更状态；其他值（如 "query"）仅查询
let powerSaveBlockerId = null
ipcMain.handle("power-save", (_event, on) => {
  try {
    if (on === true || on === false) {
      const running =
        powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)
      if (on && !running) {
        powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension")
      } else if (!on && running) {
        powerSaveBlocker.stop(powerSaveBlockerId)
        powerSaveBlockerId = null
      }
    }
    return {
      started:
        powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId),
      id: powerSaveBlockerId,
    }
  } catch (err) {
    console.log("[power-save] error", err.message)
    return { started: false, error: err.message, id: powerSaveBlockerId }
  }
})

app.whenReady().then(() => {
  logger.init()
  logger.info("Electron应用启动")

  // 启动命令行里关联打开的音频文件（如双击 .mp3 启动）
  pushOpenFiles(collectAudioFilesFromArgv(process.argv))

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
  // 释放防休眠阻塞器，避免退出后系统仍被占用
  try {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId)
      powerSaveBlockerId = null
    }
  } catch (e) {}
  // 刷盘日志缓冲，终止 music-dl-api.exe 子进程，避免孤儿进程残留
  try {
    logger.flushSync()
  } catch (e) {}
  try {
    musicDlService.stop()
  } catch (e) {}
})
