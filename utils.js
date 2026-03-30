const axios = require("axios")
const logger = require("./src/main/services/logger")

// API配置
exports.API_CONFIGS = {
  neteaseSearch: { url: "https://163api.qijieya.cn/cloudsearch" },
  metingFallback: { url: "https://api.qijieya.cn/meting/" },
  neteaseSongDetail: { url: "https://163api.qijieya.cn/song/detail" },
  neteaseLyric: { url: "https://163api.qijieya.cn/lyric/new" },
  neteaseAudioUrl: { url: "https://api.qijieya.cn/meting/" },
}

// CORS代理请求（本地开发请使用这个）
exports.fetchViaProxy = async (targetUrl) => {
  logger.info(`发起请求：${targetUrl}`)
  let text

  // 直连请求
  try {
    logger.info(`尝试直连请求：${targetUrl}`)
    const response = await axios.get(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://music.163.com/",
        Origin: "https://music.163.com/",
      },
      timeout: 10000,
    })
    if (response.status !== 200)
      throw new Error(`直连失败，状态码：${response.status}`)
    text = JSON.stringify(response.data)
    logger.info(`直连请求成功，返回数据长度：${text.length}`)
    return JSON.parse(text)
  } catch (directErr) {
    // 代理请求
    logger.warn(`直连失败（原因：${directErr.message}），尝试CORS代理`)
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
      logger.info(`代理请求地址：${proxyUrl}`)
      const proxyRes = await axios.get(proxyUrl, { timeout: 15000 })
      if (proxyRes.status !== 200)
        throw new Error(`代理失败，状态码：${proxyRes.status}`)
      text = proxyRes.data
      const result = typeof text === "string" ? JSON.parse(text) : text
      logger.info(
        `代理请求成功，返回数据长度：${JSON.stringify(result).length}`
      )
      return result
    } catch (proxyErr) {
      logger.error(
        `直连+代理都失败：${proxyErr.message}，目标地址：${targetUrl}`
      )
      return null
    }
  }
}

// 格式化函数
exports.formatArtists = (artists) => {
  return (
    (artists ?? [])
      .map((artist) => artist.name?.trim())
      .filter(Boolean)
      .join("/") || "未知歌手"
  )
}

exports.mapNeteaseSongToTrack = (song) => {
  if (!song || !song.id) return null
  return {
    id: song.id.toString(),
    songId: song.id.toString(),
    name: song.name?.trim() ?? "未知歌曲",
    artist: exports.formatArtists(song.ar),
    album: song.al?.name?.trim() ?? "未知专辑",
    coverUrl: song.al?.picUrl?.replaceAll("http:", "https:") ?? "",
    duration: song.dt ?? 0,
    url: `${exports.API_CONFIGS.neteaseAudioUrl.url}?type=url&id=${song.id}`,
  }
}

// 歌词解析
const TIMESTAMP_REGEX = /^\[(\d{2}):(\d{2})[\.:](\d{2,3})\](.*)$/
const METADATA_KEYWORDS = ["歌词贡献者", "翻译贡献者", "作词", "作曲", "编曲"]
const metadataKeywordPattern = METADATA_KEYWORDS.map((keyword) => {
  return keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}).join("|");
const metadataKeywordRegex = new RegExp(`^(${metadataKeywordPattern})\\s*[:：]`, "iu")

exports.extractCleanLyrics = (content) => {
  if (!content) return { clean: "", metadata: [] }
  const metadataSet = new Set()
  const bodyLines = []

  content.split("\n").forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    if (trimmed.match(TIMESTAMP_REGEX)) {
      const match = trimmed.match(TIMESTAMP_REGEX)
      const content = match[4].trim()
      if (metadataKeywordRegex.test(content)) {
        metadataSet.add(content)
        return
      }
    }
    bodyLines.push(line)
  })

  return {
    clean: bodyLines.join("\n").trim(),
    metadata: Array.from(metadataSet),
  }
}

// 获取歌词
exports.fetchLyricsById = async (songId) => {
  if (!songId) return null
  // 使用Meting API获取歌词
  const lyricUrl = `${exports.API_CONFIGS.metingFallback.url}?server=netease&type=lrc&id=${songId}`
  const lyricData = await exports.fetchViaProxy(lyricUrl)

  if (!lyricData) return null

  // 处理返回的数据
  let lrc = ""
  let tlrc = ""
  const metadata = []

  if (typeof lyricData === "string") {
    // 如果返回的是字符串，直接作为歌词
    lrc = lyricData
  } else if (lyricData.lrc) {
    // 如果返回的是对象，提取lrc字段
    lrc = lyricData.lrc
  }

  return {
    lrc: lrc || "",
    tlrc: tlrc || "",
    metadata: metadata,
  }
}

/**
 * 从网易云歌单链接或纯数字 ID 中解析歌单 ID。
 * 仅识别 163 / 网易云域名，避免与 QQ 音乐等 /playlist/ 路径混淆。
 */
exports.parseNeteasePlaylistId = (input) => {
  const raw = String(input || "").trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return raw
  if (!/163\.com|y\.music/i.test(raw)) return null
  const pathMatch = raw.match(/\/playlist\/(\d+)/)
  if (pathMatch) return pathMatch[1]
  const idInQuery = raw.match(/[?&]id=(\d+)/)
  if (idInQuery) return idInQuery[1]
  return null
}

function parseQQPlaylistId(input) {
  const raw = String(input || "").trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return raw
  const m1 = raw.match(/\/playlist\/(\d+)/i)
  if (m1 && /y\.qq\.com|qq\.com/i.test(raw)) return m1[1]
  const m2 = raw.match(/[?&](?:id|disstid)=(\d+)/i)
  if (m2 && /y\.qq|qq\.com/i.test(raw)) return m2[1]
  return null
}

function detectPlaylistHostPlatform(input) {
  const raw = String(input || "").trim()
  if (!raw) return null
  const s = raw.toLowerCase()
  if (/163\.com|y\.music/i.test(s)) return "netease"
  if (/y\.qq\.com|\/\/y\.qq|qq\.com\/n\/ryqq/i.test(s)) return "tencent"
  return null
}

/**
 * 解析网页歌单链接或「平台 + 纯数字 ID」（仅网易云、QQ音乐）。
 * @param {string} forced 平台：auto | netease | tencent
 */
exports.parseWebPlaylistUrl = (input, forced = "auto") => {
  const raw = String(input || "").trim()
  if (!raw) return null

  const f = forced && forced !== "auto" ? forced : null

  if (f === "netease") {
    const id = exports.parseNeteasePlaylistId(raw)
    return id ? { server: "netease", id } : null
  }
  if (f === "tencent") {
    const id = parseQQPlaylistId(raw)
    return id ? { server: "tencent", id } : null
  }

  const host = detectPlaylistHostPlatform(raw)
  if (!host) return null
  if (host === "netease") {
    const id = exports.parseNeteasePlaylistId(raw)
    return id ? { server: "netease", id } : null
  }
  if (host === "tencent") {
    const id = parseQQPlaylistId(raw)
    return id ? { server: "tencent", id } : null
  }
  return null
}

exports.WEB_PLAYLIST_PLATFORM_LABELS = {
  netease: "网易云音乐",
  tencent: "QQ音乐",
}

/** Meting `br` 参数：标准 / 较高 / 无损 */
exports.AUDIO_QUALITY_BR = {
  standard: 128000,
  high: 320000,
  lossless: 999000,
}

/**
 * Meting `server` 参数，与搜索/歌单里的 source 字段对齐（多平台下载必用）。
 */
exports.metingServerFromSource = (src) => {
  const s = String(src ?? "netease").toLowerCase().trim()
  if (s === "qq" || s === "tencent" || s === "tx") return "tencent"
  if (s === "kugou" || s === "kg") return "kugou"
  if (s === "kuwo" || s === "kw") return "kuwo"
  if (s === "migu" || s === "mg") return "migu"
  if (s === "bilibili" || s === "bili") return "bilibili"
  if (s === "xiami" || s === "xm") return "xiami"
  return "netease"
}

/**
 * 为下载构造可请求的音频 URL（Meting 带 br，直链则原样返回）。
 * @param {object} song
 * @param {"standard"|"high"|"lossless"} qualityKey
 * @returns {string|null}
 */
exports.buildDownloadUrlForSong = (song, qualityKey = "high") => {
  const br =
    exports.AUDIO_QUALITY_BR[qualityKey] || exports.AUDIO_QUALITY_BR.high
  if (!song || song.local) return null
  const rawUrl = song.url || ""
  if (/^[a-zA-Z]:\\/.test(rawUrl) || rawUrl.startsWith("file:")) return null

  const hasHttp =
    rawUrl &&
    (rawUrl.startsWith("http://") || rawUrl.startsWith("https://"))

  const src = song.source
  const server = exports.metingServerFromSource(src)
  const srcNorm = String(src ?? "").toLowerCase()

  if (hasHttp && (srcNorm === "kugou" || srcNorm === "kuwo")) return rawUrl

  if (
    !hasHttp ||
    (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://"))
  ) {
    const sid = song.songId || song.id
    if (!sid) return null
    return `${exports.API_CONFIGS.neteaseAudioUrl.url}?server=${server}&type=url&id=${encodeURIComponent(String(sid))}&br=${br}`
  }

  const looksLikeDirect =
    /\.(mp3|m4a|flac|aac|ogg|wav)(\?|$)/i.test(rawUrl) &&
    !rawUrl.includes("type=url")
  if (looksLikeDirect) return rawUrl

  if (
    rawUrl.includes("type=url") &&
    (rawUrl.includes("qijieya.cn") || rawUrl.includes("/meting"))
  ) {
    try {
      const u = new URL(rawUrl)
      u.searchParams.set("br", String(br))
      if (!u.searchParams.get("server")) {
        u.searchParams.set("server", server)
      }
      return u.toString()
    } catch (e) {
      return rawUrl
    }
  }

  const sid = song.songId || song.id
  if (!sid) return rawUrl

  return `${exports.API_CONFIGS.neteaseAudioUrl.url}?server=${server}&type=url&id=${encodeURIComponent(String(sid))}&br=${br}`
}