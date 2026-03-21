const { ipcMain, dialog } = require("electron")
const logger = require("./services/logger")
const storage = require("./services/storage")
const update = require("./services/update")
const { fetchViaProxy, fetchLyricsById, API_CONFIGS } = require("../../utils")

// 同时在 ipcHandlers.js 顶部定义 PAGE_SIZE
const PAGE_SIZE = 20

// 初始化 IPC 处理器
function initIpcHandlers() {
  // 测试函数
  ipcMain.handle("test-func", async (event, keyword) => {
    logger.info(`testFunc被调用，关键词：${keyword || "空"}`)
    return { code: 200, msg: "主进程通信正常", keyword }
  })

  // 搜索歌曲
  ipcMain.handle("search-music", async (event, keyword, offset = 0) => {
    logger.info(`开始搜索，关键词：${keyword}，偏移量：${offset}`)
    if (!keyword) return []

    // 直接使用Meting API（因为网易云API已失效）
    logger.info("使用Meting API进行搜索")
    const metingUrl = `${API_CONFIGS.metingFallback.url}?server=netease&type=search&id=${encodeURIComponent(keyword)}&limit=${PAGE_SIZE}&offset=${offset}`
    const metingData = await fetchViaProxy(metingUrl)

    logger.info(`Meting API返回数据类型: ${typeof metingData}`)
    if (Array.isArray(metingData)) {
      logger.info(`Meting API返回数组长度: ${metingData.length}`)
      if (metingData.length > 0) {
        logger.info(`第一个元素结构: ${JSON.stringify(metingData[0])}`)
      }
    } else if (metingData) {
      logger.info(`Meting API返回数据: ${JSON.stringify(metingData)}`)
    }

    if (metingData && Array.isArray(metingData)) {
      const songs = metingData
        .map((item) => {
          // 从url字段中提取歌曲ID
          let songId = item.id || item.songid || item.songId || ""
          if (!songId && item.url) {
            const idMatch = item.url.match(/id=(\d+)/)
            if (idMatch && idMatch[1]) {
              songId = idMatch[1]
            }
          }
          return {
            id: songId,
            songId: songId,
            name: item.name || item.title || "",
            artist: item.artist || item.singer || "未知歌手",
            album: item.album || "未知专辑",
            coverUrl: item.pic || item.cover || "",
            duration: item.duration || 0,
            url:
              item.url ||
              `${API_CONFIGS.neteaseAudioUrl.url}?type=url&id=${songId}`,
          }
        })
        .filter((item) => item.id)
      logger.info(`解析后得到 ${songs.length} 条有效结果`)
      if (songs.length > 0) {
        logger.info(`第一个解析结果: ${JSON.stringify(songs[0])}`)
      }
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
    return await storage.writeJSON("PlayList.json", playlist)
  })

  // 读取播放列表
  ipcMain.handle("read-playlist", async () => {
    logger.info("读取本地播放列表")
    const playlist = await storage.readJSON("PlayList.json")
    logger.info(`读取到 ${playlist.length} 首歌曲`)
    return playlist
  })

  // 读取我喜欢的歌曲
  ipcMain.handle("read-liked-songs", async () => {
    logger.info("读取我喜欢的歌曲")
    const likedSongs = await storage.readJSON("MyFavorite.json")
    logger.info(`读取到 ${likedSongs.length} 首喜欢的歌曲`)
    return likedSongs
  })

  // 保存我喜欢的歌曲
  ipcMain.handle("save-liked-songs", async (event, likedSongs) => {
    logger.info(`保存我喜欢的歌曲，数量：${likedSongs.length}首`)
    return await storage.writeJSON("MyFavorite.json", likedSongs)
  })

  // 读取关注歌手列表
  ipcMain.handle("read-followed-artists", async () => {
    logger.info("读取关注歌手列表")
    const followedArtists = await storage.readJSON("FollowedArtists.json")
    // 确保返回的是数组
    if (!Array.isArray(followedArtists)) {
      logger.warn("关注歌手列表格式错误，返回空数组")
      return []
    }
    logger.info(`读取到 ${followedArtists.length} 位关注的歌手`)
    return followedArtists
  })

  // 保存关注歌手列表
  ipcMain.handle("save-followed-artists", async (event, followedArtists) => {
    // 确保followedArtists是数组
    if (!Array.isArray(followedArtists)) {
      logger.error("保存关注歌手列表失败：数据格式错误")
      return false
    }

    logger.info(`保存关注歌手列表，数量：${followedArtists.length}位`)
    return await storage.writeJSON("FollowedArtists.json", followedArtists)
  })

  // 读取自定义歌单
  ipcMain.handle("read-custom-playlists", async () => {
    logger.info("读取自定义歌单")
    const playlists = await storage.readJSON("PlayList.json")
    logger.info(`读取到 ${playlists.length} 个自定义歌单`)
    return playlists
  })

  // 保存自定义歌单
  ipcMain.handle("save-custom-playlists", async (event, playlists) => {
    logger.info(`保存自定义歌单，数量：${playlists.length}个`)
    return await storage.writeJSON("PlayList.json", playlists)
  })

  // 读取最近播放
  ipcMain.handle("read-latest-played", async () => {
    logger.info("读取最近播放")
    const latestPlayed = await storage.readJSON("Latest.json")
    logger.info(`读取到 ${latestPlayed.length} 首最近播放的歌曲`)
    return latestPlayed
  })

  // 保存最近播放
  ipcMain.handle("save-latest-played", async (event, latestPlayed) => {
    logger.info(`保存最近播放，数量：${latestPlayed.length}首`)
    return await storage.writeJSON("Latest.json", latestPlayed)
  })

  // 读取自建歌单
  ipcMain.handle("read-diy-playlists", async () => {
    logger.info("读取自建歌单")
    const playlists = await storage.readJSON("DIYSongList.json")
    logger.info(`读取到 ${playlists.length} 个自建歌单`)
    return playlists
  })

  // 保存自建歌单
  ipcMain.handle("save-diy-playlists", async (event, playlists) => {
    logger.info(`保存自建歌单，数量：${playlists.length}个`)
    return await storage.writeJSON("DIYSongList.json", playlists)
  })

  // 导出歌单
  ipcMain.handle("export-playlist", async (event, playlist) => {
    logger.info(`导出歌单：${playlist.name}`)
    const window = event.sender.getOwnerBrowserWindow()
    try {
      // 准备导出的歌单数据
      const exportData = {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description || "",
        coverPath: playlist.coverPath || "",
        songs: playlist.songs || [],
      }

      // 打开文件保存对话框
      const result = await dialog.showSaveDialog(window, {
        title: "导出歌单",
        defaultPath: `${playlist.name}.json`,
        filters: [{ name: "JSON文件", extensions: ["json"] }],
      })

      if (!result.canceled && result.filePath) {
        // 保存文件
        await storage.writeJSON(result.filePath, exportData)
        logger.info(`歌单导出成功：${result.filePath}`)
        return { success: true, filePath: result.filePath }
      } else {
        return { success: false, error: "用户取消导出" }
      }
    } catch (err) {
      logger.error(`导出歌单失败：${err.message}`)
      return { success: false, error: err.message }
    }
  })

  // 导入歌单
  ipcMain.handle("import-playlist", async (event) => {
    logger.info("导入歌单")
    const window = event.sender.getOwnerBrowserWindow()
    try {
      // 打开文件选择对话框
      const result = await dialog.showOpenDialog(window, {
        title: "导入歌单",
        properties: ["openFile"],
        filters: [{ name: "JSON文件", extensions: ["json"] }],
      })

      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const importPath = result.filePaths[0]
        // 读取导入的文件内容
        const fs = require("fs").promises
        const content = await fs.readFile(importPath, "utf8")
        const importedPlaylist = JSON.parse(content)

        // 验证歌单数据格式
        if (
          importedPlaylist &&
          importedPlaylist.name &&
          Array.isArray(importedPlaylist.songs)
        ) {
          // 读取现有歌单
          let existingPlaylists = await storage.readJSON("DIYSongList.json")

          // 生成新的歌单ID
          const newId = `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          importedPlaylist.id = newId

          // 添加到现有歌单中
          existingPlaylists.push(importedPlaylist)

          // 保存到DIYSongList.json
          await storage.writeJSON("DIYSongList.json", existingPlaylists)
          logger.info(`歌单导入成功：${importPath}`)
          return { success: true, playlists: existingPlaylists }
        } else {
          throw new Error("歌单数据格式错误")
        }
      } else {
        return { success: false, error: "用户取消导入" }
      }
    } catch (err) {
      logger.error(`导入歌单失败：${err.message}`)
      return { success: false, error: err.message }
    }
  })

  // 导出用户信息
  ipcMain.handle("export-user-info", async (event) => {
    logger.info("导出用户信息")
    const window = event.sender.getOwnerBrowserWindow()
    try {
      // 读取所有用户数据
      const userData = {
        likedSongs: [],
        followedArtists: [],
        diyPlaylists: [],
        searchHistory: [],
        latestPlayed: [],
      }

      // 读取我喜欢的歌曲
      userData.likedSongs = await storage.readJSON("MyFavorite.json")

      // 读取关注歌手
      userData.followedArtists = await storage.readJSON("FollowedArtists.json")

      // 读取自定义歌单
      userData.diyPlaylists = await storage.readJSON("DIYSongList.json")

      // 读取搜索历史
      userData.searchHistory = await storage.readJSON("SearchHistory.json")

      // 读取最近播放
      userData.latestPlayed = await storage.readJSON("Latest.json")

      // 打开文件保存对话框
      const result = await dialog.showSaveDialog(window, {
        title: "导出用户信息",
        defaultPath: "User.json",
        filters: [{ name: "JSON文件", extensions: ["json"] }],
      })

      if (!result.canceled && result.filePath) {
        // 保存文件
        await storage.writeJSON(result.filePath, userData)
        logger.info(`用户信息导出成功：${result.filePath}`)
        return { success: true, filePath: result.filePath }
      } else {
        return { success: false, error: "用户取消导出" }
      }
    } catch (err) {
      logger.error(`导出用户信息失败：${err.message}`)
      return { success: false, error: err.message }
    }
  })

  // 导入用户信息
  ipcMain.handle("import-user-info", async (event) => {
    logger.info("导入用户信息")
    const window = event.sender.getOwnerBrowserWindow()
    try {
      // 打开文件选择对话框
      const result = await dialog.showOpenDialog(window, {
        title: "导入用户信息",
        properties: ["openFile"],
        filters: [{ name: "JSON文件", extensions: ["json"] }],
      })

      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const importPath = result.filePaths[0]
        // 读取导入的文件内容
        const fs = require("fs").promises
        const content = await fs.readFile(importPath, "utf8")
        const userData = JSON.parse(content)

        // 验证用户数据格式
        if (typeof userData === "object" && userData !== null) {
          // 保存我喜欢的歌曲
          if (Array.isArray(userData.likedSongs)) {
            await storage.writeJSON("MyFavorite.json", userData.likedSongs)
          }

          // 保存关注歌手
          if (Array.isArray(userData.followedArtists)) {
            await storage.writeJSON("FollowedArtists.json", userData.followedArtists)
          }

          // 保存自定义歌单
          if (Array.isArray(userData.diyPlaylists)) {
            await storage.writeJSON("DIYSongList.json", userData.diyPlaylists)
          }

          // 保存搜索历史
          if (Array.isArray(userData.searchHistory)) {
            await storage.writeJSON("SearchHistory.json", userData.searchHistory)
          }

          // 保存最近播放
          if (Array.isArray(userData.latestPlayed)) {
            await storage.writeJSON("Latest.json", userData.latestPlayed)
          }

          logger.info(`用户信息导入成功：${importPath}`)
          return { success: true }
        } else {
          throw new Error("用户数据格式错误")
        }
      } else {
        return { success: false, error: "用户取消导入" }
      }
    } catch (err) {
      logger.error(`导入用户信息失败：${err.message}`)
      return { success: false, error: err.message }
    }
  })

  // 读取搜索历史
  ipcMain.handle("read-search-history", async () => {
    const searchHistory = await storage.readJSON("SearchHistory.json")
    logger.info(`搜索历史读取成功，共${searchHistory.length}条记录`)
    return searchHistory
  })

  // 保存搜索历史
  ipcMain.handle("save-search-history", async (event, searchHistory) => {
    const success = await storage.writeJSON("SearchHistory.json", searchHistory)
    logger.info(`搜索历史保存成功，共${searchHistory.length}条记录`)
    return success
  })

  // 保存歌单封面
  ipcMain.handle(
    "save-playlist-cover",
    async (event, { playlistId, coverData }) => {
      logger.info(`保存歌单封面，歌单ID：${playlistId}`)
      const fs = require("fs").promises
      const path = require("path")
      const coverDir = path.join(storage.ROOT_DIR, "DIYSongListPage")
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
    const fs = require("fs").promises
    const path = require("path")
    const localDir = path.join(storage.ROOT_DIR, "ImportLocalSongs")
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
        const fs = require("fs").promises
        const path = require("path")
        const localDir = path.join(storage.ROOT_DIR, "ImportLocalSongs")
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
    const fs = require("fs").promises
    const path = require("path")
    const localDir = path.join(storage.ROOT_DIR, "ImportLocalSongs")
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
      const fs = require("fs").promises
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

  // 检查更新
  ipcMain.handle("check-for-updates", async () => {
    return await update.checkForUpdates()
  })

  // 打开下载页面
  ipcMain.handle("open-download-page", async (event, url) => {
    return await update.openDownloadPage(url)
  })

  logger.info("IPC 处理器初始化完成")
}

module.exports = {
  initIpcHandlers
}