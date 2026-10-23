const { ipcMain, dialog } = require("electron")
const logger = require("./services/logger")
const storage = require("./services/storage")
const update = require("./services/update")
const musicDlService = require("./services/musicDlService")
const {
  fetchViaProxy,
  fetchLyricsById,
  API_CONFIGS,
  parseWebPlaylistUrl,
  WEB_PLAYLIST_PLATFORM_LABELS,
  buildDownloadUrlForSong,
  metingServerFromSource,
} = require("../../utils")
const axios = require("axios")

// 同时在 ipcHandlers.js 顶部定义 PAGE_SIZE
const PAGE_SIZE = 20

// 本地歌曲稳定 ID：基于文件名生成（避免每次读取用随机 ID 导致喜欢/选中状态丢失）
function stableLocalSongId(fileName) {
  return (
    "local_" +
    Buffer.from(String(fileName))
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
  )
}

// 初始化 IPC 处理器
function initIpcHandlers() {
  // 测试函数
  ipcMain.handle("test-func", async (event, keyword) => {
    logger.info(`testFunc被调用，关键词：${keyword || "空"}`)
    return { code: 200, msg: "主进程通信正常", keyword }
  })

  function mapMetingPlaylistItemToSong(item, metingServer = "netease") {
    let songId = item.id || item.songid || item.songId || item.hash || ""
    if (!songId && item.url) {
      const idMatch = String(item.url).match(/id=([^&]+)/)
      if (idMatch) songId = idMatch[1]
    }
    if (!songId) return null
    const sid = String(songId)
    const pic = item.pic || item.cover || item.al?.picUrl || ""
    return {
      id: sid,
      songId: sid,
      name: item.name || item.title || "",
      artist:
        item.artist ||
        item.singer ||
        item.ar?.map((a) => a.name).join("/") ||
        "未知歌手",
      album:
        typeof item.album === "string"
          ? item.album
          : item.al?.name || item.album?.name || "未知专辑",
      coverUrl: String(pic).replace(/^http:/, "https:"),
      duration: item.duration || item.dt || 0,
      url:
        item.url ||
        `${API_CONFIGS.neteaseAudioUrl.url}?server=${encodeURIComponent(metingServer)}&type=url&id=${encodeURIComponent(sid)}`,
      source: metingServer === "tencent" ? "tencent" : "netease",
    }
  }

  /**
   * 当前随应用打包的 music-dl-api 实测仅有 /api/search，/api/playlist 等为 404。
   * 保留探测以便日后升级 exe 后自动可用。
   */
  async function fetchPlaylistFromMusicDl(metingServer, playlistId) {
    const sourceMap = {
      netease: "netease",
      tencent: "qq",
    }
    const dlSource = sourceMap[metingServer] || metingServer
    const baseUrl = musicDlService.getBaseUrl()
    const endpoints = [`${baseUrl}/api/playlist`, `${baseUrl}/playlist`]
    for (const ep of endpoints) {
      try {
        const response = await axios.get(ep, {
          params: { id: playlistId, source: dlSource },
          timeout: 8000,
        })
        const d = response.data
        if (!d) continue
        let songs = []
        let name = null
        if (Array.isArray(d.songs)) {
          songs = d.songs
          name = d.name || d.title || d.playlist?.name
        } else if (d.playlist && Array.isArray(d.playlist.tracks)) {
          songs = d.playlist.tracks
          name = d.playlist.name
        } else if (Array.isArray(d)) {
          songs = d
        }
        if (songs.length > 0) {
          logger.info(`music-dl 歌单成功 ${ep}，共 ${songs.length} 首`)
          return { songs, name }
        }
      } catch (e) {
        logger.warn(`music-dl 歌单 ${ep} 不可用: ${e.message}`)
      }
    }
    return null
  }

  // ===== go-music-dl 链接解析兜底（支持酷狗/酷我/咪咕/B站等更多平台）=====
  // 将 music-lib 的 Song 结构映射为播放器内部歌曲结构
  function mapDlSongToPlayerSong(s, defaultSource) {
    if (!s || s.id == null || s.id === "") return null
    const sid = String(s.id)
    const server = metingServerFromSource(s.source || defaultSource)
    const pic = s.cover || ""
    return {
      id: sid,
      songId: sid,
      name: s.name || "未知歌曲",
      artist: s.artist || "未知歌手",
      album: s.album || "未知专辑",
      coverUrl: String(pic).replace(/^http:/, "https:"),
      duration: s.duration || 0,
      url:
        s.url && /^https?:\/\//i.test(s.url)
          ? s.url
          : `${API_CONFIGS.neteaseAudioUrl.url}?server=${server}&type=url&id=${encodeURIComponent(sid)}`,
      source: server,
    }
  }

  // 通过 /api/parse 解析任意平台链接，成功时返回与 fetch-web-playlist 一致的结构
  async function parseViaMusicDl(rawUrl) {
    const baseUrl = musicDlService.getBaseUrl()
    try {
      const response = await axios.get(`${baseUrl}/api/parse`, {
        params: { url: rawUrl },
        timeout: 60000,
      })
      const d = response.data
      if (!d || d.error) return null
      const rawSongs = Array.isArray(d.songs)
        ? d.songs
        : d.song
          ? [d.song]
          : []
      if (!rawSongs.length) return null
      const dlSource = d.source || ""
      const songs = rawSongs
        .map((s) => mapDlSongToPlayerSong(s, s.source || dlSource))
        .filter(Boolean)
      if (!songs.length) return null
      const server = metingServerFromSource(dlSource)
      const platLabel = WEB_PLAYLIST_PLATFORM_LABELS[server] || dlSource
      const name =
        (d.playlist && d.playlist.name) ||
        (d.song && d.song.name) ||
        `${platLabel}歌单`
      logger.info(
        `go-music-dl 链接解析成功：${d.type} ${dlSource}，共 ${songs.length} 首`
      )
      return {
        success: true,
        playlistId: String((d.playlist && d.playlist.id) || ""),
        platform: server,
        platformLabel: platLabel,
        name,
        songs,
      }
    } catch (e) {
      logger.warn(`go-music-dl 链接解析失败: ${e.message}`)
      return null
    }
  }

  // ===== 换源播放：歌曲链接失效时跨平台找回同名可播曲目（go-music-dl /api/switch_source）=====
  ipcMain.handle(
    "musicDlSwitchSource",
    async (event, name, artist, current, duration) => {
      const baseUrl = musicDlService.getBaseUrl()
      try {
        const response = await axios.get(`${baseUrl}/api/switch_source`, {
          params: {
            name: String(name || "").trim(),
            artist: String(artist || "").trim(),
            current: String(current || "").trim(),
            duration: Number(duration) || 0,
          },
          timeout: 90000, // 跨源搜索 + 并行可播探测耗时较长
        })
        const d = response.data
        if (!d || d.error || !d.song || !d.song.url) {
          return {
            success: false,
            error: (d && d.error) || "未找到可播放的替代音源",
          }
        }
        logger.info(
          `换源成功：${d.source}《${d.song.name}》score=${d.score}`
        )
        return { success: true, song: d.song, source: d.source, score: d.score }
      } catch (e) {
        logger.warn(`换源失败: ${e.message}`)
        return { success: false, error: "换源服务不可用" }
      }
    }
  )

  // 通用链接解析入口（渲染端可调用）
  ipcMain.handle("musicDlParse", async (event, url) => {
    const raw = String(url || "").trim()
    if (!/^https?:\/\//i.test(raw)) {
      return { success: false, error: "仅支持 http(s) 链接" }
    }
    const result = await parseViaMusicDl(raw)
    if (!result) {
      return { success: false, error: "无法解析该链接，请确认链接正确且歌单公开" }
    }
    return result
  })

  // 从网易云 / QQ 音乐网页链接拉取歌单（Meting API）
  ipcMain.handle(
    "fetch-web-playlist",
    async (event, urlOrId, platform = "auto") => {
      const parsed = parseWebPlaylistUrl(urlOrId, platform)
      const rawUrlForParse = /^https?:\/\//i.test(String(urlOrId || "").trim())
        ? String(urlOrId).trim()
        : null
      if (!parsed) {
        // go-music-dl 解析兜底：支持酷狗/酷我/咪咕/B站等更多平台的链接
        if (rawUrlForParse) {
          const dlParsed = await parseViaMusicDl(rawUrlForParse)
          if (dlParsed) return dlParsed
        }
        return {
          success: false,
          error:
            "无法解析歌单。请粘贴浏览器地址栏完整链接；若只填数字 ID，请先选择对应平台。",
        }
      }
      const { server: metingServer, id: playlistId } = parsed
      logger.info(`拉取网页歌单 server=${metingServer} id=${playlistId}`)
      const metingUrl = `${API_CONFIGS.metingFallback.url}?server=${encodeURIComponent(metingServer)}&type=playlist&id=${encodeURIComponent(playlistId)}`
      const data = await fetchViaProxy(metingUrl)

      if (data === null) {
        return {
          success: false,
          error: "无法连接歌单接口（网络异常或请求失败），请检查网络后重试",
        }
      }

      let metingErrMsg = null
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        data.error
      ) {
        metingErrMsg = String(data.error)
        logger.warn(`Meting 歌单返回错误: ${metingErrMsg}`)
      }

      let rawList = []
      let playlistName = null

      if (!metingErrMsg) {
        if (Array.isArray(data)) {
          rawList = data
        } else if (data && Array.isArray(data.songs)) {
          rawList = data.songs
          playlistName = data.name || data.title
        } else if (data && Array.isArray(data.data)) {
          rawList = data.data
        } else if (data && data.playlist) {
          const pl = data.playlist
          playlistName = pl.name
          if (Array.isArray(pl.tracks)) rawList = pl.tracks
          else if (Array.isArray(pl.trackIds)) {
            logger.warn(
              "歌单仅返回 trackIds，需完整曲目接口，Meting 可能未返回曲目列表"
            )
          }
        }
      }

      if (rawList.length === 0) {
        logger.info(
          "Meting 未返回曲目，尝试 music-dl-api 歌单接口（若 exe 未实现该路由则会失败）"
        )
        const dl = await fetchPlaylistFromMusicDl(metingServer, playlistId)
        if (dl) {
          rawList = dl.songs
          playlistName = dl.name || playlistName
        }
      }

      const songs = rawList
        .map((item) => mapMetingPlaylistItemToSong(item, metingServer))
        .filter(Boolean)

      if (songs.length === 0) {
        logger.warn(`网页歌单 ${metingServer}/${playlistId} 最终无可用曲目`)
        // 最后兜底：go-music-dl 链接解析（Meting 与歌单接口都失败时）
        if (rawUrlForParse) {
          const dlParsed = await parseViaMusicDl(rawUrlForParse)
          if (dlParsed) return dlParsed
        }
        let errMsg
        if (metingErrMsg) {
          errMsg = `歌单接口返回：${metingErrMsg}。请确认歌单公开、链接未失效，或稍后重试。`
        } else {
          errMsg = "未获取到曲目。请确认链接正确、歌单为公开，或稍后重试。"
        }
        return {
          success: false,
          error: errMsg,
        }
      }

      const platLabel =
        WEB_PLAYLIST_PLATFORM_LABELS[metingServer] || metingServer
      return {
        success: true,
        playlistId,
        platform: metingServer,
        platformLabel: platLabel,
        name: playlistName || `${platLabel}歌单 ${playlistId}`,
        songs,
      }
    }
  )

  // 搜索歌曲
  ipcMain.handle("search-music", async (event, keyword, offset = 0) => {
    logger.info(`开始搜索，关键词：${keyword}，偏移量：${offset}`)
    if (!keyword) return []

    // Meting search 不支持 offset，通过一次多取（offset+PAGE_SIZE）再切片实现分页
    const fetchLimit = offset + PAGE_SIZE
    const metingUrl = `${API_CONFIGS.metingFallback.url}?server=netease&type=search&id=${encodeURIComponent(keyword)}&limit=${fetchLimit}`
    const metingData = await fetchViaProxy(metingUrl)

    if (metingData && Array.isArray(metingData)) {
      logger.info(`Meting API返回 ${metingData.length} 条原始结果`)
      // 先切出当前页再映射过滤，避免映射过程中丢弃条目造成页内索引偏移
      const page = metingData.slice(offset, offset + PAGE_SIZE)
      const songs = page
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
            source: "netease",
            url:
              item.url ||
              `${API_CONFIGS.neteaseAudioUrl.url}?server=netease&type=url&id=${songId}`,
          }
        })
        .filter((item) => item.id)
      logger.info(`解析后得到 ${songs.length} 条有效结果`)
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
        const fs = require("fs").promises
        await fs.writeFile(
          result.filePath,
          JSON.stringify(exportData, null, 2),
          "utf8"
        )
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
  ipcMain.handle("export-user-info", async (event, localData) => {
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
        local: null,
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

      // 附带 renderer 端 localStorage 数据（设置 / 统计 / 音量等）
      userData.local = localData && typeof localData === "object" ? localData : null

      // 打开文件保存对话框
      const result = await dialog.showSaveDialog(window, {
        title: "导出用户信息",
        defaultPath: "User.json",
        filters: [{ name: "JSON文件", extensions: ["json"] }],
      })

      if (!result.canceled && result.filePath) {
        const fs = require("fs").promises
        await fs.writeFile(
          result.filePath,
          JSON.stringify(userData, null, 2),
          "utf8"
        )
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
            await storage.writeJSON(
              "FollowedArtists.json",
              userData.followedArtists
            )
          }

          // 保存自定义歌单
          if (Array.isArray(userData.diyPlaylists)) {
            await storage.writeJSON("DIYSongList.json", userData.diyPlaylists)
          }

          // 保存搜索历史
          if (Array.isArray(userData.searchHistory)) {
            await storage.writeJSON(
              "SearchHistory.json",
              userData.searchHistory
            )
          }

          // 保存最近播放
          if (Array.isArray(userData.latestPlayed)) {
            await storage.writeJSON("Latest.json", userData.latestPlayed)
          }

          logger.info(`用户信息导入成功：${importPath}`)
          return { success: true, local: userData.local || null }
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

        // 生成文件名（净化 playlistId，防止路径遍历写入）
        const safeId = path
          .basename(String(playlistId))
          .replace(/[^\w-]/g, "_")
        const fileName = `${safeId}.${format}`
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
      
      // 支持的音频格式
      const supportedFormats = ["mp3", "wav", "flac", "m4a", "ogg", "wma"]

      for (const file of files) {
        const ext = path.extname(file).toLowerCase()
        const extWithoutDot = ext.substring(1).toLowerCase()
        
        if (supportedFormats.includes(extWithoutDot)) {
          const filePath = path.join(localDir, file)

          // 提取歌曲信息（简单处理，实际项目中可能需要更复杂的解析）
          const fileName = path.basename(file, path.extname(file))
          const songInfo = fileName.split(" - ")

          songs.push({
            id: stableLocalSongId(file),
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
            id: stableLocalSongId(fileName),
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
      const path = require("path")
      const localDir = path.resolve(storage.ROOT_DIR, "ImportLocalSongs")
      const target = path.resolve(songUrl)
      // 仅允许删除导入目录内的文件，防止渲染端传入任意路径造成任意文件删除
      if (target !== localDir && !target.startsWith(localDir + path.sep)) {
        logger.warn(`拒绝删除导入目录之外的文件：${target}`)
        return { success: false, error: "仅允许删除已导入的本地歌曲" }
      }
      await fs.unlink(target)
      logger.info(`本地歌曲删除成功：${target}`)
      return { success: true }
    } catch (err) {
      logger.error(`删除本地歌曲失败：${err.message}`)
      return { success: false, error: err.message }
    }
  })

  function sanitizeDownloadFilename(name) {
    return (
      String(name || "untitled")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/\.+$/, "")
        .trim()
        .slice(0, 180) || "untitled"
    )
  }

  function isNestedMetingUrl(u) {
    const s = String(u || "")
    return (
      s.includes("type=url") &&
      (s.includes("qijieya.cn") || s.includes("/meting"))
    )
  }

  function extractUrlFromMetingPayload(data, depth = 0) {
    if (depth > 10) return null
    if (data == null) return null
    if (typeof data === "string") {
      const t = data.trim()
      if (/^https?:\/\//i.test(t)) {
        const first = t.split(/\s/)[0].replace(/^["']|["']$/g, "")
        if (first) return first
      }
      try {
        return extractUrlFromMetingPayload(JSON.parse(t), depth + 1)
      } catch (e) {
        return null
      }
    }
    if (typeof data === "object") {
      const keyCandidates = [
        "url",
        "playUrl",
        "play_url",
        "link",
        "src",
        "music_url",
        "audio",
      ]
      for (const k of keyCandidates) {
        const v = data[k]
        if (typeof v === "string" && /^https?:\/\//i.test(v)) {
          const u = v.split(/\s/)[0]
          if (u) return u
        }
      }
      if (typeof data.data === "string" && /^https?:\/\//i.test(data.data)) {
        const u = data.data.trim().split(/\s/)[0]
        if (u) return u
      }
      if (data.data != null) {
        const u = extractUrlFromMetingPayload(data.data, depth + 1)
        if (u) return u
      }
      if (Array.isArray(data) && data.length) {
        const u = extractUrlFromMetingPayload(data[0], depth + 1)
        if (u) return u
      }
      if (typeof data.url === "string" && /^https?:\/\//i.test(data.url)) {
        return String(data.url).split(/\s/)[0]
      }
    }
    return null
  }

  /** 从整段文本中用正则兜底提取直链（非 Meting 网关） */
  function extractAudioUrlFromRawText(text) {
    if (!text || typeof text !== "string") return null
    const s = text.trim()
    const patterns = [
      /"url"\s*:\s*"([^"]+)"/i,
      /'url'\s*:\s*'([^']+)'/i,
      /https?:\/\/[^\s"'<>]+\.(?:mp3|m4a|flac|aac|ogg|wav)(?:\?[^\s"'<>]*)?/i,
      /https?:\/\/[^\s"'<>]+music\.126\.net[^\s"'<>]*/i,
      /https?:\/\/[^\s"'<>]+qq\.com[^\s"'<>]*/i,
    ]
    for (const re of patterns) {
      const m = s.match(re)
      if (!m) continue
      const cand = (m[1] || m[0]).replace(/\\\//g, "/")
      if (/^https?:\/\//i.test(cand) && !isNestedMetingUrl(cand)) return cand
    }
    return null
  }

  function getRefererForMediaUrl(url) {
    const u = String(url || "")
    if (/qq\.com|y\.qq|tencent/i.test(u)) return "https://y.qq.com/"
    if (/kugou|kuwo/i.test(u)) return "https://www.kugou.com/"
    return "https://music.163.com/"
  }

  function getRefererForMetingApiRequest(apiUrl) {
    try {
      const u = new URL(apiUrl)
      const server = (u.searchParams.get("server") || "").toLowerCase()
      if (server === "tencent" || server === "qq") {
        return "https://y.qq.com/"
      }
      if (server === "kugou" || server === "kuwo") {
        return "https://www.kugou.com/"
      }
    } catch (e) {}
    return "https://music.163.com/"
  }

  /** 根据文件头判断是否为常见音频容器/编码（Meting 可能直接返回二进制流而非 JSON） */
  function bufferLooksLikeAudioMagic(buf) {
    if (!buf || buf.length < 4) return false
    const b0 = buf[0]
    const b1 = buf[1]
    const b2 = buf[2]
    const b3 = buf[3]
    if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return true
    if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return true
    if (b0 === 0x66 && b1 === 0x4c && b2 === 0x61 && b3 === 0x43) return true
    if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) return true
    if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) return true
    if (
      buf.length >= 8 &&
      buf[4] === 0x66 &&
      buf[5] === 0x74 &&
      buf[6] === 0x79 &&
      buf[7] === 0x70
    ) {
      return true
    }
    return false
  }

  /**
   * 探测 Meting type=url 是否直接输出音频流（仅读前几 KB，避免整包进内存）。
   */
  async function probeMetingUrlReturnsDirectAudio(apiUrl) {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: getRefererForMetingApiRequest(apiUrl),
      Accept: "*/*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    try {
      const res = await axios({
        method: "get",
        url: apiUrl,
        responseType: "stream",
        timeout: 20000,
        maxRedirects: 5,
        headers,
        validateStatus: (s) => s >= 200 && s < 400,
      })
      const stream = res.data
      const ct = String(res.headers["content-type"] || "").toLowerCase()
      const chunks = []
      let total = 0
      const cap = 32768
      return await new Promise((resolve) => {
        let settled = false
        const done = (hit) => {
          if (settled) return
          settled = true
          try {
            stream.destroy()
          } catch (e) {}
          resolve(hit)
        }
        stream.on("data", (c) => {
          chunks.push(c)
          total += c.length
          const buf = Buffer.concat(chunks)
          if (buf.length >= 4) {
            if (bufferLooksLikeAudioMagic(buf)) done(true)
            else if (buf[0] === 0x7b || buf[0] === 0x5b) done(false)
          }
          if (total >= cap) done(false)
        })
        stream.on("end", () => {
          const buf = Buffer.concat(chunks)
          if (!settled) {
            if (bufferLooksLikeAudioMagic(buf)) done(true)
            else if (
              (ct.includes("audio/") || ct.includes("octet-stream")) &&
              buf.length >= 4
            ) {
              done(true)
            } else done(false)
          }
        })
        stream.on("error", () => done(false))
      })
    } catch (e) {
      return false
    }
  }

  /**
   * 解析 Meting type=url 接口为真实 CDN 地址。
   * @returns {{ url: string, reason: null, detail: string } | { url: null, reason: string, detail: string }}
   */
  async function resolveMetingMediaUrl(apiUrl, depth = 0) {
    const ok = (url) => ({ url, reason: null, detail: "" })
    const fail = (reason, detail = "") => ({
      url: null,
      reason,
      detail: String(detail || "").slice(0, 500),
    })

    if (!apiUrl) return fail("下载地址为空", "")
    if (
      !apiUrl.includes("type=url") ||
      (!apiUrl.includes("qijieya.cn") && !apiUrl.includes("/meting"))
    ) {
      return ok(apiUrl)
    }
    if (depth > 4) {
      return fail("Meting 嵌套解析超过层数限制", "请检查接口是否返回循环跳转")
    }

    try {
      const directAudio = await probeMetingUrlReturnsDirectAudio(apiUrl)
      if (directAudio) {
        logger.info(
          `Meting type=url 直接返回音频流，将用同一 URL 发起下载: ${String(apiUrl).slice(0, 96)}`
        )
        return ok(apiUrl)
      }

      const res = await axios.get(apiUrl, {
        timeout: 25000,
        maxRedirects: 5,
        responseType: "text",
        transformResponse: [(data) => data],
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Referer: getRefererForMetingApiRequest(apiUrl),
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        validateStatus: (s) => s >= 200 && s < 400,
      })
      const text = String(res.data || "").trim()
      let parsed = extractUrlFromMetingPayload(text)
      if (!parsed) {
        try {
          const j = JSON.parse(text)
          parsed = extractUrlFromMetingPayload(j)
          if (!parsed) {
            const code = j.code
            const bizMsg = j.msg || j.message || j.error
            const codeBad =
              code !== undefined &&
              code !== null &&
              code !== 200 &&
              code !== 0 &&
              code !== "200"
            if (codeBad && bizMsg) {
              return fail("Meting 接口返回错误", String(bizMsg).slice(0, 300))
            }
          }
        } catch (e) {}
      }
      if (!parsed) {
        parsed = extractAudioUrlFromRawText(text)
      }
      if (parsed) {
        if (isNestedMetingUrl(parsed)) {
          return await resolveMetingMediaUrl(parsed, depth + 1)
        }
        return ok(parsed)
      }
      // 不再用语义模糊的正则去猜「业务失败」，避免把正常文案误判为错误（乱报错）
      logger.warn(`Meting 未解析出直链，片段: ${text.slice(0, 400)}`)
      return fail(
        "接口响应中未找到音频直链",
        text.length ? `响应片段: ${text.slice(0, 280)}` : "空响应"
      )
    } catch (e) {
      const st = e.response && e.response.status
      const raw = e.response && e.response.data
      let detail = e.message || String(e)
      if (st) {
        const body =
          typeof raw === "string"
            ? raw.slice(0, 220)
            : raw
              ? JSON.stringify(raw).slice(0, 220)
              : ""
        detail = `HTTP ${st}${body ? ` — ${body}` : ""}`
      }
      logger.warn(`Meting 请求异常: ${detail}`)
      return fail(
        st ? `请求解析接口失败（HTTP ${st}）` : "请求 Meting 解析接口失败",
        detail
      )
    }
  }

  async function downloadBinaryToFile(streamUrl, destPath, onProgress, depth = 0) {
    if (depth > 5) {
      throw new Error("音频地址重定向层级过深，已中止下载")
    }
    const fsSync = require("fs")
    const referer = getRefererForMediaUrl(streamUrl)

    const response = await axios({
      method: "get",
      url: streamUrl,
      responseType: "stream",
      timeout: 120000,
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: referer,
        Accept: "*/*",
      },
      validateStatus: (s) => s >= 200 && s < 400,
    })

    const ct = String(response.headers["content-type"] || "").toLowerCase()
    if (
      ct.includes("application/json") ||
      ct.includes("text/json") ||
      (ct.includes("text/plain") && !ct.includes("audio"))
    ) {
      const chunks = []
      await new Promise((resolve, reject) => {
        response.data.on("data", (c) => chunks.push(c))
        response.data.on("end", resolve)
        response.data.on("error", reject)
      })
      const body = Buffer.concat(chunks).toString("utf8").trim()
      const inner = extractUrlFromMetingPayload(body)
      if (inner && /^https?:\/\//i.test(inner)) {
        return downloadBinaryToFile(inner, destPath, onProgress, depth + 1)
      }
      try {
        const j = JSON.parse(body)
        const inner2 = extractUrlFromMetingPayload(j)
        if (inner2 && /^https?:\/\//i.test(inner2)) {
          return downloadBinaryToFile(inner2, destPath, onProgress, depth + 1)
        }
        if (j && j.message) {
          throw new Error(String(j.message))
        }
      } catch (e) {
        if (e.message && !e.message.startsWith("Unexpected")) throw e
      }
      throw new Error("服务器返回非音频数据，请换音质或稍后重试")
    }

    const total = parseInt(response.headers["content-length"], 10) || 0
    let received = 0
    const writer = fsSync.createWriteStream(destPath)
    await new Promise((resolve, reject) => {
      response.data.on("data", (chunk) => {
        received += chunk.length
        if (typeof onProgress === "function") {
          onProgress(received, total)
        }
      })
      response.data.pipe(writer)
      writer.on("finish", resolve)
      writer.on("error", reject)
      response.data.on("error", reject)
    })
  }

  // 批量下载在线歌曲到 ImportLocalSongs
  ipcMain.handle("download-audio-files", async (event, payload) => {
    const fs = require("fs").promises
    const fsSync = require("fs")
    const path = require("path")
    const songs = Array.isArray(payload?.songs) ? payload.songs : []
    const quality = payload?.quality || "high"
    const customDir =
      payload?.targetDir && String(payload.targetDir).trim()
        ? path.resolve(String(payload.targetDir).trim())
        : null
    const localDir =
      customDir || path.join(storage.ROOT_DIR, "ImportLocalSongs")
    await fs.mkdir(localDir, { recursive: true })

    const results = {
      success: true,
      ok: 0,
      fail: 0,
      skipped: 0,
      errors: [],
    }

    function uniqueDestPath(base, ext) {
      let candidate = path.join(localDir, `${base}${ext}`)
      let n = 1
      while (fsSync.existsSync(candidate)) {
        candidate = path.join(localDir, `${base} (${n})${ext}`)
        n++
      }
      return candidate
    }

    // music-dl 支持直链下载的源（ID 与源站接口一致）
    const MUSIC_DL_DOWNLOAD_SOURCES = new Set([
      "netease",
      "tencent",
      "qq",
      "kugou",
      "kuwo",
      "migu",
      "bilibili",
    ])

    // 经 go-music-dl /api/download 下载：源站最优音质 + ID3/FLAC 标签、封面、歌词嵌入
    async function downloadViaMusicDl(song, base, onFileProgress) {
      const params = new URLSearchParams()
      params.set("id", String(song.songId || song.id || ""))
      params.set("source", String(song.source || ""))
      params.set("name", song.name || "")
      params.set("artist", song.artist || "")
      params.set("album", typeof song.album === "string" ? song.album : "")
      params.set("cover", song.coverUrl || "")
      const resp = await axios.get(
        `${musicDlService.getBaseUrl()}/api/download?${params.toString()}`,
        {
          responseType: "stream",
          timeout: 300000,
          validateStatus: (s) => s === 200,
        }
      )
      const extRaw = String(resp.headers["x-audio-ext"] || "").replace(
        /[^a-z0-9]/gi,
        ""
      )
      const ext = extRaw ? "." + extRaw.toLowerCase() : ".mp3"
      const destPath = uniqueDestPath(base, ext)
      const totalBytes =
        parseInt(resp.headers["content-length"] || "0", 10) || 0
      try {
        await new Promise((resolve, reject) => {
          const ws = fsSync.createWriteStream(destPath)
          let received = 0
          resp.data.on("data", (c) => {
            received += c.length
            if (onFileProgress) onFileProgress(received, totalBytes)
          })
          resp.data.on("error", reject)
          ws.on("error", reject)
          ws.on("finish", resolve)
          resp.data.pipe(ws)
        })
      } catch (err) {
        try {
          fsSync.unlinkSync(destPath)
        } catch (e) {}
        throw err
      }
      const warning = String(resp.headers["x-musicdl-warning"] || "")
      if (warning) logger.warn(`下载元数据嵌入警告: ${warning}`)
      return destPath
    }

    const safeSend = (payload) => {
      try {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send("download-progress", payload)
        }
      } catch (e) {}
    }

    safeSend({
      phase: "start",
      total: songs.length,
    })

    try {
      for (let i = 0; i < songs.length; i++) {
        const song = songs[i]
        const base = sanitizeDownloadFilename(
          `${song.artist || "未知"} - ${song.name || "unknown"}`
        )

        const sendFileProgress = (received, totalBytes) => {
          const filePct = totalBytes > 0 ? received / totalBytes : 0
          const overall = (i + filePct) / songs.length
          safeSend({
            phase: "progress",
            index: i + 1,
            total: songs.length,
            songName: song?.name || "",
            overallPercent: Math.min(100, Math.round(overall * 100)),
            filePercent: totalBytes > 0 ? Math.round(filePct * 100) : null,
          })
        }

        // music-dl 元数据下载优先（标签/封面/歌词嵌入），失败回退 Meting 流程
        if (
          song &&
          !song.local &&
          MUSIC_DL_DOWNLOAD_SOURCES.has(String(song.source || "").toLowerCase())
        ) {
          try {
            safeSend({
              phase: "song",
              index: i + 1,
              total: songs.length,
              songName: song?.name || "",
              status: "downloading",
              overallPercent: Math.round((i / songs.length) * 100),
            })
            const destPath = await downloadViaMusicDl(
              song,
              base,
              sendFileProgress
            )
            results.ok++
            logger.info(`下载完成(含元数据): ${path.basename(destPath)}`)
            safeSend({
              phase: "song",
              index: i + 1,
              total: songs.length,
              songName: song?.name || "",
              status: "ok",
              overallPercent: Math.round(((i + 1) / songs.length) * 100),
            })
            continue
          } catch (e) {
            logger.warn(
              `music-dl 下载失败 ${song?.name}: ${e.message}，回退 Meting 流程`
            )
          }
        }

        let built = null
        try {
          built = buildDownloadUrlForSong(song, quality)
        } catch (e) {
          built = null
        }
        if (!built) {
          results.skipped++
          results.errors.push({
            name: song?.name,
            reason: "无法解析下载地址",
          })
          safeSend({
            phase: "song",
            index: i + 1,
            total: songs.length,
            songName: song?.name || "",
            status: "skipped",
            overallPercent: Math.round(((i + 1) / songs.length) * 100),
          })
          continue
        }

        const resolved = await resolveMetingMediaUrl(built)
        let streamUrl = resolved.url
        if (!streamUrl) {
          if (
            built.includes("type=url") &&
            (built.includes("qijieya.cn") || built.includes("/meting"))
          ) {
            results.fail++
            results.errors.push({
              name: song?.name,
              reason: resolved.reason || "无法解析 Meting 音频地址",
              detail: resolved.detail || "",
            })
            safeSend({
              phase: "song",
              index: i + 1,
              total: songs.length,
              songName: song?.name || "",
              status: "fail",
              overallPercent: Math.round(((i + 1) / songs.length) * 100),
            })
            continue
          }
          streamUrl = built
        }

        let ext = ".mp3"
        if (/\.flac(\?|$)/i.test(streamUrl)) ext = ".flac"
        else if (/\.m4a(\?|$)/i.test(streamUrl)) ext = ".m4a"

        try {
          const destPath = uniqueDestPath(base, ext)
          safeSend({
            phase: "song",
            index: i + 1,
            total: songs.length,
            songName: song?.name || "",
            status: "downloading",
            overallPercent: Math.round((i / songs.length) * 100),
          })
          await downloadBinaryToFile(streamUrl, destPath, sendFileProgress)
          results.ok++
          logger.info(`下载完成: ${path.basename(destPath)}`)
          safeSend({
            phase: "song",
            index: i + 1,
            total: songs.length,
            songName: song?.name || "",
            status: "ok",
            overallPercent: Math.round(((i + 1) / songs.length) * 100),
          })
        } catch (err) {
          results.fail++
          results.errors.push({
            name: song?.name,
            reason: err.message || String(err),
          })
          logger.error(`下载失败 ${song?.name}: ${err.message}`)
          safeSend({
            phase: "song",
            index: i + 1,
            total: songs.length,
            songName: song?.name || "",
            status: "fail",
            overallPercent: Math.round(((i + 1) / songs.length) * 100),
          })
        }
      }
    } finally {
      safeSend({
        phase: "complete",
        ok: results.ok,
        fail: results.fail,
        skipped: results.skipped,
        errors: results.errors.slice(0, 5),
      })
    }

    return results
  })

  ipcMain.handle("select-download-directory", async (event) => {
    logger.info("选择下载保存目录")
    const window = event.sender.getOwnerBrowserWindow()
    try {
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
        title: "选择下载保存文件夹",
      })
      if (result.canceled || !result.filePaths?.length) return null
      return result.filePaths[0]
    } catch (err) {
      logger.error(`选择目录失败：${err.message}`)
      return null
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

  // 音乐下载服务相关
  ipcMain.handle(
    "musicDlSearch",
    async (event, keyword, sources = "netease", page = 1, limit = 10) => {
      logger.info(
        `音乐下载服务搜索：q=${keyword}, sources=${sources}, page=${page}, limit=${limit}`
      )
      try {
        const baseUrl = musicDlService.getBaseUrl()
        const apiUrl = `${baseUrl}/api/search`

        let response
        try {
          response = await axios.get(apiUrl, {
            params: {
              q: keyword,
              sources,
              page,
              limit,
            },
            timeout: 30000, // 30秒超时
          })
        } catch (error) {
          logger.error(`音乐下载服务搜索失败: ${error.message}`)
          if (error.response) {
            logger.error(`响应状态：${error.response.status}`)
          }
          return { error: error.message }
        }

        const count =
          response.data && Array.isArray(response.data.songs)
            ? response.data.songs.length
            : 0
        logger.info(`音乐下载服务搜索返回 ${count} 条结果`)
        return response.data
      } catch (error) {
        logger.error("音乐下载服务搜索失败:", error)
        logger.error(`错误详情：${error.message}`)
        return { error: error.message }
      }
    }
  )

  ipcMain.handle("musicDlLyric", async (event, id, source) => {
    logger.info(`获取音乐下载服务歌词：${id}，源：${source}`)
    try {
      const baseUrl = musicDlService.getBaseUrl()
      const response = await axios.get(`${baseUrl}/api/lyric`, {
        params: {
          id,
          source,
        },
      })
      return response.data
    } catch (error) {
      logger.error("获取音乐下载服务歌词失败:", error)
      return { error: error.message }
    }
  })

  ipcMain.handle("musicDlStatus", async () => {
    return {
      running: musicDlService.isRunning(),
      baseUrl: musicDlService.getBaseUrl(),
    }
  })

  // 排行榜列表（复用 go-music-dl 的 toplist 能力）
  ipcMain.handle("musicDlToplists", async (event, source = "netease") => {
    try {
      const response = await axios.get(
        `${musicDlService.getBaseUrl()}/api/toplists`,
        { params: { source }, timeout: 30000 }
      )
      return response.data
    } catch (error) {
      logger.error(`获取排行榜失败(${source}):`, error.message)
      return { error: error.message }
    }
  })

  // 榜单内歌曲
  ipcMain.handle(
    "musicDlToplistSongs",
    async (event, source, id, name = "") => {
      try {
        const response = await axios.get(
          `${musicDlService.getBaseUrl()}/api/toplist_songs`,
          { params: { source, id }, timeout: 60000 }
        )
        return response.data
      } catch (error) {
        logger.error(`获取榜单歌曲失败(${source}/${name}/${id}):`, error.message)
        return { error: error.message }
      }
    }
  )

  // 歌单广场：分类列表
  ipcMain.handle(
    "musicDlPlaylistCategories",
    async (event, source = "netease") => {
      try {
        const response = await axios.get(
          `${musicDlService.getBaseUrl()}/api/playlist_categories`,
          { params: { source }, timeout: 30000 }
        )
        return response.data
      } catch (error) {
        logger.error(`获取歌单分类失败(${source}):`, error.message)
        return { error: error.message }
      }
    }
  )

  // 歌单广场：分类下歌单列表
  ipcMain.handle(
    "musicDlCategoryPlaylists",
    async (event, source, categoryId, page = 1, limit = 60) => {
      try {
        const response = await axios.get(
          `${musicDlService.getBaseUrl()}/api/category_playlists`,
          { params: { source, category_id: categoryId, page, limit }, timeout: 60000 }
        )
        return response.data
      } catch (error) {
        logger.error(
          `获取分类歌单失败(${source}/${categoryId}):`,
          error.message
        )
        return { error: error.message }
      }
    }
  )

  // 扫码登录：创建会话
  ipcMain.handle("musicDlQrCreate", async (event, source = "netease") => {
    try {
      const response = await axios.get(
        `${musicDlService.getBaseUrl()}/api/qr_create`,
        { params: { source }, timeout: 30000 }
      )
      return response.data
    } catch (error) {
      logger.error(`创建扫码登录会话失败(${source}):`, error.message)
      return { error: error.message }
    }
  })

  // 扫码登录：轮询状态
  ipcMain.handle(
    "musicDlQrCheck",
    async (event, source, key = "") => {
      try {
        const response = await axios.get(
          `${musicDlService.getBaseUrl()}/api/qr_check`,
          { params: { source, key }, timeout: 30000 }
        )
        return response.data
      } catch (error) {
        logger.error(`查询扫码状态失败(${source}):`, error.message)
        return { error: error.message }
      }
    }
  )

  // 扫码登录：登录状态查询/退出
  ipcMain.handle(
    "musicDlLoginStatus",
    async (event, source = "netease") => {
      try {
        const response = await axios.get(
          `${musicDlService.getBaseUrl()}/api/login_status`,
          { params: { source }, timeout: 15000 }
        )
        return response.data
      } catch (error) {
        logger.error(`查询登录状态失败(${source}):`, error.message)
        return { error: error.message }
      }
    }
  )

  ipcMain.handle("musicDlLogout", async (event, source = "netease") => {
    try {
      const response = await axios.get(
        `${musicDlService.getBaseUrl()}/api/logout`,
        { params: { source }, timeout: 15000 }
      )
      return response.data
    } catch (error) {
      logger.error(`退出登录失败(${source}):`, error.message)
      return { error: error.message }
    }
  })

  // 已登录用户的歌单
  ipcMain.handle(
    "musicDlUserPlaylists",
    async (event, source, page = 1, limit = 100) => {
      try {
        const response = await axios.get(
          `${musicDlService.getBaseUrl()}/api/user_playlists`,
          { params: { source, page, limit }, timeout: 60000 }
        )
        return response.data
      } catch (error) {
        logger.error(`获取用户歌单失败(${source}):`, error.message)
        return { error: error.message }
      }
    }
  )

  // QR 图片 URL（供渲染层 img.src 使用）
  ipcMain.handle("musicDlQrImageUrl", async (event, text, size = 280) => {
    return `${musicDlService.getBaseUrl()}/api/qr_image?text=${encodeURIComponent(
      text
    )}&size=${size}`
  })

  // 推荐歌单（复用 go-music-dl 的推荐能力）
  ipcMain.handle("musicDlRecommend", async (event, source = "netease") => {
    try {
      const response = await axios.get(
        `${musicDlService.getBaseUrl()}/api/recommend`,
        { params: { source }, timeout: 30000 }
      )
      return response.data
    } catch (error) {
      logger.error(`获取推荐歌单失败(${source}):`, error.message)
      return { error: error.message }
    }
  })

  // 歌单内曲目（按源+歌单ID拉取，含推荐歌单/搜索到的歌单）
  ipcMain.handle(
    "musicDlPlaylistDetail",
    async (event, source, id, name = "") => {
      try {
        const response = await axios.get(
          `${musicDlService.getBaseUrl()}/api/playlist`,
          { params: { source, id }, timeout: 60000 }
        )
        return response.data
      } catch (error) {
        logger.error(`获取歌单曲目失败(${source}/${name}/${id}):`, error.message)
        return { error: error.message }
      }
    }
  )

  // ===== 歌手页：多源专辑搜索 + 专辑详情（go-music-dl）=====

  ipcMain.handle("musicDlAlbumSearch", async (event, keyword) => {
    const kw = String(keyword || "").trim()
    if (!kw) return { error: "missing keyword" }
    try {
      const response = await axios.get(
        `${musicDlService.getBaseUrl()}/api/album_search`,
        { params: { q: kw }, timeout: 60000 }
      )
      return response.data
    } catch (error) {
      logger.error(`专辑搜索失败(${kw}):`, error.message)
      return { error: error.message }
    }
  })

  ipcMain.handle(
    "musicDlAlbum",
    async (event, source, id, name = "") => {
      try {
        const response = await axios.get(
          `${musicDlService.getBaseUrl()}/api/album`,
          { params: { source, id, name }, timeout: 60000 }
        )
        return response.data
      } catch (error) {
        logger.error(`获取专辑曲目失败(${source}/${name}/${id}):`, error.message)
        return { error: error.message }
      }
    }
  )

  // 按歌曲 id 解析在线歌曲详情（名称/歌手/真实封面/歌词），用于补全封面与歌词页沉浸背景
  ipcMain.handle("music-song-detail", async (event, server, id) => {
    const srv = String(server || "netease")
    const songId = String(id)
    try {
      const api =
        "https://api.qijieya.cn/meting/?server=" +
        encodeURIComponent(srv) +
        "&type=song&id=" +
        encodeURIComponent(songId)
      const resp = await axios.get(api, { timeout: 15000 })
      const arr = resp.data
      if (Array.isArray(arr) && arr.length && arr[0]) {
        return { success: true, ...arr[0] }
      }
      return { success: false, error: "empty" }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  logger.info("IPC 处理器初始化完成")
}

module.exports = {
  initIpcHandlers,
}
