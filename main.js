// main.js - 日志改为文件输出
const { app, BrowserWindow, ipcMain } = require("electron")
const path = require("path")
const fs = require("fs").promises
// 引入日志工具
const logger = require("./logger")
const {
  fetchViaProxy,
  mapNeteaseSongToTrack,
  fetchLyricsById,
  API_CONFIGS,
} = require("./utils")

// 同时在main.js顶部定义PAGE_SIZE
const PAGE_SIZE = 20

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

  mainWindow.loadFile(path.join(__dirname, "index.html"))
  mainWindow.webContents.openDevTools()
  logger.info("窗口创建完成，预加载脚本已配置") // 替换console.log
}

// 启动时初始化日志文件
app.whenReady().then(() => {
  logger.init() // 初始化日志文件
  logger.info("Electron应用启动") // 替换console.log
  createWindow()
})

// ========== IPC通信逻辑（日志全部改为文件输出） ==========
// 测试函数
ipcMain.handle("test-func", async (event, keyword) => {
  logger.info(`testFunc被调用，关键词：${keyword || "空"}`)
  return { code: 200, msg: "主进程通信正常", keyword }
})

// 搜索歌曲
// 找到search-music的IPC处理函数，修改为支持offset参数
ipcMain.handle("search-music", async (event, keyword, offset = 0) => {
  logger.info(`开始搜索，关键词：${keyword}，偏移量：${offset}`)
  if (!keyword) return []

  // 方案1：网易云API（支持offset）
  const searchUrl = `${API_CONFIGS.neteaseSearch.url}?keywords=${encodeURIComponent(keyword)}&limit=${PAGE_SIZE}&offset=${offset}`
  const searchData = await fetchViaProxy(searchUrl)

  if (searchData?.result?.songs?.length) {
    const songs = searchData.result.songs
      .map(mapNeteaseSongToTrack)
      .filter(Boolean)
    logger.info(`网易云API返回 ${songs.length} 条结果`)
    return songs
  }

  // 方案2：Meting备用API
  logger.warn("网易云API无数据，切换到Meting备用API")
  const metingUrl = `${API_CONFIGS.metingFallback.url}?server=netease&type=search&keyword=${encodeURIComponent(keyword)}&limit=${PAGE_SIZE}&offset=${offset}`
  const metingData = await fetchViaProxy(metingUrl)

  if (metingData && Array.isArray(metingData)) {
    const songs = metingData
      .map((item) => ({
        id: item.id || item.songid || "",
        songId: item.id || item.songid || "",
        name: item.name || item.title || "",
        artist: item.artist || item.singer || "未知歌手",
        album: item.album || "未知专辑",
        coverUrl: item.pic || item.cover || "",
        duration: item.duration || 0,
        url: `${API_CONFIGS.neteaseAudioUrl.url}?type=url&id=${item.id}`,
      }))
      .filter((item) => item.id)
    logger.info(`Meting API返回 ${songs.length} 条结果`)
    return songs
  }

  logger.warn("所有搜索API均无结果")
  return []
})

// 获取歌词
ipcMain.handle("fetch-lyrics", async (event, songId) => {
  logger.info(`获取歌词，歌曲ID：${songId}`)
  const lyrics = await fetchLyricsById(songId)
  if (!lyrics) logger.warn(`歌曲ID ${songId} 无歌词数据`)
  return lyrics || { lrc: "", tlrc: "", metadata: [] }
})

// 保存播放列表
ipcMain.handle("save-playlist", async (event, playlist) => {
  logger.info(`保存播放列表，数量：${playlist.length}首`)
  const filePath = path.join(__dirname, "PlayList.json")
  try {
    await fs.writeFile(filePath, JSON.stringify(playlist, null, 2), "utf8")
    return true
  } catch (err) {
    logger.error(`保存播放列表失败：${err.message}`)
    return false
  }
})

// 读取播放列表
ipcMain.handle("read-playlist", async () => {
  logger.info("读取本地播放列表")
  const filePath = path.join(__dirname, "PlayList.json")
  try {
    await fs.access(filePath)
    const content = await fs.readFile(filePath, "utf8")
    const playlist = JSON.parse(content) || []
    logger.info(`读取到 ${playlist.length} 首歌曲`)
    return playlist
  } catch (err) {
    logger.warn(`播放列表文件不存在：${err.message}`)
    // 如果文件不存在，创建一个空文件
    try {
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8")
      logger.info("创建了空的PlayList.json文件")
    } catch (writeErr) {
      logger.error(`创建PlayList.json失败：${writeErr.message}`)
    }
    return []
  }
})

// 读取我喜欢的歌曲
ipcMain.handle("read-liked-songs", async () => {
  logger.info("读取我喜欢的歌曲")
  const filePath = path.join(__dirname, "MyFavorite.json")
  try {
    await fs.access(filePath)
    const content = await fs.readFile(filePath, "utf8")
    const likedSongs = JSON.parse(content) || []
    logger.info(`读取到 ${likedSongs.length} 首喜欢的歌曲`)
    return likedSongs
  } catch (err) {
    logger.warn(`我喜欢的歌曲文件不存在：${err.message}`)
    // 如果文件不存在，创建一个空文件
    try {
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8")
      logger.info("创建了空的MyFavorite.json文件")
    } catch (writeErr) {
      logger.error(`创建MyFavorite.json失败：${writeErr.message}`)
    }
    return []
  }
})

// 保存我喜欢的歌曲
ipcMain.handle("save-liked-songs", async (event, likedSongs) => {
  logger.info(`保存我喜欢的歌曲，数量：${likedSongs.length}首`)
  const filePath = path.join(__dirname, "MyFavorite.json")
  try {
    await fs.writeFile(filePath, JSON.stringify(likedSongs, null, 2), "utf8")
    return true
  } catch (err) {
    logger.error(`保存我喜欢的歌曲失败：${err.message}`)
    return false
  }
})

// 读取自定义歌单
ipcMain.handle("read-custom-playlists", async () => {
  logger.info("读取自定义歌单")
  const filePath = path.join(__dirname, "PlayList.json")
  try {
    await fs.access(filePath)
    const content = await fs.readFile(filePath, "utf8")
    const playlists = JSON.parse(content) || []
    logger.info(`读取到 ${playlists.length} 个自定义歌单`)
    return playlists
  } catch (err) {
    logger.warn(`自定义歌单文件不存在：${err.message}`)
    // 如果文件不存在，创建一个空文件
    try {
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8")
      logger.info("创建了空的PlayList.json文件")
    } catch (writeErr) {
      logger.error(`创建PlayList.json失败：${writeErr.message}`)
    }
    return []
  }
})

// 保存自定义歌单
ipcMain.handle("save-custom-playlists", async (event, playlists) => {
  logger.info(`保存自定义歌单，数量：${playlists.length}个`)
  const filePath = path.join(__dirname, "PlayList.json")
  try {
    await fs.writeFile(filePath, JSON.stringify(playlists, null, 2), "utf8")
    return true
  } catch (err) {
    logger.error(`保存自定义歌单失败：${err.message}`)
    return false
  }
})

// 读取最近播放
ipcMain.handle("read-latest-played", async () => {
  logger.info("读取最近播放")
  const filePath = path.join(__dirname, "Latest.json")
  try {
    await fs.access(filePath)
    const content = await fs.readFile(filePath, "utf8")
    const latestPlayed = JSON.parse(content) || []
    logger.info(`读取到 ${latestPlayed.length} 首最近播放的歌曲`)
    return latestPlayed
  } catch (err) {
    logger.warn(`最近播放文件不存在：${err.message}`)
    // 如果文件不存在，创建一个空文件
    try {
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8")
      logger.info("创建了空的Latest.json文件")
    } catch (writeErr) {
      logger.error(`创建Latest.json失败：${writeErr.message}`)
    }
    return []
  }
})

// 保存最近播放
ipcMain.handle("save-latest-played", async (event, latestPlayed) => {
  logger.info(`保存最近播放，数量：${latestPlayed.length}首`)
  const filePath = path.join(__dirname, "Latest.json")
  try {
    await fs.writeFile(filePath, JSON.stringify(latestPlayed, null, 2), "utf8")
    return true
  } catch (err) {
    logger.error(`保存最近播放失败：${err.message}`)
    return false
  }
})

// 读取自建歌单
ipcMain.handle("read-diy-playlists", async () => {
  logger.info("读取自建歌单")
  const filePath = path.join(__dirname, "DIYSongList.json")
  try {
    await fs.access(filePath)
    const content = await fs.readFile(filePath, "utf8")
    const playlists = JSON.parse(content) || []
    logger.info(`读取到 ${playlists.length} 个自建歌单`)
    return playlists
  } catch (err) {
    logger.warn(`自建歌单文件不存在：${err.message}`)
    // 如果文件不存在，创建一个空文件
    try {
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8")
      logger.info("创建了空的DIYSongList.json文件")
    } catch (writeErr) {
      logger.error(`创建DIYSongList.json失败：${writeErr.message}`)
    }
    return []
  }
})

// 保存自建歌单
ipcMain.handle("save-diy-playlists", async (event, playlists) => {
  logger.info(`保存自建歌单，数量：${playlists.length}个`)
  const filePath = path.join(__dirname, "DIYSongList.json")
  try {
    await fs.writeFile(filePath, JSON.stringify(playlists, null, 2), "utf8")
    return true
  } catch (err) {
    logger.error(`保存自建歌单失败：${err.message}`)
    return false
  }
})

// 读取搜索历史
ipcMain.handle("read-search-history", async () => {
  const filePath = path.join(__dirname, "SearchHistory.json")
  try {
    const content = await fs.readFile(filePath, "utf8")
    const searchHistory = JSON.parse(content)
    logger.info(`搜索历史读取成功，共${searchHistory.length}条记录`)
    return searchHistory
  } catch (err) {
    if (err.code === "ENOENT") {
      // 文件不存在，创建空文件
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf8")
      logger.info("SearchHistory.json文件不存在，已创建空文件")
      return []
    }
    logger.error(`读取搜索历史失败：${err.message}`)
    return []
  }
})

// 保存搜索历史
ipcMain.handle("save-search-history", async (event, searchHistory) => {
  const filePath = path.join(__dirname, "SearchHistory.json")
  try {
    await fs.writeFile(filePath, JSON.stringify(searchHistory, null, 2), "utf8")
    logger.info(`搜索历史保存成功，共${searchHistory.length}条记录`)
    return true
  } catch (err) {
    logger.error(`保存搜索历史失败：${err.message}`)
    return false
  }
})

// 保存歌单封面
ipcMain.handle(
  "save-playlist-cover",
  async (event, { playlistId, coverData }) => {
    logger.info(`保存歌单封面，歌单ID：${playlistId}`)
    const coverDir = path.join(__dirname, "DIYSongListPage")
    try {
      // 创建目录（如果不存在）
      await fs.mkdir(coverDir, { recursive: true })

      // 提取图片格式
      const formatMatch = coverData.match(/^data:image\/(\w+);base64,/)
      const format = formatMatch ? formatMatch[1] : "png"

      // 生成文件名
      const fileName = `${playlistId}.${format}`
      const filePath = path.join(coverDir, fileName)

      // 解码base64数据
      const buffer = Buffer.from(
        coverData.replace(/^data:image\/\w+;base64,/, ""),
        "base64"
      )

      // 写入文件
      await fs.writeFile(filePath, buffer)
      logger.info(`歌单封面保存成功：${fileName}`)
      return { success: true, coverPath: fileName }
    } catch (err) {
      logger.error(`保存歌单封面失败：${err.message}`)
      return { success: false, error: err.message }
    }
  }
)

// 读取本地歌曲
ipcMain.handle("read-local-songs", async () => {
  logger.info("读取本地歌曲")
  const localDir = path.join(__dirname, "ImportLocalSongs")
  try {
    await fs.access(localDir)
    const files = await fs.readdir(localDir)
    const songs = []

    for (const file of files) {
      if (
        file.endsWith(".mp3") ||
        file.endsWith(".wav") ||
        file.endsWith(".flac") ||
        file.endsWith(".m4a")
      ) {
        const filePath = path.join(localDir, file)
        const stats = await fs.stat(filePath)

        // 提取歌曲信息（简单处理，实际项目中可能需要更复杂的解析）
        const fileName = path.basename(file, path.extname(file))
        const songInfo = fileName.split(" - ")

        songs.push({
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: songInfo.length > 1 ? songInfo[1] : fileName,
          artist: songInfo.length > 1 ? songInfo[0] : "本地艺术家",
          album: "本地专辑",
          coverUrl: "",
          duration: 0,
          url: filePath,
          local: true,
        })
      }
    }

    logger.info(`读取到 ${songs.length} 首本地歌曲`)
    return songs
  } catch (err) {
    logger.warn(`本地歌曲目录不存在：${err.message}`)
    // 如果目录不存在，创建一个空目录
    try {
      await fs.mkdir(localDir, { recursive: true })
      logger.info("创建了空的ImportLocalSongs目录")
    } catch (writeErr) {
      logger.error(`创建ImportLocalSongs目录失败：${writeErr.message}`)
    }
    return []
  }
})

// 导入本地歌曲
ipcMain.handle("import-local-songs", async (event, filePaths) => {
  logger.info(`导入本地歌曲，数量：${filePaths.length}首`)
  const localDir = path.join(__dirname, "ImportLocalSongs")
  try {
    // 创建目录（如果不存在）
    await fs.mkdir(localDir, { recursive: true })

    const importedSongs = []

    for (const filePath of filePaths) {
      const fileName = path.basename(filePath)
      // 检查文件类型，只导入音频文件
      const ext = path.extname(fileName).toLowerCase()
      // 支持更多音频格式，忽略大小写
      const supportedFormats = ["mp3", "wav", "flac", "m4a", "ogg", "wma"]
      // 提取扩展名（不含点）并转换为小写
      const extWithoutDot = ext.substring(1).toLowerCase()

      if (supportedFormats.includes(extWithoutDot)) {
        const destPath = path.join(localDir, fileName)

        // 复制文件
        await fs.copyFile(filePath, destPath)
        logger.info(`导入歌曲：${fileName}`)

        // 提取歌曲信息
        const songInfo = fileName.split(" - ")
        importedSongs.push({
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name:
            songInfo.length > 1
              ? songInfo[1]
              : path.basename(fileName, path.extname(fileName)),
          artist: songInfo.length > 1 ? songInfo[0] : "本地艺术家",
          album: "本地专辑",
          coverUrl: "",
          duration: 0,
          url: destPath,
          local: true,
        })
      }
    }

    logger.info(`成功导入 ${importedSongs.length} 首本地歌曲`)
    return { success: true, songs: importedSongs }
  } catch (err) {
    logger.error(`导入本地歌曲失败：${err.message}`)
    return { success: false, error: err.message }
  }
})

// 删除本地歌曲
ipcMain.handle("delete-local-song", async (event, songUrl) => {
  logger.info(`删除本地歌曲：${songUrl}`)
  try {
    await fs.unlink(songUrl)
    logger.info(`本地歌曲删除成功：${songUrl}`)
    return { success: true }
  } catch (err) {
    logger.error(`删除本地歌曲失败：${err.message}`)
    return { success: false, error: err.message }
  }
})

// 打开文件选择对话框
ipcMain.handle("open-file-dialog", async (event) => {
  logger.info("打开文件选择对话框")
  const { dialog } = require("electron")
  const window = event.sender.getOwnerBrowserWindow()
  try {
    // 使用异步版本的对话框
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "所有文件", extensions: ["*"] }],
      title: "选择文件",
      defaultPath: process.env.USERPROFILE + "\\Music",
    })
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      return result.filePaths
    } else {
      return null
    }
  } catch (err) {
    return null
  }
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
