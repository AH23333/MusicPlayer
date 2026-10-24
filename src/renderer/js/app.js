// ========== 渲染进程入口文件 ==========

;(function () {
  "use strict"

  // ========== 性能优化辅助函数 ==========
  function debounce(fn, delay) {
    let timer
    const debounced = function (...args) {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fn.apply(this, args)
      }, delay)
    }
    debounced.cancel = () => clearTimeout(timer)
    return debounced
  }

  function throttle(fn, delay) {
    let last = 0
    return function (...args) {
      const now = Date.now()
      if (now - last >= delay) {
        last = now
        fn.apply(this, args)
      }
    }
  }

  // ========== 全局状态 ==========
  let searchResults = []
  let playQueue = []
  let likedSongs = []
  let followedArtists = []
  let customPlaylists = []
  let diyPlaylists = []
  let latestPlayed = []
  let localSongs = []
  let currentSongIndex = -1
  let playGeneration = 0
  let consecutiveFailCount = 0
  let playMode = "order"
  // 播放看护：区分用户主动暂停与网络/解码器导致的异常暂停、缓冲卡死
  let userIntentPause = true // 用户意图是否暂停（无歌时视为暂停）
  let watchdogLastTime = -1 // 看护检测到的上次播放进度
  let stallTicks = 0 // 播放中进度连续不推进的秒数
  let recoverTries = 0 // 当前曲目已尝试的自动恢复次数
  let loadingSong = false // playCurrentSong 加载/重载中（看护期间不干预）
  let watchdogStarted = false
  let currentLyrics = []
  let lyricLines = []
  let searchOffset = 0
  let isLoadingMore = false
  let currentPlaylist = null
  let currentCover = null
  let currentEditingPlaylistId = null
  let searchHistory = []
  let selectedSongIndex = -1
  let selectedSongList = null
  let isSearching = false
  // 搜索类型："song" 单曲 / "playlist" 歌单
  let searchType = "song"
  let playlistSearchResults = []
  const playlistSearchCache = new Map()
  // 下载管理（go-music-dl 下载队列 / 下载记录）
  let dmSection = null
  let dmTab = "queue"
  let dmQueueTimer = null
  let dmQueueData = null
  let dmRecordsData = null
  let dmRecordsPage = 1
  let dmLoading = false
  const PLAYLIST_SEARCH_CACHE_MAX = 30
  let lastActiveIndex = -1
  let animationFrameId = null
  // 歌词时间轴偏移（秒）：正值歌词提前，负值歌词延后
  let lyricOffset = 0
  try {
    lyricOffset = parseFloat(localStorage.getItem("mp-lyric-offset")) || 0
  } catch (e) {
    lyricOffset = 0
  }
  function adjustLyricOffset(delta) {
    lyricOffset = Math.max(
      -10,
      Math.min(10, Math.round((lyricOffset + delta) * 10) / 10)
    )
    try {
      localStorage.setItem("mp-lyric-offset", lyricOffset)
    } catch (e) {}
    lastActiveIndex = -999 // 强制下一次重新计算并高亮
    return lyricOffset
  }
  const MAX_SEARCH_HISTORY = 50
  const PAGE_SIZE = 20
  const MAX_LATEST_PLAYED = 50
  const SEARCH_CACHE_MAX = 60
  const LYRICS_CACHE_MAX = 100
  const DOWNLOAD_QUALITY_KEY = "downloadMusicQuality"
  let selectedSearchIds = new Set()
  let selectedPlaylistDetailIds = new Set()
  let selectedQueueIds = new Set()
  let downloadModalPendingSongs = []
  let downloadModalTargetDir = null
  let listDragState = null
  let downloadActive = false
  let lastDownloadUi = { overallPercent: 0, text: "" }
  let teardownDownloadProgress = null

  // ========== 功能模块事件总线（供 features.js 订阅）==========
  const featureEventListeners = {}
  function emitFeature(evt, payload) {
    ;(featureEventListeners[evt] || []).forEach((cb) => {
      try {
        cb(payload)
      } catch (err) {
        console.error("[feature] 事件处理错误", evt, err)
      }
    })
  }

  // ========== 辅助函数 ==========
  let likedSavesQueue = []
  let likedSaveTimer = null
  let recentSavesQueue = []
  let recentSaveTimer = null

  function flushLikedSaves() {
    if (likedSaveTimer) clearTimeout(likedSaveTimer)
    likedSaveTimer = setTimeout(async () => {
      if (likedSavesQueue.length) {
        const latest = likedSavesQueue[likedSavesQueue.length - 1]
        likedSongs = latest
        await window.ElectronAPI.saveLikedSongs(likedSongs)
        if (likeCount) likeCount.textContent = likedSongs.length
        likedSavesQueue = []
      }
      likedSaveTimer = null
    }, 500)
  }

  function flushRecentSaves() {
    if (recentSaveTimer) clearTimeout(recentSaveTimer)
    recentSaveTimer = setTimeout(async () => {
      if (recentSavesQueue.length) {
        const latest = recentSavesQueue[recentSavesQueue.length - 1]
        latestPlayed = latest
        await window.ElectronAPI.saveLatestPlayed(latestPlayed)
        if (recentCount) recentCount.textContent = latestPlayed.length
        recentSavesQueue = []
      }
      recentSaveTimer = null
    }, 500)
  }

  // 防抖保存播放队列：renderPlaylist 高频触发，避免每次渲染都全量写盘
  let queueSaveTimer = null
  function scheduleQueueSave() {
    if (queueSaveTimer) clearTimeout(queueSaveTimer)
    queueSaveTimer = setTimeout(() => {
      queueSaveTimer = null
      window.ElectronAPI.savePlaylist(playQueue)
    }, 500)
  }
  function flushQueueSave() {
    if (queueSaveTimer) {
      clearTimeout(queueSaveTimer)
      queueSaveTimer = null
      window.ElectronAPI.savePlaylist(playQueue)
    }
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return ""
    return String(str).replace(/[&<>"']/g, function (m) {
      if (m === "&") return "&amp;"
      if (m === "<") return "&lt;"
      if (m === ">") return "&gt;"
      if (m === '"') return "&quot;"
      if (m === "'") return "&#39;"
      return m
    })
  }

  // 统一控制“加载更多”显隐：Tailwind .hidden 为 display:none !important，
  // 内联 style.display 无法覆盖，必须操作 classList
  function setLoadMoreVisible(show) {
    const btn =
      loadMoreBtn || document.getElementById("loadMoreBtn")
    if (!btn) return
    btn.classList.toggle("hidden", !show)
    btn.style.display = ""
  }

  function isSongLocalPath(song) {
    if (!song || song.local) return true
    const u = song.url || ""
    return /^[a-zA-Z]:\\/.test(u) || u.startsWith("file:")
  }

  /** 与主进程 utils.metingServerFromSource 对齐：返回 Meting 支持的 server 名，
   *  不支持的源（soda/apple/joox/qianqian/jamendo/fivesing 等）返回 null，搜索结果保留原始 source */
  const METING_AUDIO_API_BASE = "https://api.qijieya.cn/meting/"
  function metingServerFromSourceForSearch(src) {
    const s = String(src ?? "").toLowerCase().trim()
    if (s === "qq" || s === "tencent" || s === "tx") return "tencent"
    if (s === "kugou" || s === "kg") return "kugou"
    if (s === "kuwo" || s === "kw") return "kuwo"
    if (s === "migu" || s === "mg") return "migu"
    if (s === "bilibili" || s === "bili") return "bilibili"
    if (s === "netease" || s === "" ) return "netease"
    return null
  }
  function enrichMusicDlSearchSong(song) {
    if (!song) return null
    const rawId = song.id ?? song.songId ?? song.hash
    if (rawId == null || rawId === "") return null
    const id = String(rawId)
    // 保留 go-music-dl 原始源（下载/徽标用），Meting 仅作为可播回退
    const rawSource =
      String(song.source || song.from || "netease")
        .toLowerCase()
        .trim() || "netease"
    const metingServer = metingServerFromSourceForSearch(rawSource)
    let url = (song.url || song.playUrl || song.play_url || "").trim()
    if ((!url || !/^https?:\/\//i.test(url)) && metingServer) {
      url = `${METING_AUDIO_API_BASE}?server=${metingServer}&type=url&id=${encodeURIComponent(id)}`
    }
    const cover =
      song.coverUrl ||
      song.cover ||
      (song.album && song.album.picUrl) ||
      ""
    return {
      ...song,
      id,
      songId: id,
      source: rawSource,
      metingServer: metingServer || "",
      url,
      coverUrl: cover,
      name: song.name || "未知歌曲",
      artist:
        song.artist ||
        (song.artists
          ? song.artists.map((artist) => artist.name).join("/")
          : "") ||
        "未知歌手",
      album:
        typeof song.album === "string"
          ? song.album
          : song.album?.name || "未知专辑",
      duration: song.duration || 0,
    }
  }

  function getDownloadQuality() {
    try {
      const v = localStorage.getItem(DOWNLOAD_QUALITY_KEY)
      if (v === "standard" || v === "high" || v === "lossless") return v
    } catch (e) {}
    return "high"
  }

  function setDownloadQualityStorage(q) {
    try {
      localStorage.setItem(DOWNLOAD_QUALITY_KEY, q)
    } catch (e) {}
  }

  function syncDownloadQualitySelects() {
    const q = getDownloadQuality()
    document.querySelectorAll(".download-quality-select").forEach((sel) => {
      sel.value = q
    })
  }

  function syncSearchSelectAllCheckbox() {
    const cb = document.getElementById("searchSelectAllCheckbox")
    if (!cb || !searchResults.length) return
    const allSelected = searchResults.every(
      (s) => s.id && selectedSearchIds.has(s.id)
    )
    const someSelected = searchResults.some(
      (s) => s.id && selectedSearchIds.has(s.id)
    )
    cb.checked = allSelected && searchResults.length > 0
    cb.indeterminate = !allSelected && someSelected
  }

  function syncPlaylistDetailSelectAllCheckbox() {
    if (!currentPlaylist) return
    const online = currentPlaylist.songs.filter((s) => !isSongLocalPath(s))
    let allSelected = false
    let someSelected = false
    if (!online.length) {
      allSelected = false
      someSelected = false
    } else {
      allSelected = online.every(
        (s) => s.id && selectedPlaylistDetailIds.has(s.id)
      )
      someSelected = online.some(
        (s) => s.id && selectedPlaylistDetailIds.has(s.id)
      )
    }
    ;["playlistDetailSelectAllCheckbox", "playlistDetailSelectAllCheckboxStandalone"].forEach(
      (id) => {
        const cb = document.getElementById(id)
        if (!cb) return
        cb.checked = allSelected && online.length > 0
        cb.indeterminate = !allSelected && someSelected
      }
    )
  }

  function wirePlaylistDetailSelectAll(on) {
    if (!currentPlaylist) return
    currentPlaylist.songs.forEach((s) => {
      if (s.id && !isSongLocalPath(s)) {
        if (on) selectedPlaylistDetailIds.add(s.id)
        else selectedPlaylistDetailIds.delete(s.id)
      }
    })
    if (playlistDetailList) {
      playlistDetailList.querySelectorAll(".download-song-cb").forEach((box) => {
        box.checked = on
      })
    }
    // 封面网格视图的勾选框同步
    if (playlistDetailGrid) {
      playlistDetailGrid.querySelectorAll(".download-song-cb").forEach((box) => {
        box.checked = on
      })
    }
    syncPlaylistDetailSelectAllCheckbox()
  }

  function syncPlaylistQueueSelectAllCheckbox() {
    const cb = document.getElementById("playlistQueueSelectAllCheckbox")
    if (!cb) return
    const online = playQueue.filter((s) => !isSongLocalPath(s))
    if (!online.length) {
      cb.checked = false
      cb.indeterminate = false
      return
    }
    const allSelected = online.every(
      (s) => s.id && selectedQueueIds.has(s.id)
    )
    const someSelected = online.some(
      (s) => s.id && selectedQueueIds.has(s.id)
    )
    cb.checked = allSelected
    cb.indeterminate = !allSelected && someSelected
  }

  function updatePlaylistDetailDownloadActionsVisibility() {
    const p = currentPlaylist
    const standalone = document.getElementById("playlistDetailStandaloneActions")
    const dlGroup = document.getElementById("playlistDetailDownloadGroup")
    if (!p) return
    const hideDl = p.id === "local" || p.id === "followed"
    const isLikedOrRecent = p.id === "liked" || p.id === "recent"
    if (standalone) {
      standalone.classList.toggle("hidden", hideDl || !isLikedOrRecent)
    }
    if (dlGroup) {
      dlGroup.classList.toggle("hidden", hideDl || isLikedOrRecent)
    }
  }

  function pruneQueueSelection() {
    const ids = new Set(playQueue.map((s) => s.id).filter(Boolean))
    selectedQueueIds.forEach((id) => {
      if (!ids.has(id)) selectedQueueIds.delete(id)
    })
  }

  function getPlaylistDetailDownloadSongs() {
    if (!currentPlaylist) return []
    const online = currentPlaylist.songs.filter((s) => !isSongLocalPath(s))
    const picked = online.filter((s) => selectedPlaylistDetailIds.has(s.id))
    if (picked.length) return picked
    return online
  }

  function getSearchDownloadSongs() {
    const online = searchResults.filter((s) => s && !isSongLocalPath(s))
    const picked = online.filter((s) => selectedSearchIds.has(s.id))
    if (picked.length) return picked
    return online
  }

  function getPlayQueueDownloadSongs() {
    const online = playQueue.filter((s) => !isSongLocalPath(s))
    const picked = online.filter((s) => selectedQueueIds.has(s.id))
    if (picked.length) return picked
    return online
  }

  function getDownloadSongsForContext(song, listType) {
    const ok = (s) => s && !isSongLocalPath(s)
    if (!listType) return [song].filter(ok)
    if (listType === "search") {
      const sel = searchResults.filter(
        (s) => ok(s) && selectedSearchIds.has(s.id)
      )
      if (sel.length && song && selectedSearchIds.has(song.id)) return sel
      return [song].filter(ok)
    }
    if (listType === "playlist-detail" && currentPlaylist) {
      const sel = currentPlaylist.songs.filter(
        (s) => ok(s) && selectedPlaylistDetailIds.has(s.id)
      )
      if (sel.length && song && selectedPlaylistDetailIds.has(song.id))
        return sel
      return [song].filter(ok)
    }
    if (listType === "playlist") {
      const sel = playQueue.filter(
        (s) => ok(s) && selectedQueueIds.has(s.id)
      )
      if (sel.length && song && selectedQueueIds.has(song.id)) return sel
      return [song].filter(ok)
    }
    return [song].filter(ok)
  }

  function updateDownloadModalPathDisplay() {
    const el = document.getElementById("downloadModalPathDisplay")
    if (!el) return
    if (downloadModalTargetDir) {
      el.textContent = downloadModalTargetDir
    } else {
      el.textContent = "默认：应用数据目录下的 ImportLocalSongs 文件夹"
    }
  }

  function openDownloadModal(songs) {
    const list = (songs || []).filter((s) => s && !isSongLocalPath(s))
    if (!list.length) {
      showToastError("没有可下载的在线歌曲（需为在线曲目）")
      return
    }
    downloadModalPendingSongs = list
    downloadModalTargetDir = null
    const modal = document.getElementById("downloadSongModal")
    const qSel = document.getElementById("downloadModalQuality")
    if (qSel) {
      qSel.value = getDownloadQuality()
    }
    updateDownloadModalPathDisplay()
    if (modal) {
      modal.classList.remove("hidden")
      modal.classList.add("flex")
    }
  }

  function closeDownloadModal() {
    const modal = document.getElementById("downloadSongModal")
    if (modal) {
      modal.classList.add("hidden")
      modal.classList.remove("flex")
    }
    downloadModalPendingSongs = []
    downloadModalTargetDir = null
  }

  function applyLocalDownloadProgressUI() {
    const wrap = document.getElementById("localDownloadProgressWrap")
    const fill = document.getElementById("localDownloadProgressFill")
    const txt = document.getElementById("localDownloadProgressText")
    if (!wrap || !fill || !txt) return
    const show =
      downloadActive &&
      currentPlaylist &&
      currentPlaylist.id === "local" &&
      playlistDetailSection &&
      !playlistDetailSection.classList.contains("hidden")
    if (!show) {
      wrap.classList.add("hidden")
      return
    }
    wrap.classList.remove("hidden")
    fill.style.width = `${Math.min(100, lastDownloadUi.overallPercent)}%`
    txt.textContent = lastDownloadUi.text
  }

  // 封面裂图全局回退：直连失败的在线封面先经 go 服务端 cover_proxy 代理抓取，仍失败回退应用图标
  // capture 阶段监听可捕获动态插入的 <img> 错误；带自有 onerror 的图片交由其自身逻辑处理
  function setupCoverFallback() {
    document.addEventListener(
      "error",
      async (e) => {
        const img = e.target
        if (!img || img.tagName !== "IMG") return
        if (typeof img.onerror === "function") return
        const src = img.currentSrc || img.src || ""
        if (!/^https?:\/\//i.test(src)) return
        if (!window.ElectronAPI || !window.ElectronAPI.musicDlCoverProxyUrl) return
        if (!img.dataset.mpCoverProxy) {
          img.dataset.mpCoverProxy = "1"
          try {
            const proxied = await window.ElectronAPI.musicDlCoverProxyUrl(src)
            if (proxied) {
              img.src = proxied
              return
            }
          } catch (err) {}
          img.dataset.mpCoverIcon = "1"
          img.src = "../../assets/icon.ico"
          return
        }
        if (!img.dataset.mpCoverIcon) {
          img.dataset.mpCoverIcon = "1"
          img.src = "../../assets/icon.ico"
        }
      },
      true
    )
  }

  function setupDownloadProgressListener() {
    if (teardownDownloadProgress) {
      teardownDownloadProgress()
      teardownDownloadProgress = null
    }
    if (!window.ElectronAPI.onDownloadProgress) return
    teardownDownloadProgress = window.ElectronAPI.onDownloadProgress(
      (data) => {
        if (!data) return
        if (data.phase === "start") {
          downloadActive = true
          lastDownloadUi = {
            overallPercent: 0,
            text: `准备下载 ${data.total} 首…`,
          }
          applyLocalDownloadProgressUI()
        } else if (data.phase === "progress") {
          lastDownloadUi.overallPercent = data.overallPercent ?? 0
          const fp =
            data.filePercent != null ? ` · 当前文件 ${data.filePercent}%` : ""
          lastDownloadUi.text = `正在下载 ${data.index}/${data.total}：${data.songName || ""}${fp}`
          applyLocalDownloadProgressUI()
        } else if (data.phase === "song") {
          lastDownloadUi.overallPercent = data.overallPercent ?? 0
          if (data.status === "downloading") {
            lastDownloadUi.text = `正在下载 ${data.index}/${data.total}：${data.songName || ""}`
          } else if (data.status === "ok") {
            lastDownloadUi.text = `已完成 ${data.index}/${data.total}：${data.songName || ""}`
          } else if (data.status === "fail") {
            lastDownloadUi.text = `失败 ${data.index}/${data.total}：${data.songName || ""}`
          } else if (data.status === "skipped") {
            lastDownloadUi.text = `跳过 ${data.index}/${data.total}：${data.songName || ""}`
          }
          applyLocalDownloadProgressUI()
        } else if (data.phase === "complete") {
          lastDownloadUi.overallPercent = 100
          lastDownloadUi.text = `结束：成功 ${data.ok}，失败 ${data.fail}，跳过 ${data.skipped}`
          applyLocalDownloadProgressUI()
          ;(async () => {
            try {
              if (currentPlaylist && currentPlaylist.id === "local") {
                localSongs = await window.ElectronAPI.readLocalSongs()
                currentPlaylist.songs = localSongs
                renderPlaylistDetail(currentPlaylist)
                const localCountEl = document.getElementById("localCount")
                if (localCountEl) localCountEl.textContent = localSongs.length
              }
            } catch (e) {}
          })()
          setTimeout(() => {
            downloadActive = false
            const wrap = document.getElementById("localDownloadProgressWrap")
            if (wrap) wrap.classList.add("hidden")
            applyLocalDownloadProgressUI()
          }, 4500)
        }
      }
    )
  }

  async function runDownloadBatch(songs, quality, targetDir) {
    const list = (songs || []).filter((s) => s && !isSongLocalPath(s))
    if (!list.length) {
      showToastError("没有可下载的在线歌曲")
      return
    }
    const q = quality || getDownloadQuality()
    showToast(`开始下载 ${list.length} 首…`, "info")
    try {
      const payload = {
        songs: list,
        quality: q,
      }
      if (targetDir && String(targetDir).trim()) {
        payload.targetDir = String(targetDir).trim()
      }
      const res = await window.ElectronAPI.downloadAudioFiles(payload)
      if (res) {
        const errHint =
          Array.isArray(res.errors) && res.errors.length
            ? ` 示例：${res.errors
                .slice(0, 2)
                .map((e) => {
                  const d = e.detail ? String(e.detail).slice(0, 140) : ""
                  return `${e.name || "?"}（${e.reason || ""}${d ? " — " + d : ""}）`
                })
                .join("；")}`
            : ""
        if (res.fail > 0 || res.skipped > 0) {
          if (res.ok === 0 && res.fail > 0) {
            showToastError(
              `下载失败：${res.fail} 首失败，${res.skipped} 首跳过。${errHint}`
            )
          } else if (res.ok === 0 && res.skipped > 0 && res.fail === 0) {
            showToastError(
              `下载未成功：${res.skipped} 首无法解析地址或已跳过。${errHint}`
            )
          } else if (res.fail > 0) {
            showToastWarning(
              `部分失败：成功 ${res.ok}，失败 ${res.fail}，跳过 ${res.skipped}。${errHint}`
            )
          } else {
            showToastWarning(
              `下载结束：成功 ${res.ok}，跳过 ${res.skipped}。${errHint}`
            )
          }
        } else {
          showToast(`下载完成：成功 ${res.ok} 首`, "success")
        }
        try {
          localSongs = await window.ElectronAPI.readLocalSongs()
          const localCountEl = document.getElementById("localCount")
          if (localCountEl) localCountEl.textContent = localSongs.length
        } catch (e) {}
      }
    } catch (err) {
      console.error(err)
      showToastError("下载失败：" + (err.message || String(err)))
    }
  }

  function bindDownloadModalEvents() {
    const browse = document.getElementById("downloadModalBrowseBtn")
    const cancel = document.getElementById("downloadModalCancelBtn")
    const confirm = document.getElementById("downloadModalConfirmBtn")
    if (browse) {
      browse.addEventListener("click", async () => {
        const p = await window.ElectronAPI.selectDownloadDirectory()
        if (p) {
          downloadModalTargetDir = p
          updateDownloadModalPathDisplay()
        }
      })
    }
    if (cancel) cancel.addEventListener("click", () => closeDownloadModal())
    if (confirm) {
      confirm.addEventListener("click", async () => {
        const q =
          document.getElementById("downloadModalQuality")?.value ||
          getDownloadQuality()
        setDownloadQualityStorage(q)
        const songs = downloadModalPendingSongs.slice()
        const dir = downloadModalTargetDir
        closeDownloadModal()
        await runDownloadBatch(songs, q, dir)
      })
    }
  }

  function setupListDragMultiSelect(container, listKind) {
    if (!container) return
    const getIndicesInRange = (a, b) => {
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const out = []
      for (let i = lo; i <= hi; i++) out.push(i)
      return out
    }
    const applyRange = (i0, i1) => {
      const indices = getIndicesInRange(i0, i1)
      if (listKind === "search") {
        indices.forEach((idx) => {
          const s = searchResults[idx]
          if (s && s.id && !isSongLocalPath(s)) selectedSearchIds.add(s.id)
        })
        container.querySelectorAll(".download-song-cb").forEach((box) => {
          const sid = box.dataset.songId
          if (sid && selectedSearchIds.has(sid)) box.checked = true
        })
        syncSearchSelectAllCheckbox()
      } else if (listKind === "playlist-detail" && currentPlaylist) {
        indices.forEach((idx) => {
          const s = currentPlaylist.songs[idx]
          if (s && s.id && !isSongLocalPath(s))
            selectedPlaylistDetailIds.add(s.id)
        })
        container.querySelectorAll(".download-song-cb").forEach((box) => {
          const sid = box.dataset.songId
          if (sid && selectedPlaylistDetailIds.has(sid)) box.checked = true
        })
        syncPlaylistDetailSelectAllCheckbox()
      } else if (listKind === "playlist") {
        indices.forEach((idx) => {
          const s = playQueue[idx]
          if (s && s.id && !isSongLocalPath(s)) selectedQueueIds.add(s.id)
        })
        container.querySelectorAll(".download-song-cb").forEach((box) => {
          const sid = box.dataset.songId
          if (sid && selectedQueueIds.has(sid)) box.checked = true
        })
        syncPlaylistQueueSelectAllCheckbox()
      }
    }
    container.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return
      if (e.target.closest("button") || e.target.closest(".download-song-cb"))
        return
      const li = e.target.closest("li.song-item")
      if (!li || li.closest("ul") !== container) return
      const idx = parseInt(li.dataset.index, 10)
      if (Number.isNaN(idx)) return
      listDragState = { listKind, anchor: idx, container }
    })
    container.addEventListener("mousemove", (e) => {
      if (!listDragState || listDragState.container !== container) return
      if (!listDragState.listKind || listDragState.anchor < 0) return
      if ((e.buttons & 1) === 0) return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const li = el && el.closest && el.closest("li.song-item")
      if (!li || li.closest("ul") !== container) return
      const idx = parseInt(li.dataset.index, 10)
      if (Number.isNaN(idx)) return
      applyRange(listDragState.anchor, idx)
    })
  }

  // ========== DOM元素获取 ==========
  let searchInput, searchBtn, clearSearchBtn, searchResultList, loadMoreBtn
  let playlistList,
    playlistSidebarList,
    createPlaylistBtn,
    likeSongsBtn,
    likeCount
  let recentPlayBtn,
    recentCount,
    togglePlaylistBtn,
    closePlaylistBtn,
    playlistFloat
  let searchResultsSection,
    playlistDetailSection,
    playlistDetailTitle,
    playlistDetailList,
    playlistDetailGrid,
    playlistDetailListCard,
    viewListBtn,
    viewGridBtn
  let navBackBtn, navForwardBtn
  let lyricsArea,
    lyricsInterface,
    closeLyricsBtn,
    lyricsCoverImg,
    lyricsSongTitle,
    lyricsSongArtist
  let audioPlayer, coverImg, songTitle, songArtist, prevBtn, nextBtn
  let orderBtn, reverseBtn, singleLoopBtn, listLoopBtn, shuffleBtn, modeBtns, modeCycleBtn
  // 底栏单个模式按钮的循环顺序与中文标题
  const MODE_CYCLE = ["order", "listLoop", "singleLoop", "shuffle", "reverse"]
  const MODE_LABELS = {
    order: "顺序播放（播完停止）",
    reverse: "倒序播放",
    singleLoop: "单曲循环",
    listLoop: "列表循环",
    shuffle: "随机播放",
  }
  let mainInterface
  let playlistEditModal, playlistEditForm, playlistName, playlistDescription
  let coverUpload, coverPreview, cancelPlaylistBtn, savePlaylistBtn
  let importWebPlaylistBtn,
    webPlaylistImportModal,
    webPlaylistUrlInput,
    webPlaylistPlatformSelect,
    cancelWebPlaylistImportBtn,
    confirmWebPlaylistImportBtn
  let importUserBtn, exportUserBtn, checkUpdateBtn
  let searchHistoryContainer, searchHistoryList
  let downloadSongModal, deleteConfirmModal, updateModal, searchSourceMenu
  // 当前搜索关键词（供“返回搜索结果”按钮恢复搜索框内容）
  let currentKeyword = ""
  let searchCache = new Map()
  let lyricsCache = new Map()

  // ========== 初始化 DOM 元素 ==========
  function initDOMElements() {
    searchInput = document.getElementById("searchInput")
    searchBtn = document.getElementById("searchBtn")
    clearSearchBtn = document.getElementById("clearSearchBtn")
    searchResultList = document.getElementById("searchResultList")
    loadMoreBtn = document.getElementById("loadMoreBtn")
    playlistList = document.getElementById("playlistList")
    playlistSidebarList = document.getElementById("playlistSidebarList")
    createPlaylistBtn = document.getElementById("createPlaylistBtn")
    likeSongsBtn = document.getElementById("likeSongsBtn")
    likeCount = document.getElementById("likeCount")
    recentPlayBtn = document.getElementById("recentPlayBtn")
    recentCount = document.getElementById("recentCount")
    togglePlaylistBtn = document.getElementById("togglePlaylistBtn")
    closePlaylistBtn = document.getElementById("closePlaylistBtn")
    playlistFloat = document.getElementById("playlistFloat")
    searchResultsSection = document.getElementById("searchResultsSection")
    playlistDetailSection = document.getElementById("playlistDetailSection")
    playlistDetailTitle = document.getElementById("playlistDetailTitle")
    playlistDetailList = document.getElementById("playlistDetailList")
    playlistDetailGrid = document.getElementById("playlistDetailGrid")
    playlistDetailListCard = document.getElementById("playlistDetailListCard")
    viewListBtn = document.getElementById("viewListBtn")
    viewGridBtn = document.getElementById("viewGridBtn")
    navBackBtn = document.getElementById("navBackBtn")
    navForwardBtn = document.getElementById("navForwardBtn")
    lyricsArea = document.getElementById("lyricsArea")
    lyricsInterface = document.getElementById("lyricsInterface")
    closeLyricsBtn = document.getElementById("closeLyricsBtn")
    lyricsCoverImg = document.getElementById("lyricsCoverImg")
    lyricsSongTitle = document.getElementById("lyricsSongTitle")
    lyricsSongArtist = document.getElementById("lyricsSongArtist")
    audioPlayer = document.getElementById("audioPlayer")
    coverImg = document.getElementById("coverImg")
    songTitle = document.getElementById("songTitle")
    songArtist = document.getElementById("songArtist")
    prevBtn = document.getElementById("prevBtn")
    nextBtn = document.getElementById("nextBtn")
    orderBtn = document.getElementById("orderBtn")
    reverseBtn = document.getElementById("reverseBtn")
    singleLoopBtn = document.getElementById("singleLoopBtn")
    listLoopBtn = document.getElementById("listLoopBtn")
    shuffleBtn = document.getElementById("shuffleBtn")
    modeBtns = [orderBtn, reverseBtn, singleLoopBtn, listLoopBtn, shuffleBtn]
    modeCycleBtn = document.getElementById("modeCycleBtn")
    mainInterface = document.getElementById("mainInterface")
    playlistEditModal = document.getElementById("playlistEditModal")
    playlistEditForm = document.getElementById("playlistEditForm")
    playlistName = document.getElementById("playlistName")
    playlistDescription = document.getElementById("playlistDescription")
    coverUpload = document.getElementById("coverUpload")
    coverPreview = document.getElementById("coverPreview")
    cancelPlaylistBtn = document.getElementById("cancelPlaylistBtn")
    savePlaylistBtn = document.getElementById("savePlaylistBtn")
    importUserBtn = document.getElementById("importUserBtn")
    exportUserBtn = document.getElementById("exportUserBtn")
    checkUpdateBtn = document.getElementById("checkUpdateBtn")
    searchHistoryContainer = document.getElementById("searchHistoryContainer")
    searchHistoryList = document.getElementById("searchHistoryList")
    importWebPlaylistBtn = document.getElementById("importWebPlaylistBtn")
    webPlaylistImportModal = document.getElementById("webPlaylistImportModal")
    webPlaylistUrlInput = document.getElementById("webPlaylistUrlInput")
    webPlaylistPlatformSelect = document.getElementById(
      "webPlaylistPlatformSelect"
    )
    cancelWebPlaylistImportBtn = document.getElementById(
      "cancelWebPlaylistImportBtn"
    )
    confirmWebPlaylistImportBtn = document.getElementById(
      "confirmWebPlaylistImportBtn"
    )
    downloadSongModal = document.getElementById("downloadSongModal")
    deleteConfirmModal = document.getElementById("deleteConfirmModal")
    updateModal = document.getElementById("updateModal")
    searchSourceMenu = document.getElementById("searchSourceMenu")
  }

  // ========== 导出用户信息 ==========
  function bindUserInfoEvents() {
    if (exportUserBtn) {
      exportUserBtn.addEventListener("click", async () => {
        const result = await window.ElectronAPI.exportUserInfo()
        if (result.success) {
          showToast(`用户信息导出成功：${result.filePath}`)
        } else {
          showToastError(`导出失败：${result.error}`)
        }
      })
    }

    if (importUserBtn) {
      importUserBtn.addEventListener("click", async () => {
        const result = await window.ElectronAPI.importUserInfo()
        if (result.success) {
          showToast("用户信息导入成功，重启应用生效")
          setTimeout(() => {
            window.location.reload()
          }, 1500)
        } else {
          showToastError(`导入失败：${result.error}`)
        }
      })
    }

    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener("click", async () => {
        hideUpdateBadge()
        const result = await window.ElectronAPI.checkForUpdates()
        if (result && result.success) {
          if (result.hasUpdate) {
            showUpdateModal(result)
          } else {
            showToast("当前已是最新版本")
          }
        } else {
          showToastError(result?.message || "检查更新失败")
        }
      })
    }

    window.ElectronAPI.onUpdateAvailable((info) => {
      showUpdateBadge()
      showUpdateModal(info)
    })
  }

  // ========== 显示更新徽章 ==========
  function showUpdateBadge() {
    const badge = document.getElementById("updateBadge")
    if (badge) {
      badge.classList.remove("opacity-0")
      badge.classList.add("opacity-100")
    }
  }

  function hideUpdateBadge() {
    const badge = document.getElementById("updateBadge")
    if (badge) {
      badge.classList.remove("opacity-100")
      badge.classList.add("opacity-0")
    }
  }

  let currentUpdateInfo = null
  let updateState = "idle" // idle | downloading | preparing | ready | installing
  let updateFilePath = null
  let updateNewRoot = null
  let updateSpeedSample = null

  function updateFormatMB(bytes) {
    const n = Number(bytes) || 0
    return n >= 1048576
      ? (n / 1048576).toFixed(1) + " MB"
      : Math.max(1, Math.round(n / 1024)) + " KB"
  }

  function updateFormatSpeed(bps) {
    return bps >= 1048576
      ? (bps / 1048576).toFixed(1) + " MB/s"
      : Math.max(1, Math.round(bps / 1024)) + " KB/s"
  }

  function setUpdateProgressVisible(visible) {
    const wrap = document.getElementById("updateProgressWrap")
    if (wrap) wrap.classList.toggle("hidden", !visible)
  }

  function setUpdateProgressPercent(percent) {
    const fill = document.getElementById("updateProgressFill")
    if (fill) fill.style.width = Math.max(0, Math.min(100, percent)) + "%"
  }

  function setUpdateProgressText(text) {
    const el = document.getElementById("updateProgressText")
    if (el) el.textContent = text
  }

  function resetUpdateUi() {
    updateState = "idle"
    updateFilePath = null
    updateNewRoot = null
    updateSpeedSample = null
    setUpdateProgressVisible(false)
    setUpdateProgressPercent(0)
    setUpdateProgressText("")
    const downloadBtn = document.getElementById("updateDownloadBtn")
    const laterBtn = document.getElementById("updateLaterBtn")
    if (downloadBtn) downloadBtn.disabled = false
    if (laterBtn) laterBtn.textContent = "稍后"
  }

  function showUpdateModal(info) {
    const modal = document.getElementById("updateModal")
    const title = document.getElementById("updateModalTitle")
    const text = document.getElementById("updateModalText")
    const downloadBtn = document.getElementById("updateDownloadBtn")
    const gitHubBtn = document.getElementById("updateGitHubBtn")
    const laterBtn = document.getElementById("updateLaterBtn")

    currentUpdateInfo = info
    resetUpdateUi()

    if (info.hasUpdate) {
      title.textContent = "发现新版本"
      const sizeText = info.assetSize
        ? `，安装包约 ${updateFormatMB(info.assetSize)}`
        : ""
      if (info.downloadUrl) {
        text.innerHTML = `当前版本：${info.currentVersion || "1.0.0"}<br>最新版本：${info.latestVersion || "未知"}${sizeText}<br><br>一键更新会自动下载并替换程序文件（用户数据不受影响），完成后自动重启。`
        downloadBtn.textContent = "一键更新"
      } else {
        text.innerHTML = `当前版本：${info.currentVersion || "1.0.0"}<br>最新版本：${info.latestVersion || "未知"}<br><br>请手动下载更新覆盖安装，注意备份用户数据！`
        downloadBtn.textContent = "前往下载"
      }
      downloadBtn.classList.remove("hidden")
    } else {
      title.textContent = "更新检查"
      text.textContent = "当前已是最新版本"
      downloadBtn.classList.add("hidden")
    }
    gitHubBtn.classList.add("hidden")
    laterBtn.classList.remove("hidden")
    modal.classList.remove("hidden")
  }

  function hideUpdateModal() {
    document.getElementById("updateModal").classList.add("hidden")
    currentUpdateInfo = null
    resetUpdateUi()
  }

  async function startOneClickUpdate(info) {
    const downloadBtn = document.getElementById("updateDownloadBtn")
    const laterBtn = document.getElementById("updateLaterBtn")
    updateState = "downloading"
    if (downloadBtn) {
      downloadBtn.disabled = true
      downloadBtn.textContent = "正在下载…"
    }
    if (laterBtn) laterBtn.textContent = "取消"
    setUpdateProgressVisible(true)
    setUpdateProgressPercent(0)
    setUpdateProgressText("正在下载…")

    const result = await window.ElectronAPI.downloadUpdate(
      info.downloadUrl,
      info.assetDigest
    )
    if (updateState !== "downloading") return

    if (!result || !result.success) {
      resetUpdateUi()
      if (downloadBtn) downloadBtn.textContent = "一键更新"
      if (result && result.cancelled) {
        showToast("已取消更新")
      } else {
        showToastError((result && result.error) || "下载失败，请重试")
      }
      return
    }

    updateFilePath = result.filePath
    updateState = "preparing"
    setUpdateProgressText("下载完成，正在校验安装包…")
    const prepared = await window.ElectronAPI.prepareUpdate(updateFilePath)
    if (updateState !== "preparing") return

    if (!prepared || !prepared.success) {
      resetUpdateUi()
      if (downloadBtn) downloadBtn.textContent = "一键更新"
      showToastError((prepared && prepared.error) || "安装包解析失败，请重试")
      return
    }

    updateNewRoot = prepared.newRoot
    updateState = "ready"
    setUpdateProgressPercent(100)
    setUpdateProgressText("更新已就绪")
    if (downloadBtn) {
      downloadBtn.disabled = false
      downloadBtn.textContent = "立即重启完成更新"
    }
    if (laterBtn) laterBtn.textContent = "稍后"
  }

  function bindUpdateModalEvents() {
    window.ElectronAPI.onUpdateDownloadProgress((p) => {
      if (updateState !== "downloading" || !p) return
      const now = Date.now()
      let speedText = ""
      if (updateSpeedSample && now > updateSpeedSample.time) {
        const bps =
          ((p.received - updateSpeedSample.received) * 1000) /
          (now - updateSpeedSample.time)
        if (bps > 0) speedText = "，" + updateFormatSpeed(bps)
      }
      updateSpeedSample = { received: p.received, time: now }
      if (p.percent >= 0) setUpdateProgressPercent(p.percent)
      else setUpdateProgressPercent(100)
      const totalText = p.total > 0 ? " / " + updateFormatMB(p.total) : ""
      setUpdateProgressText(
        `正在下载 ${updateFormatMB(p.received)}${totalText}${speedText}`
      )
    })

    document
      .getElementById("updateDownloadBtn")
      .addEventListener("click", async () => {
        if (!currentUpdateInfo) {
          hideUpdateModal()
          return
        }
        if (updateState === "downloading" || updateState === "preparing") return
        if (updateState === "ready" && updateNewRoot) {
          updateState = "installing"
          const downloadBtn = document.getElementById("updateDownloadBtn")
          if (downloadBtn) {
            downloadBtn.disabled = true
            downloadBtn.textContent = "正在重启…"
          }
          setUpdateProgressText("正在应用更新…")
          const result = await window.ElectronAPI.installUpdate(updateNewRoot)
          if (updateState !== "installing") return
          if (!result || !result.success) {
            updateState = "ready"
            if (downloadBtn) {
              downloadBtn.disabled = false
              downloadBtn.textContent = "立即重启完成更新"
            }
            showToastError((result && result.error) || "应用更新失败")
          }
          return
        }
        const info = currentUpdateInfo
        if (info.downloadUrl) {
          startOneClickUpdate(info)
        } else {
          await window.ElectronAPI.openDownloadPage(
            info.releaseUrl || info.downloadUrl
          )
          hideUpdateModal()
        }
      })

    document.getElementById("updateLaterBtn").addEventListener("click", () => {
      if (updateState === "downloading" || updateState === "preparing") {
        window.ElectronAPI.cancelUpdate()
        return
      }
      hideUpdateModal()
    })

    document
      .getElementById("updateGitHubBtn")
      .addEventListener("click", async () => {
        await window.ElectronAPI.openDownloadPage()
        showToast("正在打开GitHub releases页面...")
        hideUpdateModal()
      })
  }

  // ========== 核心函数定义 ==========
  function renderPlaylist() {
    if (!playlistList) return
    pruneQueueSelection()
    playlistList.innerHTML = ""
    playQueue.forEach((song, index) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
      const canDl = !isSongLocalPath(song)
      const li = document.createElement("li")
      li.className = `song-item p-4 ${index === currentSongIndex ? "active" : ""} hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200`
      li.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          ${
            canDl
              ? `<input type="checkbox" class="download-song-cb selection-sq-checkbox mt-1 h-4 w-4 flex-shrink-0" data-song-id="${escapeHtml(song.id)}" ${selectedQueueIds.has(song.id) ? "checked" : ""} />`
              : `<span class="w-4 flex-shrink-0"></span>`
          }
          <div class="flex-1 min-w-0">
            <div class="font-medium dark:text-white truncate">${escapeHtml(song.name)}</div>
            <div class="text-xs text-gray-400 dark:text-gray-500 truncate"><span class="artist-link" data-artist="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</span>${sourceBadgeHtml(song)}</div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button class="like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"} hover:text-red-500 transition-colors" data-song-id="${escapeHtml(song.id)}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="${isLiked ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
            <button class="add-to-playlist" data-song-id="${escapeHtml(song.id)}">+</button>
            <button class="more-btn" data-song-id="${escapeHtml(song.id)}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
            <button class="delete-btn text-gray-400 hover:text-red-500 transition-colors dark:text-gray-500" data-index="${index}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      `
      li.dataset.index = index
      li.dataset.list = "playlist"
      let lastClickTime = 0
      li.addEventListener("click", (e) => {
        if (e.target.closest(".download-song-cb")) return
        const now = Date.now()
        if (now - lastClickTime < 300) {
          currentSongIndex = index
          playCurrentSong()
          lastClickTime = 0
        } else {
          lastClickTime = now
          selectSong(song, index, "playlist")
        }
      })
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault()
        showSongContextMenu(e, song, "playlist")
      })
      const qCb = li.querySelector(".download-song-cb")
      if (qCb) {
        qCb.addEventListener("click", (e) => e.stopPropagation())
        qCb.addEventListener("change", () => {
          if (qCb.checked) selectedQueueIds.add(song.id)
          else selectedQueueIds.delete(song.id)
          syncPlaylistQueueSelectAllCheckbox()
        })
      }
      playlistList.appendChild(li)
    })
    syncPlaylistQueueSelectAllCheckbox()
    scheduleQueueSave()
    emitFeature("queuechange", playQueue.slice())
  }

  function renderPlaylistSidebar() {
    if (!playlistSidebarList) return
    playlistSidebarList.innerHTML = ""

    diyPlaylists.forEach((playlist, index) => {
      const li = document.createElement("li")
      li.className =
        "flex items-center gap-2 p-2 rounded hover:bg-gray-300 transition-colors duration-200 cursor-pointer dark:hover:bg-gray-700"
      const hasCover = playlist.coverPath && playlist.coverPath !== ""
      const hasSongCover =
        playlist.songs.length > 0 &&
        playlist.songs[0].coverUrl &&
        playlist.songs[0].coverUrl !== ""

      li.innerHTML = `
        ${hasCover ? `<img src="./DIYSongListPage/${escapeHtml(playlist.coverPath)}" class="w-8 h-8 rounded object-cover" />` : hasSongCover ? `<img src="${escapeHtml(playlist.songs[0].coverUrl)}" class="w-8 h-8 rounded object-cover" />` : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>`}
        <span class="flex-1">${escapeHtml(playlist.name)}</span>
        <span class="text-xs text-gray-400">${playlist.songs.length}</span>
      `
      li.dataset.index = index
      li.addEventListener("click", () => showPlaylistDetail(playlist))
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault()
        showPlaylistContextMenu(e, playlist)
      })
      playlistSidebarList.appendChild(li)
    })
  }

  function editPlaylist(playlist) {
    currentEditingPlaylistId = playlist.id
    if (playlistName) playlistName.value = playlist.name
    if (playlistDescription)
      playlistDescription.value = playlist.description || ""

    if (playlist.coverPath) {
      if (coverPreview)
        coverPreview.innerHTML = `<img src="./DIYSongListPage/${playlist.coverPath}" class="w-full h-full object-cover rounded-md">`
      currentCover = null
    } else {
      if (coverPreview)
        coverPreview.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`
      currentCover = null
    }
    const modalTitle = document.querySelector("#playlistEditModal h2")
    if (modalTitle) modalTitle.textContent = "修改歌单"
    const submitBtn = document.getElementById("savePlaylistBtn")
    if (submitBtn) submitBtn.textContent = "保存"
    if (playlistEditModal) playlistEditModal.classList.remove("hidden")
  }

  function setActiveModeBtn(btn) {
    modeBtns.forEach((b) => b && b.classList.remove("active"))
    if (btn) btn.classList.add("active")
    updateCycleMode(btn ? btn.dataset.mode : null)
  }

  // 同步底栏单个模式按钮的图标、提示与高亮（顺序模式不高亮，其余高亮）
  function updateCycleMode(mode) {
    if (!modeCycleBtn) return
    const src = modeBtns.find((b) => b && b.dataset.mode === mode)
    const icon = document.getElementById("modeCycleIcon")
    if (src && icon) {
      const svg = src.querySelector("svg")
      if (svg) icon.innerHTML = svg.innerHTML
    }
    modeCycleBtn.title = MODE_LABELS[mode] || "播放模式"
    modeCycleBtn.classList.toggle("active", !!mode && mode !== "order")
  }

  // ========== 搜索历史 ==========
  function renderSearchHistory() {
    if (!searchHistoryList) return
    searchHistoryList.innerHTML = ""
    searchHistory.forEach((item) => {
      const li = document.createElement("li")
      li.className =
        "p-3 hover:bg-gray-100 cursor-pointer transition-colors duration-200 dark:hover:bg-gray-700 flex items-center justify-between"

      // 历史记录文本
      const textSpan = document.createElement("span")
      textSpan.textContent = item
      li.appendChild(textSpan)

      // 删除按钮
      const deleteBtn = document.createElement("button")
      deleteBtn.className =
        "text-gray-400 hover:text-red-500 transition-colors duration-200"
      deleteBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      `
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation() // 阻止事件冒泡，避免触发搜索
        // 从搜索历史中删除该项
        searchHistory = searchHistory.filter(
          (historyItem) => historyItem !== item
        )
        // 保存到本地存储
        localStorage.setItem("searchHistory", JSON.stringify(searchHistory))
        // 保存到主进程存储
        window.ElectronAPI.saveSearchHistory(searchHistory)
        // 重新渲染搜索历史
        renderSearchHistory()
      })
      li.appendChild(deleteBtn)

      // 点击历史记录项进行搜索
      li.addEventListener("click", async () => {
        if (searchInput) searchInput.value = item
        if (searchHistoryContainer)
          searchHistoryContainer.classList.add("hidden")
        if (searchInput && searchInput.value.trim() !== "") {
          if (clearSearchBtn) clearSearchBtn.classList.remove("hidden")
        } else {
          if (clearSearchBtn) clearSearchBtn.classList.add("hidden")
        }
        const keyword = item.trim()
        if (keyword) {
          // 设置标题为"搜索结果"
          const titleElement = document.querySelector(
            "#searchResultsSection h2"
          )
          if (titleElement) titleElement.textContent = "搜索结果"
          searchOffset = 0
          if (searchResultList) searchResultList.innerHTML = ""
          if (searchResultsSection)
            searchResultsSection.classList.remove("hidden")
          if (playlistDetailSection)
            playlistDetailSection.classList.add("hidden")
          if (searchResultList)
            searchResultList.innerHTML =
              '<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索中...</p></div>'
          if (searchType === "playlist") {
            await loadPlaylistSearchResults(keyword)
          } else {
            await loadSearchResults(keyword, searchOffset)
          }
          await updateSearchHistory(keyword)
          recordSearchNav(keyword)
          if (searchResultsSection) {
            searchResultsSection.classList.remove("fade-in")
            void searchResultsSection.offsetWidth
            searchResultsSection.classList.add("fade-in")
          }
        }
      })
      searchHistoryList.appendChild(li)
    })
  }

  async function updateSearchHistory(keyword) {
    searchHistory = searchHistory.filter((item) => item !== keyword)
    searchHistory.unshift(keyword)
    if (searchHistory.length > MAX_SEARCH_HISTORY) {
      searchHistory = searchHistory.slice(0, MAX_SEARCH_HISTORY)
    }
    try {
      await window.ElectronAPI.saveSearchHistory(searchHistory)
    } catch (err) {
      console.error("保存搜索历史失败:", err)
    }
  }

  // ========== 显示"我喜欢"歌单 ==========
  function showLikedSongs() {
    const likedPlaylist = { id: "liked", name: "我喜欢", songs: likedSongs }
    showPlaylistDetail(likedPlaylist)
  }

  function showRecentSongs() {
    const recentPlaylist = {
      id: "recent",
      name: "最近播放",
      songs: latestPlayed,
    }
    showPlaylistDetail(recentPlaylist)
  }

  function showLocalSongs() {
    const localPlaylist = { id: "local", name: "本地和下载", songs: localSongs }
    showPlaylistDetail(localPlaylist)
  }

  function showFollowedArtists() {
    if (!followedArtists) followedArtists = []
    if (searchResultsSection) searchResultsSection.classList.remove("hidden")
    if (playlistDetailSection) playlistDetailSection.classList.add("hidden")
    const sectionTitle = document.querySelector("#searchResultsSection h2")
    if (sectionTitle) sectionTitle.textContent = "关注歌手"
    if (searchResultList) searchResultList.innerHTML = ""
    setLoadMoreVisible(false)
    navRecord("关注歌手", () => showFollowedArtists())

    if (followedArtists.length === 0) {
      const emptyMessage = document.createElement("li")
      emptyMessage.className =
        "p-8 text-center text-gray-500 dark:text-gray-400"
      emptyMessage.textContent = "还没有关注任何歌手，右键点击歌曲可以关注歌手"
      if (searchResultList) searchResultList.appendChild(emptyMessage)
    } else {
      followedArtists.forEach((artistName, index) => {
        const li = document.createElement("li")
        li.className =
          "p-4 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700"
        li.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-primary" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              </div>
              <div>
                <h3 class="font-medium dark:text-white">${escapeHtml(artistName)}</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">双击搜索该歌手的歌曲</p>
              </div>
            </div>
            <button class="text-gray-400 hover:text-red-500 transition-colors duration-200" id="unfollowArtistBtn-${index}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        `
        if (searchResultList) searchResultList.appendChild(li)

        li.addEventListener("dblclick", async () => {
          const searchInputEl = document.getElementById("searchInput")
          if (searchInputEl) searchInputEl.value = artistName
          if (searchInputEl && searchInputEl.value.trim() !== "") {
            if (clearSearchBtn) clearSearchBtn.classList.remove("hidden")
          } else {
            if (clearSearchBtn) clearSearchBtn.classList.add("hidden")
          }
           // 隐藏返回按钮
           // 显示加载动画
           if (searchResultsSection)
             searchResultsSection.classList.remove("hidden")
           if (playlistDetailSection)
             playlistDetailSection.classList.add("hidden")
           if (searchResultList)
             searchResultList.innerHTML =
               '<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索中...</p></div>'
           // 设置标题为"搜索结果"
           const titleEl = document.querySelector("#searchResultsSection h2")
           if (titleEl) titleEl.textContent = "搜索结果"
           // 歌手搜索固定为单曲模式
           setSearchTypeUi("song")
           // 执行搜索
           await loadSearchResults(artistName, 0)
           // 更新搜索历史
           await updateSearchHistory(artistName)
           // 初始化搜索状态
           initSearchState()
           recordSearchNav(artistName)
          if (searchResultsSection) {
            searchResultsSection.classList.remove("fade-in")
            void searchResultsSection.offsetWidth
            searchResultsSection.classList.add("fade-in")
          }
        })

        const unfollowBtn = document.getElementById(
          `unfollowArtistBtn-${index}`
        )
        if (unfollowBtn) {
          unfollowBtn.addEventListener("click", (e) => {
            e.stopPropagation()
            toggleFollowArtist(artistName)
            showFollowedArtists()
          })
        }
      })
    }

    if (searchResultsSection) {
      searchResultsSection.classList.remove("fade-in")
      void searchResultsSection.offsetWidth
      searchResultsSection.classList.add("fade-in")
    }
  }

  // ========== 歌词核心功能 ==========
  function parseLyrics(lrcText) {
    if (!lrcText) return []
    const lyrics = []
    const lines = lrcText.split("\n")
    const timeRegex = /\[(\d{1,2}):(\d{2})(?:[:.](\d{2,3}))?\]/g

    const toTime = (match) => {
      const minutes = parseInt(match[1])
      const seconds = parseInt(match[2])
      const milliseconds = match[3]
        ? parseInt(match[3].padEnd(3, "0"))
        : 0
      return minutes * 60 + seconds + milliseconds / 1000
    }

    lines.forEach((line) => {
      timeRegex.lastIndex = 0
      const matches = [...line.matchAll(timeRegex)]
      if (matches.length === 0) return
      const first = matches[0]

      if (matches.length === 1) {
        // 普通行：单个时间标签 + 整行文本
        const text = line.slice(first.index + first[0].length).trim()
        if (text) lyrics.push({ time: toTime(first), text })
        return
      }

      // 多时间标签：判断是「行首重复标签」还是「逐字 karaoke」
      let karaoke = false
      for (let i = 0; i < matches.length - 1; i++) {
        const gap = line.slice(
          matches[i].index + matches[i][0].length,
          matches[i + 1].index
        )
        if (gap.trim() !== "") {
          karaoke = true
          break
        }
      }

      if (!karaoke) {
        // 经典多标签：同一句歌词对应多个时间点，各保留一条
        const text = line.replace(timeRegex, "").trim()
        if (text) {
          matches.forEach((match) => {
            lyrics.push({ time: toTime(match), text })
          })
        }
      } else {
        // 逐字 karaoke：每字一个时间戳，合并为一条行级歌词，取首个时间戳
        let text = ""
        matches.forEach((match, i) => {
          const end =
            i + 1 < matches.length ? matches[i + 1].index : line.length
          text += line.slice(match.index + match[0].length, end)
        })
        text = text.trim()
        if (text) lyrics.push({ time: toTime(first), text })
      }
    })

    return lyrics
      .sort((a, b) => a.time - b.time)
      .filter((lyric, index, array) => {
        return index === 0 || lyric.time !== array[index - 1].time
      })
  }

  function renderLyrics(lyrics, songId) {
    // songId 可能为 undefined（清空歌词场景），不得污染缓存键
    const cacheKey = songId != null ? String(songId) : null
    if (cacheKey && lyricsCache.has(cacheKey)) {
      currentLyrics = lyricsCache.get(cacheKey)
    } else {
      currentLyrics = parseLyrics(lyrics)
      if (cacheKey) {
        lyricsCache.set(cacheKey, currentLyrics)
        if (lyricsCache.size > LYRICS_CACHE_MAX) {
          const oldestKey = lyricsCache.keys().next().value
          lyricsCache.delete(oldestKey)
        }
      }
    }
    if (!lyricsArea) return
    lyricsArea.innerHTML = ""
    lyricLines = []
    if (currentLyrics.length === 0) {
      lyricsArea.innerHTML = '<div class="lyrics-empty">暂无歌词</div>'
      return
    }
    for (let i = 0; i < 3; i++) {
      const emptyLine = document.createElement("div")
      emptyLine.className = "lyric-line"
      emptyLine.style.opacity = "0"
      emptyLine.style.minHeight = "3.5rem"
      lyricsArea.appendChild(emptyLine)
      lyricLines.push(emptyLine)
    }
    currentLyrics.forEach((lyric, index) => {
      const line = document.createElement("div")
      line.className = "lyric-line"
      line.textContent = lyric.text
      line.dataset.index = index
      if (isFinite(lyric.time)) {
        line.classList.add("seekable")
        const mm = Math.floor(lyric.time / 60),
          ss = Math.floor(lyric.time % 60)
        line.title = "点击跳转到 " + mm + ":" + (ss < 10 ? "0" : "") + ss
        line.addEventListener("click", () => {
          if (audioPlayer && isFinite(lyric.time)) {
            audioPlayer.currentTime = lyric.time
          }
        })
      }
      lyricsArea.appendChild(line)
      lyricLines.push(line)
    })
    for (let i = 0; i < 3; i++) {
      const emptyLine = document.createElement("div")
      emptyLine.className = "lyric-line"
      emptyLine.style.opacity = "0"
      emptyLine.style.minHeight = "3.5rem"
      lyricsArea.appendChild(emptyLine)
      lyricLines.push(emptyLine)
    }
    lastActiveIndex = -1
    updateLyricHighlight()
  }

  let lyricUpdateFallbackTimer = 0

  function updateLyricHighlight() {
    if (document.hidden) {
      // 窗口隐藏（收起托盘）/最小化/被完全遮挡时 rAF 不会触发，
      // 直接同步执行，保证桌面歌词持续更新
      doUpdateLyricHighlight()
      return
    }
    if (animationFrameId) return
    animationFrameId = requestAnimationFrame(() => {
      animationFrameId = null
      clearTimeout(lyricUpdateFallbackTimer)
      doUpdateLyricHighlight()
    })
    // 兜底：页面报告可见但 rAF 长时间未执行的场景，600ms 后同步执行
    clearTimeout(lyricUpdateFallbackTimer)
    lyricUpdateFallbackTimer = setTimeout(() => {
      if (animationFrameId) {
        animationFrameId = null
        doUpdateLyricHighlight()
      }
    }, 600)
  }

  function doUpdateLyricHighlight() {
    if (!lyricsArea || !audioPlayer || currentLyrics.length === 0) return
    const currentTime = audioPlayer.currentTime + lyricOffset
    let activeIndex = -1
    let left = 0,
      right = currentLyrics.length - 1
    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      if (currentLyrics[mid].time <= currentTime) {
        activeIndex = mid
        left = mid + 1
      } else {
        right = mid - 1
      }
    }
    if (activeIndex !== lastActiveIndex) {
      if (lastActiveIndex !== undefined && lyricLines[lastActiveIndex + 3]) {
        lyricLines[lastActiveIndex + 3].classList.remove("active")
      }
      if (activeIndex !== -1 && lyricLines[activeIndex + 3]) {
        lyricLines[activeIndex + 3].classList.add("active")
        const activeLine = lyricLines[activeIndex + 3]
        const scrollContainer = lyricsArea.parentElement
        if (scrollContainer && activeLine.offsetParent) {
          const lineRect = activeLine.getBoundingClientRect()
          const containerRect = scrollContainer.getBoundingClientRect()
          const lineTop = lineRect.top + scrollContainer.scrollTop
          const containerMiddle = containerRect.height / 2
          const targetScrollTop = lineTop - containerMiddle
          scrollContainer.scrollTo({
            top: Math.max(0, targetScrollTop),
            behavior: "smooth",
          })
        }
      }
      if (activeIndex !== -1 && currentLyrics[activeIndex]) {
        emitFeature("lyricchange", {
          index: activeIndex,
          text: currentLyrics[activeIndex].text || "",
          lines: currentLyrics,
        })
      }
      lastActiveIndex = activeIndex
    }
  }

  // ========== Toast 功能 ==========
  // type: success=绿色主色，error=红色，warning=琥珀色，info=灰蓝（中性）
  let toastQueue = []
  function showToast(message, type = "success") {
    const toast = document.createElement("div")
    const base =
      "fixed right-4 px-4 py-3 rounded-lg shadow-lg z-[100] transition-all duration-300 transform translate-y-0 opacity-100 max-w-[min(92vw,24rem)] text-sm leading-snug break-words"
    const typeClass =
      {
        success: "bg-primary text-white",
        error:
          "bg-red-600 text-white ring-2 ring-red-800/40 dark:bg-red-700 dark:ring-red-900/50",
        warning:
          "bg-amber-500 text-white ring-2 ring-amber-700/30 dark:bg-amber-600",
        info: "bg-slate-600 text-white dark:bg-slate-500",
      }[type] || "bg-primary text-white"
    toast.className = `${base} ${typeClass}`
    toast.setAttribute("role", type === "error" ? "alert" : "status")
    toast.textContent = message
    document.body.appendChild(toast)
    toastQueue.push(toast)
    updateToastPositions()
    const ms = type === "error" ? 6500 : type === "warning" ? 5000 : 3200
    setTimeout(() => {
      toast.classList.add("opacity-0", "translate-y-4")
      setTimeout(() => {
        if (toast.parentNode) document.body.removeChild(toast)
        const index = toastQueue.indexOf(toast)
        if (index > -1) toastQueue.splice(index, 1)
        updateToastPositions()
      }, 300)
    }, ms)
  }

  function showToastError(message) {
    showToast(message, "error")
  }

  function showToastWarning(message) {
    showToast(message, "warning")
  }

  function updateToastPositions() {
    toastQueue.forEach((toast, index) => {
      const bottom = 20 + index * 50
      toast.style.bottom = `${bottom}px`
    })
  }

  // ========== 选中歌曲 ==========
  function selectSong(song, index, listType) {
    document.querySelectorAll(".song-item.selected").forEach((item) => {
      item.classList.remove("selected")
    })
    selectedSongIndex = index
    selectedSongList = listType
    const currentSongElement = document.querySelector(
      `.song-item[data-index="${index}"][data-list="${listType}"]`
    )
    if (currentSongElement) {
      currentSongElement.classList.add("selected")
    }
  }

  function playSelectedSong(song, listType) {
    console.log("[播放] playSelectedSong 被调用，歌曲数据:", song)
    console.log("[播放] 歌曲URL:", song.url)

    // 检查歌曲URL是否有效
    if (!song.url || song.url.trim() === "") {
      console.error("[播放] 歌曲URL无效，无法播放:", song.url)
      showToastError("播放失败：歌曲链接无效")
      return
    }

    // 如果playQueue中有URL为undefined的歌曲，先清空
    const invalidSongs = playQueue.filter((s) => !s.url || s.url.trim() === "")
    if (invalidSongs.length > 0) {
      console.log(
        "[播放] 发现",
        invalidSongs.length,
        "首URL无效的歌曲，清空播放队列"
      )
      playQueue = []
      currentSongIndex = -1
    }

    console.log("[播放] playQueue长度(操作前):", playQueue.length)
    const isExist = playQueue.some((item) => item.id === song.id)
    if (!isExist) {
      if (currentSongIndex >= 0) {
        playQueue.splice(currentSongIndex + 1, 0, song)
      } else {
        playQueue.push(song)
      }
      console.log("[播放] playQueue长度(添加后):", playQueue.length)
      renderPlaylist()
    }
    currentSongIndex = playQueue.findIndex((item) => item.id === song.id)
    console.log("[播放] currentSongIndex:", currentSongIndex)
    playCurrentSong()
    selectedSongIndex = -1
    selectedSongList = null
    document.querySelectorAll(".song-item.selected").forEach((item) => {
      item.classList.remove("selected")
    })
  }

  // 歌词原始请求缓存：同一首歌重复播放不再重复走 IPC + 网络请求
  const lyricFetchCache = new Map()
  const LYRIC_FETCH_CACHE_MAX = 100

  async function loadLyricsWithStatus(song) {
    if (lyricsArea) {
      lyricsArea.innerHTML =
        '<div class="lyrics-loading">🎵 歌词加载中...</div>'
    }
    const fetchKey = `${song.source || "default"}|${song.songId || song.id || ""}`
    try {
      if (lyricFetchCache.has(fetchKey)) {
        const lyrics = lyricFetchCache.get(fetchKey)
        if (lyrics && (lyrics.lrc || lyrics.tlrc)) {
          renderLyrics(lyrics.lrc || lyrics.tlrc, song.songId || song.id)
        } else if (lyricsArea) {
          lyricsArea.innerHTML =
            '<div class="lyrics-empty">🎵 暂无歌词，享受音乐吧~</div>'
        }
        return
      }
      let lyrics
      // 检查歌曲是否来自自定义源
      if (song.source && song.source !== "default") {
        // 使用 music-dl-api 服务获取歌词
        console.log(
          `[歌词] 使用 music-dl-api 获取歌词，歌曲ID：${song.id}，源：${song.source}`
        )
        const response = await window.ElectronAPI.musicDlLyric(
          song.id,
          song.source
        )
        if (response && response.lyric) {
          lyrics = { lrc: response.lyric, tlrc: "" }
        }
      }

      // 如果没有获取到歌词，或者歌曲不是来自自定义源，使用默认方法
      if (!lyrics) {
        console.log(`[歌词] 使用默认方法获取歌词，歌曲ID：${song.songId}`)
        lyrics = await window.ElectronAPI.fetchLyrics(song.songId)
      }

      if (lyrics && (lyrics.lrc || lyrics.tlrc)) {
        renderLyrics(lyrics.lrc || lyrics.tlrc, song.songId || song.id)
      } else {
        if (lyricsArea) {
          lyricsArea.innerHTML =
            '<div class="lyrics-empty">🎵 暂无歌词，享受音乐吧~</div>'
        }
      }
      // 缓存原始歌词结果（含“无歌词”场景），命中上限按插入序淘汰
      lyricFetchCache.set(fetchKey, lyrics)
      if (lyricFetchCache.size > LYRIC_FETCH_CACHE_MAX) {
        const oldestKey = lyricFetchCache.keys().next().value
        lyricFetchCache.delete(oldestKey)
      }
    } catch (err) {
      console.error("[歌词] 获取歌词失败:", err)
      if (lyricsArea) {
        lyricsArea.innerHTML = '<div class="lyrics-error">😔 歌词加载失败</div>'
      }
    }
  }

  function showPlaylistDetail(playlist) {
    currentPlaylist = playlist
    selectedPlaylistDetailIds.clear()
    // 非歌手页时隐藏专辑横条（歌手页由 renderArtistAlbumStrip 控制）
    const artistStripEl = document.getElementById("artistAlbumStrip")
    if (
      artistStripEl &&
      !String(playlist.id || "").startsWith("artist:")
    ) {
      artistStripEl.classList.add("hidden")
    }
    if (
      playlist.id === "liked" ||
      playlist.id === "recent" ||
      playlist.id === "local" ||
      playlist.id === "followed" ||
      String(playlist.id).startsWith("smart-")
    ) {
      if (playlistDetailTitle) {
        playlistDetailTitle.textContent = playlist.name
        playlistDetailTitle.classList.remove("hidden")
      }
    } else {
      if (playlistDetailTitle) playlistDetailTitle.classList.add("hidden")
    }

    const importLocalBtnEl = document.getElementById("importLocalBtn")
    if (importLocalBtnEl) {
      if (playlist.id === "local") {
        importLocalBtnEl.classList.remove("hidden")
      } else {
        importLocalBtnEl.classList.add("hidden")
      }
    }

    const exportPlaylistBtnEl = document.getElementById("exportPlaylistBtn")
    const playPlaylistBtnEl = document.getElementById("playPlaylistBtn")

    if (
      playlist.id !== "liked" &&
      playlist.id !== "recent" &&
      playlist.id !== "local" &&
      playlist.id !== "followed" &&
      !String(playlist.id).startsWith("smart-")
    ) {
      if (exportPlaylistBtnEl) exportPlaylistBtnEl.classList.remove("hidden")
      if (playPlaylistBtnEl) playPlaylistBtnEl.classList.remove("hidden")
      if (exportPlaylistBtnEl) {
        exportPlaylistBtnEl.onclick = async function () {
          const result = await window.ElectronAPI.exportPlaylist(playlist)
          if (result.success) {
            showToast(`歌单导出成功：${result.filePath}`)
          } else {
            showToastError(`导出失败：${result.error}`)
          }
        }
      }
      if (playPlaylistBtnEl) {
        playPlaylistBtnEl.onclick = function () {
          playPlaylist(playlist)
        }
      }
    } else {
      if (exportPlaylistBtnEl) exportPlaylistBtnEl.classList.add("hidden")
      if (playPlaylistBtnEl) playPlaylistBtnEl.classList.add("hidden")
    }

    // 自定义歌单：详情页内提供“编辑”入口（与侧边栏右键“修改歌单”同能力）
    const editInfoBtn = document.getElementById("editPlaylistInfoBtn")
    if (editInfoBtn) {
      const isDiy = diyPlaylists.some((d) => d && d.id === playlist.id)
      editInfoBtn.classList.toggle("hidden", !isDiy)
      editInfoBtn.onclick = () => editPlaylist(playlist)
    }

    const playlistDetailNameEl = document.getElementById("playlistDetailName")
    const playlistSongCountEl = document.getElementById("playlistSongCount")
    const playlistDetailDescEl = document.getElementById(
      "playlistDetailDescription"
    )
    if (playlistDetailNameEl) playlistDetailNameEl.textContent = playlist.name
    if (playlistSongCountEl)
      playlistSongCountEl.textContent = `${playlist.songs.length}首`
    if (playlistDetailDescEl)
      playlistDetailDescEl.textContent = playlist.description || "暂无描述"

    const playlistInfoArea = document.getElementById("playlistInfoArea")
    const playlistCoverContainer = document.getElementById(
      "playlistCoverContainer"
    )

    if (
      playlist.id === "liked" ||
      playlist.id === "recent" ||
      playlist.id === "local" ||
      playlist.id === "followed" ||
      String(playlist.id).startsWith("smart-")
    ) {
      if (playlistInfoArea) playlistInfoArea.classList.add("hidden")
      if (playlistDetailNameEl) playlistDetailNameEl.textContent = ""
      if (playlistSongCountEl) playlistSongCountEl.textContent = ""
      if (playlistDetailDescEl) playlistDetailDescEl.textContent = ""
      if (playlistCoverContainer) playlistCoverContainer.classList.add("hidden")
    } else {
      if (playlistInfoArea) playlistInfoArea.classList.remove("hidden")
      if (playlistCoverContainer) {
        playlistCoverContainer.classList.remove("hidden")
        playlistCoverContainer.innerHTML = `<img id="playlistCoverImg" class="w-24 h-24 rounded-lg shadow-md object-cover" src="" alt="歌单封面" />`
        const playlistCoverImg = document.getElementById("playlistCoverImg")

        if (playlist.coverPath && playlist.coverPath !== "") {
          if (playlistCoverImg) {
            playlistCoverImg.src = `./DIYSongListPage/${playlist.coverPath}`
            playlistCoverImg.style.display = "block"
            playlistCoverImg.onerror = function () {
              playlistCoverContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-20 h-20 text-gray-400 rounded-lg shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>`
            }
          }
        } else if (playlist.songs.length > 0) {
          const firstSong = playlist.songs[0]
          if (firstSong.coverUrl && firstSong.coverUrl !== "") {
            if (playlistCoverImg) {
              playlistCoverImg.src = firstSong.coverUrl
              playlistCoverImg.style.display = "block"
            }
          } else {
            playlistCoverContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-20 h-20 text-gray-400 rounded-lg shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>`
          }
        } else {
          playlistCoverContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-20 h-20 text-gray-400 rounded-lg shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>`
        }
      }
    }

    // 修复：封面容器 innerHTML 重建会丢失其中的「全选」checkbox，这里补建并重新绑定
    if (
      !document.getElementById("playlistDetailSelectAllCheckbox") &&
      playlistCoverContainer
    ) {
      const label = document.createElement("label")
      label.className = "check-row mt-2"
      label.innerHTML =
        '<input type="checkbox" id="playlistDetailSelectAllCheckbox" class="selection-sq-checkbox"><span>全选</span>'
      playlistCoverContainer.appendChild(label)
      const restoredCb = label.querySelector("input")
      restoredCb.addEventListener("change", () => {
        wirePlaylistDetailSelectAll(restoredCb.checked)
      })
    }

    renderPlaylistDetail(playlist)
    updatePlaylistDetailDownloadActionsVisibility()
    syncDownloadQualitySelects()
    if (searchResultsSection) searchResultsSection.classList.add("hidden")
    if (playlistDetailSection) playlistDetailSection.classList.remove("hidden")
    // 新开歌单回到顶部：避免沿用上一视图的滚动位置触发分批渲染级联加载
    const contentScrollEl = document.getElementById("contentScroll")
    if (contentScrollEl) contentScrollEl.scrollTop = 0
    if (playlistDetailSection) {
      playlistDetailSection.classList.remove("fade-in")
      void playlistDetailSection.offsetWidth
      playlistDetailSection.classList.add("fade-in")
    }
    if (playlist.id === "local") {
      applyLocalDownloadProgressUI()
    }
    // 标题仅用于导航去重（不展示），带 id 避免同名歌单互相覆盖历史
    navRecord(`歌单详情:${playlist.id}`, () => showPlaylistDetail(playlist))
  }

  // ===== 歌单详情分批渲染：大歌单不再一次性渲染全部行（列表+网格都分批），避免卡顿 =====
  const PD_RENDER_CHUNK = 100
  let pdRenderedPlaylist = null
  let pdListRendered = 0
  let pdGridRendered = 0
  let pdObserver = null

  function pdDisconnectObserver() {
    if (pdObserver) {
      pdObserver.disconnect()
      pdObserver = null
    }
  }

  function pdRemoveSentinel(view) {
    const el = document.getElementById(
      view === "list" ? "pdListSentinel" : "pdGridSentinel"
    )
    if (el) el.remove()
  }

  // 在列表/网格尾部挂一个哨兵元素，滚到可视区附近时自动渲染下一批
  function pdArmSentinel(view) {
    pdDisconnectObserver()
    pdRemoveSentinel(view === "list" ? "grid" : "list")
    const container = view === "list" ? playlistDetailList : playlistDetailGrid
    if (!container) return
    const id = view === "list" ? "pdListSentinel" : "pdGridSentinel"
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement(view === "list" ? "li" : "div")
      el.id = id
      el.className = "pd-sentinel"
      el.innerHTML = "<span>下滑加载更多…</span>"
      container.appendChild(el)
    }
    pdObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        pdDisconnectObserver()
        pdEnsureChunk(view)
      },
      { rootMargin: "400px 0px" }
    )
    pdObserver.observe(el)
  }

  function pdActiveView() {
    if (playlistDetailGrid && !playlistDetailGrid.classList.contains("hidden"))
      return "grid"
    return "list"
  }

  function pdEnsureChunk(view) {
    const playlist = pdRenderedPlaylist
    if (!playlist || !Array.isArray(playlist.songs)) return
    const total = playlist.songs.length
    if (view === "list") {
      if (!playlistDetailList) return
      if (pdListRendered >= total) {
        pdRemoveSentinel("list")
        return
      }
      const likedIdSet = new Set()
      likedSongs.forEach((s) => {
        if (s && s.id) likedIdSet.add(s.id)
      })
      const end = Math.min(total, pdListRendered + PD_RENDER_CHUNK)
      appendPlaylistDetailRows(playlist, pdListRendered, end, likedIdSet)
      pdListRendered = end
      if (pdListRendered >= total) pdRemoveSentinel("list")
      else pdArmSentinel("list")
    } else {
      if (!playlistDetailGrid) return
      if (pdGridRendered >= total) {
        pdRemoveSentinel("grid")
        return
      }
      const end = Math.min(total, pdGridRendered + PD_RENDER_CHUNK)
      appendPlaylistDetailGridCards(playlist, pdGridRendered, end)
      pdGridRendered = end
      if (pdGridRendered >= total) pdRemoveSentinel("grid")
      else pdArmSentinel("grid")
    }
  }

  function renderPlaylistDetail(playlist) {
    if (!playlistDetailList) return
    pdDisconnectObserver()
    pdRemoveSentinel("list")
    pdRemoveSentinel("grid")
    pdRenderedPlaylist = playlist
    pdListRendered = 0
    pdGridRendered = 0
    playlistDetailList.innerHTML = ""
    if (playlistDetailGrid) playlistDetailGrid.innerHTML = ""
    // 只渲染当前激活视图的首批，另一视图在切换时按需渲染
    pdEnsureChunk(pdActiveView())
    syncPlaylistDetailSelectAllCheckbox()
  }

  function appendPlaylistDetailRows(playlist, start, end, likedIdSet) {
    const sentinel = document.getElementById("pdListSentinel")
    for (let index = start; index < end; index++) {
      const song = playlist.songs[index]
      if (!song || !song.id) continue
      const isLiked = likedIdSet.has(song.id)
      const canDl = !isSongLocalPath(song)
      const li = document.createElement("li")
      li.className = "song-item p-4"
      li.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          ${
            canDl
              ? `<input type="checkbox" class="download-song-cb selection-sq-checkbox mt-1 h-4 w-4 flex-shrink-0" data-song-id="${song.id}" ${selectedPlaylistDetailIds.has(song.id) ? "checked" : ""} />`
              : `<span class="w-4 flex-shrink-0"></span>`
          }
          <div class="flex-1 min-w-0">
            <h3 class="font-medium dark:text-white truncate">${escapeHtml(song.name)}</h3>
            <p class="text-xs text-gray-400 dark:text-gray-500 truncate"><span class="artist-link" data-artist="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</span>${sourceBadgeHtml(song)} - ${escapeHtml(song.album)}</p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button class="like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"} hover:text-red-500 transition-colors" data-song-id="${song.id}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="${isLiked ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </button>
            <button class="add-to-playlist" data-song-id="${song.id}">+</button>
            <button class="more-btn" data-song-id="${song.id}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" /></svg>
            </button>
            <button class="delete-btn text-gray-400 hover:text-red-500 transition-colors duration-200 dark:text-gray-500" data-index="${index}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
      `
      li.dataset.index = index
      li.dataset.songId = song.id
      li.dataset.list = "playlist-detail"
      if (nowPlayingSongId && String(song.id) === nowPlayingSongId)
        li.classList.add("now-playing")
      let lastClickTime = 0
      li.addEventListener("click", (e) => {
        if (e.target.closest(".download-song-cb")) return
        const now = Date.now()
        if (now - lastClickTime < 300) {
          playSelectedSong(song, "playlist-detail")
          lastClickTime = 0
        } else {
          lastClickTime = now
          selectSong(song, index, "playlist-detail")
        }
      })
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault()
        showSongContextMenu(e, song, "playlist-detail")
      })
      const detailCb = li.querySelector(".download-song-cb")
      if (detailCb) {
        detailCb.addEventListener("click", (e) => e.stopPropagation())
        detailCb.addEventListener("change", () => {
          if (detailCb.checked) selectedPlaylistDetailIds.add(song.id)
          else selectedPlaylistDetailIds.delete(song.id)
          syncPlaylistDetailSelectAllCheckbox()
        })
      }
      if (sentinel) playlistDetailList.insertBefore(li, sentinel)
      else playlistDetailList.appendChild(li)
    }
  }

  function appendPlaylistDetailGridCards(playlist, start, end) {
    if (!playlistDetailGrid) return
    const sentinel = document.getElementById("pdGridSentinel")
    for (let index = start; index < end; index++) {
      const song = playlist.songs[index]
      if (!song || !song.id) continue
      const cov = song.coverUrl || song.cover || ""
      const card = document.createElement("div")
      card.className = "dg-card"
      card.dataset.songId = song.id
      card.innerHTML =
        '<div class="dg-cover">' +
        (cov
          ? '<img src="' + escapeHtml(cov) + '" alt="" loading="lazy">'
          : '<div class="dg-note"><svg viewBox="0 0 24 24"><path d="M9 19V6l12-3v13M9 19c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 .895 3 3zm12-3c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 .895 3 3z"/></svg></div>') +
        '<button class="dg-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>' +
        "</div>" +
        '<div class="dg-name">' + escapeHtml(song.name) + "</div>" +
        '<div class="dg-artist">' + escapeHtml(song.artist || "") + "</div>"
      const img = card.querySelector("img")
      if (img) {
        img.addEventListener("error", () => {
          const note = document.createElement("div")
          note.className = "dg-note"
          note.innerHTML =
            '<svg viewBox="0 0 24 24"><path d="M9 19V6l12-3v13M9 19c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 .895 3 3zm12-3c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 .895 3 3z"/></svg>'
          img.replaceWith(note)
        })
      }
      card.addEventListener("click", () => playSelectedSong(song, "playlist-detail"))
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault()
        showSongContextMenu(e, song, "playlist-detail")
      })
      // 封面网格单曲勾选（与列表视图共用 selectedPlaylistDetailIds，供全选/下载）
      if (!isSongLocalPath(song)) {
        const cb = document.createElement("input")
        cb.type = "checkbox"
        cb.className = "download-song-cb selection-sq-checkbox dg-cb"
        cb.dataset.songId = song.id
        cb.checked = selectedPlaylistDetailIds.has(song.id)
        cb.title = "选择下载"
        cb.addEventListener("click", (ev) => ev.stopPropagation())
        cb.addEventListener("change", () => {
          if (cb.checked) selectedPlaylistDetailIds.add(song.id)
          else selectedPlaylistDetailIds.delete(song.id)
          syncPlaylistDetailSelectAllCheckbox()
        })
        card.appendChild(cb)
      }
      if (sentinel) playlistDetailGrid.insertBefore(card, sentinel)
      else playlistDetailGrid.appendChild(card)
    }
  }

  function setDetailView(mode) {
    const grid = mode === "grid"
    if (playlistDetailListCard) playlistDetailListCard.classList.toggle("hidden", grid)
    if (playlistDetailGrid) playlistDetailGrid.classList.toggle("hidden", !grid)
    if (viewListBtn) viewListBtn.classList.toggle("on", !grid)
    if (viewGridBtn) viewGridBtn.classList.toggle("on", grid)
    localStorage.setItem("mp-detail-view", grid ? "grid" : "list")
    // 视图切换回到顶部：列表/网格内容高度不同，且避免底部位置触发级联全量加载
    if (pdRenderedPlaylist) {
      const sc = document.getElementById("contentScroll")
      if (sc) sc.scrollTop = 0
    }
    // 分批渲染：切到尚未渲染的视图时补首批；已渲染过但未渲染完时恢复滚动加载
    if (pdRenderedPlaylist && Array.isArray(pdRenderedPlaylist.songs)) {
      const total = pdRenderedPlaylist.songs.length
      if (grid) {
        if (pdGridRendered === 0 && total > 0) pdEnsureChunk("grid")
        else if (pdGridRendered > 0 && pdGridRendered < total) pdArmSentinel("grid")
      } else {
        if (pdListRendered === 0 && total > 0) pdEnsureChunk("list")
        else if (pdListRendered > 0 && pdListRendered < total) pdArmSentinel("list")
      }
    }
  }
  function initDetailViewToggle() {
    if (viewListBtn) viewListBtn.addEventListener("click", () => setDetailView("list"))
    if (viewGridBtn) viewGridBtn.addEventListener("click", () => setDetailView("grid"))
    setDetailView(localStorage.getItem("mp-detail-view") === "grid" ? "grid" : "list")
  }

  // ========== 歌手页（go-music-dl 多源搜索聚合 + 专辑浏览）==========
  const SOURCE_LABELS = {
    netease: "网易云音乐",
    qq: "QQ音乐",
    tencent: "QQ音乐",
    kugou: "酷狗音乐",
    kuwo: "酷我音乐",
    migu: "咪咕音乐",
    bilibili: "哔哩哔哩",
    joox: "JOOX",
    qianqian: "千千音乐",
    apple: "Apple Music",
    jamendo: "Jamendo",
    fivesing: "5sing",
    soda: "汽水音乐",
  }

  async function showArtistDetail(artist) {
    const name = String(artist || "").trim()
    if (!name) return
    if (
      !window.ElectronAPI ||
      typeof window.ElectronAPI.musicDlSearch !== "function"
    ) {
      return
    }
    showToast(`正在加载「${name}」的歌手页…`, "info")
    try {
      const [songsRes, albumsRes] = await Promise.all([
        window.ElectronAPI.musicDlSearch(name, "", 1, 60),
        typeof window.ElectronAPI.musicDlAlbumSearch === "function"
          ? window.ElectronAPI.musicDlAlbumSearch(name)
          : Promise.resolve(null),
      ])
      const kw = name.toLowerCase()
      const seen = new Set()
      const songs = []
      for (const s of (songsRes && songsRes.songs) || []) {
        const enriched = enrichMusicDlSearchSong(s)
        if (!enriched) continue
        if (!String(enriched.artist || "").toLowerCase().includes(kw)) continue
        const dkey = `${enriched.name}|${Math.round(Number(enriched.duration) || 0)}`
        if (seen.has(dkey)) continue
        seen.add(dkey)
        songs.push(enriched)
        if (songs.length >= 60) break
      }
      const albums = (albumsRes && albumsRes.albums) || []
      if (!songs.length && !albums.length) {
        showToastError(`未找到「${name}」的相关歌曲`)
        return
      }
      showPlaylistDetail({
        id: `artist:${name}`,
        name,
        songs,
        description: songs.length
          ? `热门歌曲（多平台聚合 ${songs.length} 首）`
          : "暂无热门歌曲，可浏览下方专辑",
      })
      renderArtistAlbumStrip(albums)
    } catch (e) {
      showToastError("歌手页加载失败，请稍后重试")
    }
  }

  function renderArtistAlbumStrip(albums) {
    const strip = document.getElementById("artistAlbumStrip")
    if (!strip) return
    strip.innerHTML = ""
    const seen = new Set()
    const uniq = (albums || [])
      .filter((a) => a && a.id && a.name)
      .filter((a) => {
        const key = `${a.name}|${a.source}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 20)
    if (!uniq.length) {
      strip.classList.add("hidden")
      return
    }
    const title = document.createElement("div")
    title.className = "strip-title"
    title.textContent = "相关专辑"
    const row = document.createElement("div")
    row.className = "strip-row"
    uniq.forEach((album) => {
      const card = document.createElement("div")
      card.className = "album-card"
      card.innerHTML =
        '<div class="album-cover">' +
        (album.cover
          ? '<img src="' + escapeHtml(album.cover) + '" alt="" loading="lazy">'
          : '<svg viewBox="0 0 24 24"><path d="M9 19V6l12-3v13M9 19c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 .895 3 3zm12-3c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 .895 3 3z"/></svg>') +
        "</div>" +
        '<div class="album-name" title="' +
        escapeHtml(album.name) +
        '">' +
        escapeHtml(album.name) +
        "</div>" +
        '<div class="album-src">' +
        escapeHtml(SOURCE_LABELS[album.source] || album.source || "") +
        "</div>"
      const img = card.querySelector("img")
      if (img) {
        img.addEventListener("error", () => {
          img.style.display = "none"
        })
      }
      card.addEventListener("click", () => openAlbumFromArtist(album))
      row.appendChild(card)
    })
    // 滚轮在专辑条上直接横向滚动，无需拖动滚动条
    row.addEventListener(
      "wheel",
      (e) => {
        if (e.deltaY === 0 && e.deltaX === 0) return
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
        if (
          (delta > 0 && row.scrollLeft + row.clientWidth < row.scrollWidth - 1) ||
          (delta < 0 && row.scrollLeft > 1)
        ) {
          e.preventDefault()
          row.scrollLeft += delta
        }
      },
      { passive: false }
    )
    strip.appendChild(title)
    strip.appendChild(row)
    strip.classList.remove("hidden")
  }

  async function openAlbumFromArtist(album) {
    if (
      !window.ElectronAPI ||
      typeof window.ElectronAPI.musicDlAlbum !== "function"
    ) {
      return
    }
    showToast(`正在加载专辑《${album.name}》…`, "info")
    try {
      const res = await window.ElectronAPI.musicDlAlbum(
        album.source,
        album.id,
        album.name
      )
      const songs = ((res && res.songs) || [])
        .map((s) => enrichMusicDlSearchSong(s))
        .filter(Boolean)
      if (!songs.length) {
        showToastError("专辑曲目加载失败")
        return
      }
      showPlaylistDetail({
        id: `album:${album.source}:${album.id}`,
        name: album.name,
        songs,
        description: `专辑 · ${SOURCE_LABELS[album.source] || album.source || ""} · ${songs.length} 首`,
      })
    } catch (e) {
      showToastError("专辑曲目加载失败")
    }
  }

  // 捕获阶段拦截 .artist-link（歌手名）点击：不触发行选中/双击播放，直达歌手页
  document.addEventListener(
    "click",
    (e) => {
      const el =
        e.target && e.target.closest ? e.target.closest(".artist-link") : null
      if (!el || !el.dataset.artist) return
      e.stopPropagation()
      e.preventDefault()
      showArtistDetail(el.dataset.artist)
    },
    true
  )

  // 平台短标签（列表行徽章用）
  const SOURCE_BADGES = {
    netease: "网易",
    qq: "QQ",
    tencent: "QQ",
    kugou: "酷狗",
    kuwo: "酷我",
    migu: "咪咕",
    bilibili: "B站",
    joox: "JOOX",
    qianqian: "千千",
    apple: "Apple",
    jamendo: "Jamendo",
    fivesing: "5sing",
    soda: "汽水",
  }

  // 多源歌曲行的平台徽章（本地歌曲无徽章）
  function sourceBadgeHtml(song) {
    if (!song || song.local) return ""
    const src = String(song.source || "").toLowerCase()
    if (!src) return ""
    const badge = SOURCE_BADGES[src]
    if (!badge) return ""
    return ` <span class="src-badge">${badge}</span>`
  }
  function removeFromCustomPlaylist(playlist, index) {
    const song = playlist.songs[index]
    playlist.songs.splice(index, 1)
    window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
    renderPlaylistDetail(playlist)
    renderPlaylistSidebar()
    showToast(`已从歌单《${playlist.name}》中移除《${song.name}》`)
  }

  function showPlaylistContextMenu(e, playlist) {
    const existingMenus = document.querySelectorAll(
      ".context-menu, .artist-selection-menu"
    )
    existingMenus.forEach((menu) => menu.remove())

    const menu = document.createElement("div")
    menu.className =
      "absolute bg-white border border-gray-300 rounded shadow-lg z-50 py-2 dark:bg-gray-800 dark:border-gray-700 context-menu"
    // Tailwind 类在元素插入 DOM 后由 MutationObserver 异步生成，首次右键时
    // absolute/z-50 尚未生效，菜单按静态流布局测量导致 left/top 落在侧边栏，必须内联
    menu.style.position = "absolute"
    menu.style.zIndex = "320"
    menu.innerHTML = `
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="playPlaylistBtn">播放歌单</button>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="editPlaylistBtn">修改歌单</button>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 text-red-500 dark:hover:bg-gray-700" id="deletePlaylistBtn">删除歌单</button>
    `

    document.body.appendChild(menu)

    const menuRect = menu.getBoundingClientRect()
    const screenWidth = window.innerWidth
    const screenHeight = window.innerHeight

    let left = e.clientX
    let top = e.clientY

    if (left + menuRect.width > screenWidth)
      left = screenWidth - menuRect.width - 10
    if (top + menuRect.height > screenHeight)
      top = screenHeight - menuRect.height - 10
    left = Math.max(10, left)
    top = Math.max(10, top)

    menu.style.left = `${left}px`
    menu.style.top = `${top}px`

    const playBtn = menu.querySelector("#playPlaylistBtn")
    const editBtn = menu.querySelector("#editPlaylistBtn")
    const deleteBtn = menu.querySelector("#deletePlaylistBtn")

    if (playBtn) {
      playBtn.addEventListener("click", () => {
        playPlaylist(playlist)
        document.body.removeChild(menu)
      })
    }
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        editPlaylist(playlist)
        document.body.removeChild(menu)
      })
    }
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        deletePlaylist(playlist)
        document.body.removeChild(menu)
      })
    }

    setTimeout(() => {
      document.addEventListener("click", function closeMenu(e) {
        if (!menu.contains(e.target)) {
          if (document.body.contains(menu)) document.body.removeChild(menu)
          document.removeEventListener("click", closeMenu)
        }
      })
    }, 0)
  }

  // 主窗口在线歌单卡片右键菜单：打开 / 播放 / 导入为自定义歌单
  // opts: { id, name, description, loadSongs: async () => enrichedSongs }
  function showOnlinePlaylistMenu(e, opts) {
    if (!opts || typeof opts.loadSongs !== "function") return
    const existingMenus = document.querySelectorAll(
      ".context-menu, .artist-selection-menu, .online-pl-menu"
    )
    existingMenus.forEach((menu) => menu.remove())

    const menu = document.createElement("div")
    menu.className =
      "absolute bg-white border border-gray-300 rounded shadow-lg z-50 py-2 dark:bg-gray-800 dark:border-gray-700 context-menu online-pl-menu"
    // 压过队列抽屉 z72 / 标题栏 z200，防止菜单被盖住
    menu.style.zIndex = "320"
    menu.style.position = "absolute"
    menu.innerHTML = `
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="onlinePlOpenBtn">打开歌单</button>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="onlinePlPlayBtn">播放歌单</button>
      <div class="border-t border-gray-300 my-1 dark:border-gray-700"></div>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="onlinePlImportBtn">导入为自定义歌单</button>
    `
    document.body.appendChild(menu)

    const menuRect = menu.getBoundingClientRect()
    let left = e.clientX
    let top = e.clientY
    if (left + menuRect.width > window.innerWidth)
      left = window.innerWidth - menuRect.width - 10
    if (top + menuRect.height > window.innerHeight)
      top = window.innerHeight - menuRect.height - 10
    left = Math.max(10, left)
    top = Math.max(10, top)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`

    let songsCache = null
    const loadSongs = async () => {
      if (songsCache) return songsCache
      showToast(`正在加载歌单《${opts.name || ""}》`, "info")
      let songs = null
      try {
        songs = await opts.loadSongs()
      } catch (err) {
        songs = null
      }
      if (!songs) {
        showToastError("歌单加载失败，请稍后重试")
        return null
      }
      if (!songs.length) {
        showToastWarning("该歌单暂无可用歌曲")
        return null
      }
      songsCache = songs
      return songs
    }
    const openWith = (songs, autoplay) => {
      const pl = {
        id: opts.id || "online-" + Date.now(),
        name: opts.name || "在线歌单",
        songs,
        description: opts.description || "",
      }
      showPlaylistDetail(pl)
      if (autoplay) playPlaylist(pl)
    }

    const openBtn = menu.querySelector("#onlinePlOpenBtn")
    const playBtn = menu.querySelector("#onlinePlPlayBtn")
    const importBtn = menu.querySelector("#onlinePlImportBtn")
    if (openBtn)
      openBtn.addEventListener("click", async () => {
        menu.remove()
        const songs = await loadSongs()
        if (songs) openWith(songs, false)
      })
    if (playBtn)
      playBtn.addEventListener("click", async () => {
        menu.remove()
        const songs = await loadSongs()
        if (songs) openWith(songs, true)
      })
    if (importBtn)
      importBtn.addEventListener("click", async () => {
        menu.remove()
        const songs = await loadSongs()
        if (songs)
          importPlaylistAsCustom(
            opts.name || "导入的歌单",
            songs,
            opts.description || ""
          )
      })

    setTimeout(() => {
      document.addEventListener("click", function closeMenu(ev) {
        if (!menu.contains(ev.target)) {
          if (document.body.contains(menu)) menu.remove()
          document.removeEventListener("click", closeMenu)
        }
      })
    }, 0)
  }

  // 将在线歌单曲目保存为自定义歌单（出现在侧边栏“我的歌单”）
  function importPlaylistAsCustom(name, songs, description) {
    const playlist = {
      id: Date.now().toString(),
      name: name || "导入的歌单",
      description: description || "",
      coverPath: "",
      songs: songs || [],
    }
    diyPlaylists.push(playlist)
    window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
    renderPlaylistSidebar()
    showPlaylistDetail(playlist)
    showToast(`已导入歌单《${playlist.name}》（${playlist.songs.length}首）`)
  }

  function playPlaylist(selectedPlaylist) {
    if (selectedPlaylist.songs.length === 0) {
      showToastWarning("歌单为空，无法播放")
      return
    }
    selectedQueueIds.clear()
    playQueue = selectedPlaylist.songs.slice()
    renderPlaylist()
    currentSongIndex = 0
    playCurrentSong()
    showToast(`开始播放歌单《${selectedPlaylist.name}》`)
  }

  let pendingDeletePlaylist = null

  function deletePlaylist(playlist) {
    pendingDeletePlaylist = playlist
    const msg = document.getElementById("deleteConfirmMessage")
    if (msg) msg.textContent = `确定要删除歌单《${playlist.name}》吗？`
    document.getElementById("deleteConfirmModal").classList.remove("hidden")
  }

  // 删除确认弹窗：常驻绑定一次（确认 / 取消 / 点遮罩关闭）
  function bindDeleteConfirmEvents() {
    const modal = document.getElementById("deleteConfirmModal")
    const close = () => {
      modal.classList.add("hidden")
      pendingDeletePlaylist = null
    }
    document.getElementById("confirmDeleteBtn").addEventListener("click", () => {
      const playlist = pendingDeletePlaylist
      if (playlist) {
        const index = diyPlaylists.findIndex((p) => p.id === playlist.id)
        if (index > -1) {
          diyPlaylists.splice(index, 1)
          window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
          renderPlaylistSidebar()
          if (currentPlaylist && currentPlaylist.id === playlist.id) {
            // 正在查看的歌单被删除：后退到上一页，无历史则回首页
            if (navIndex > 0) navGoBack()
            else navShowHome()
          }
          showToast(`歌单《${playlist.name}》已删除`)
        }
      }
      close()
    })
    document.getElementById("cancelDeleteBtn").addEventListener("click", close)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close()
    })
  }

  // ========== 键盘快捷键与弹层统一管理 ==========
  function closeTopmostOverlay() {
    // 右键/浮层菜单（内联 zIndex 320/321）在视觉最顶层，Escape 优先关闭
    const ctxMenu = Array.prototype.find.call(
      document.body.children,
      (el) =>
        el.nodeType === 1 &&
        el.style &&
        (Number(el.style.zIndex) || 0) >= 320
    )
    if (ctxMenu) {
      ctxMenu.remove()
      return true
    }
    // 模态弹窗优先（按视觉层级）
    const modals = [
      downloadSongModal,
      webPlaylistImportModal,
      playlistEditModal,
      deleteConfirmModal,
      updateModal,
    ]
    for (const m of modals) {
      if (m && !m.classList.contains("hidden")) {
        m.classList.add("hidden")
        if (m === deleteConfirmModal) pendingDeletePlaylist = null
        if (m === playlistEditModal) currentEditingPlaylistId = null
        return true
      }
    }
    if (lyricsInterface && !lyricsInterface.classList.contains("hidden")) {
      lyricsInterface.classList.add("hidden")
      return true
    }
    if (playlistFloat && playlistFloat.classList.contains("open")) {
      playlistFloat.classList.remove("open")
      return true
    }
    if (searchSourceMenu && !searchSourceMenu.classList.contains("hidden")) {
      searchSourceMenu.classList.add("hidden")
      return true
    }
    if (
      searchHistoryContainer &&
      !searchHistoryContainer.classList.contains("hidden")
    ) {
      searchHistoryContainer.classList.add("hidden")
      return true
    }
    return false
  }

  // 相对当前进度快进/快退（秒）
  function seekBy(seconds) {
    if (!audioPlayer || !isFinite(audioPlayer.currentTime)) return
    const max = isFinite(audioPlayer.duration) ? audioPlayer.duration : Infinity
    audioPlayer.currentTime = Math.max(
      0,
      Math.min(max, audioPlayer.currentTime + seconds)
    )
  }

  function togglePlayback() {
    if (!audioPlayer || currentSongIndex < 0) return
    if (audioPlayer.paused) {
      userIntentPause = false
      recoverTries = 0
      stallTicks = 0
      watchdogLastTime = -1
      audioPlayer.play().catch(() => {})
    } else {
      userIntentPause = true
      audioPlayer.pause()
    }
  }

  function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeTopmostOverlay()
        return
      }
      const tag = (e.target.tagName || "").toLowerCase()
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        e.target.isContentEditable

      if (e.key === " " && !isEditable) {
        e.preventDefault()
        togglePlayback()
        return
      }
      if (!isEditable && currentSongIndex >= 0) {
        if (e.key === "ArrowRight") {
          e.preventDefault()
          seekBy(e.shiftKey ? 15 : 5)
          return
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault()
          seekBy(e.shiftKey ? -15 : -5)
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          if (window.__mpFeatures) window.__mpFeatures.adjustVolume(0.05)
          return
        }
        if (e.key === "ArrowDown") {
          e.preventDefault()
          if (window.__mpFeatures) window.__mpFeatures.adjustVolume(-0.05)
          return
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault()
        if (searchInput) {
          searchInput.focus()
          searchInput.select()
        }
      }
    })
  }

  // 模态弹窗打开时自动聚焦首个可编辑元素（MutationObserver 集中处理）
  function setupModalAutoFocus() {
    document.querySelectorAll(".dialog-layer").forEach((layer) => {
      const observer = new MutationObserver(() => {
        if (layer.classList.contains("hidden")) return
        const focusable = layer.querySelector(
          "input:not([type='hidden']), select, textarea, button"
        )
        if (focusable) {
          setTimeout(() => {
            if (!layer.classList.contains("hidden")) focusable.focus()
          }, 30)
        }
      })
      observer.observe(layer, { attributes: true, attributeFilter: ["hidden"] })
    })
  }

  let initialSearchState = null

  function saveCurrentSearchState() {
    const titleEl = document.querySelector("#searchResultsSection h2")
    return {
      searchResults: [...searchResults],
      searchOffset: searchOffset,
      searchTitle: titleEl ? titleEl.textContent : "搜索结果",
    }
  }

  function restoreSearchState(state) {
    if (!state) return
    searchResults = state.searchResults
    searchOffset = state.searchOffset
    const titleEl = document.querySelector("#searchResultsSection h2")
    if (titleEl) titleEl.textContent = state.searchTitle
    if (searchResultList) {
      searchResultList.innerHTML = ""
      if (searchResults.length > 0) {
        renderSearchResults(searchResults, 0)
      }
    }
    setLoadMoreVisible(searchResults.length >= PAGE_SIZE)
  }

  function initSearchState() {
    initialSearchState = saveCurrentSearchState()
  }

  // ========== 页面导航历史（后退 / 前进，类似撤销与重做） ==========
  const navHistory = [] // [{ title, replay }]
  let navIndex = -1
  let navApplying = false

  function navUpdateButtons() {
    if (navBackBtn) {
      const can = navIndex > 0
      navBackBtn.classList.toggle("hidden", !can)
      navBackBtn.disabled = !can
    }
    if (navForwardBtn) {
      const can = navIndex >= 0 && navIndex < navHistory.length - 1
      navForwardBtn.classList.toggle("hidden", !can)
      navForwardBtn.disabled = !can
    }
  }

  // 记录一次页面跳转；导航回放期间不记录，避免回退/前进时污染历史
  function navRecord(title, replay) {
    if (typeof replay !== "function") return
    if (navApplying) return
    // 已停留在该页时重复进入（如连点侧栏按钮）不产生重复历史
    const cur = navHistory[navIndex]
    if (cur && cur.title === title) {
      cur.replay = replay
      return
    }
    navHistory.splice(navIndex + 1)
    navHistory.push({ title, replay })
    navIndex = navHistory.length - 1
    navUpdateButtons()
  }

  function navApply(entry) {
    if (!entry || typeof entry.replay !== "function") return
    navApplying = true
    try {
      entry.replay()
    } finally {
      navApplying = false
      navUpdateButtons()
    }
  }

  function navGoBack() {
    if (navIndex <= 0) return
    navIndex--
    navApply(navHistory[navIndex])
  }

  function navGoForward() {
    if (navIndex < 0 || navIndex >= navHistory.length - 1) return
    navIndex++
    navApply(navHistory[navIndex])
  }

  // 回到首页：隐藏全部二级视图
  function navShowHome() {
    if (searchResultsSection) searchResultsSection.classList.add("hidden")
    if (playlistDetailSection) playlistDetailSection.classList.add("hidden")
    ;["statsSection", "mineSection", "downloadManagerSection"].forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.classList.add("hidden")
    })
    const home = document.getElementById("homeSection")
    if (home) home.classList.remove("hidden")
  }

  // 构造“回到某次搜索结果”的回放闭包
  function navReplaySearch(keyword, state, stype) {
    return () => {
      currentPlaylist = null
      currentKeyword = keyword
      if (searchInput) searchInput.value = keyword
      if (searchResultsSection) searchResultsSection.classList.remove("hidden")
      if (playlistDetailSection) playlistDetailSection.classList.add("hidden")
      ;["statsSection", "mineSection", "downloadManagerSection"].forEach((id) => {
        const el = document.getElementById(id)
        if (el) el.classList.add("hidden")
      })
      const titleEl = document.querySelector("#searchResultsSection h2")
      if (titleEl) titleEl.textContent = "搜索结果"
      if (stype === "playlist") {
        renderPlaylistSearchResults()
      } else {
        restoreSearchState(state)
      }
    }
  }

  // 搜索完成后记录当前结果快照
  function recordSearchNav(keyword) {
    const state = saveCurrentSearchState()
    navRecord(`搜索：${keyword}`, navReplaySearch(keyword, state, searchType))
  }

  // ========== 隐藏播放器（np-bar） ==========
  function applyPlayerHidden(hidden) {
    document.body.classList.toggle("np-bar-hidden", !!hidden)
    const showBtn = document.getElementById("showPlayerBtn")
    if (showBtn) showBtn.classList.toggle("hidden", !hidden)
    try {
      localStorage.setItem("mp-np-hidden", hidden ? "1" : "0")
    } catch (e) {}
  }

  async function toggleLike(song) {
    const index = likedSongs.findIndex((item) => item.id === song.id)
    if (index > -1) {
      likedSongs.splice(index, 1)
      showToast(`已从"我喜欢"中移除《${song.name}》`)
    } else {
      likedSongs.push(song)
      showToast(`已添加《${song.name}》到"我喜欢"`)
    }
    likedSavesQueue.push([...likedSongs])
    flushLikedSaves()
  }

  async function toggleFollowArtist(artistName) {
    if (!artistName) {
      showToastError("歌手名称无效，无法添加到关注列表")
      return
    }
    if (!followedArtists) followedArtists = []

    const index = followedArtists.indexOf(artistName)
    if (index > -1) {
      followedArtists.splice(index, 1)
      showToast(`已取消关注歌手《${artistName}》`)
    } else {
      followedArtists.push(artistName)
      showToast(`已关注歌手《${artistName}》`)
    }

    try {
      await window.ElectronAPI.saveFollowedArtists(followedArtists)
      const followCountElement = document.getElementById("followCount")
      if (followCountElement)
        followCountElement.textContent = followedArtists.length
    } catch (err) {
      console.error("保存关注歌手列表失败:", err)
      showToastError("保存关注歌手列表失败，请检查日志")
    }
  }

  function showArtistSelectionMenu(e, artists, parentMenu) {
    const existingSubMenus = document.querySelectorAll(".artist-selection-menu")
    existingSubMenus.forEach((menu) => menu.remove())

    const subMenu = document.createElement("div")
    subMenu.className =
      "artist-selection-menu absolute bg-white border border-gray-300 rounded shadow-lg z-51 py-2 dark:bg-gray-800 dark:border-gray-700"
    // z-51 不是有效 Tailwind 类（默认刻度无此值），子菜单需高于父菜单 320
    subMenu.style.zIndex = "321"
    subMenu.style.position = "absolute"

    document.body.appendChild(subMenu)

    const title = document.createElement("div")
    title.className =
      "px-4 py-1 text-xs font-medium text-gray-500 dark:text-gray-400"
    title.textContent = "选择要关注的歌手"
    subMenu.appendChild(title)

    const divider = document.createElement("div")
    divider.className = "border-t border-gray-200 my-1 dark:border-gray-700"
    subMenu.appendChild(divider)

    artists.forEach((artist) => {
      const isFollowed = followedArtists.includes(artist)
      const btn = document.createElement("button")
      btn.className =
        "w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white"
      btn.textContent = isFollowed ? `取消关注 ${artist}` : `关注 ${artist}`
      btn.addEventListener("click", () => {
        toggleFollowArtist(artist)
        subMenu.remove()
        parentMenu.remove()
      })
      subMenu.appendChild(btn)
    })

    const parentRect = parentMenu.getBoundingClientRect()
    const subMenuRect = subMenu.getBoundingClientRect()
    const screenWidth = window.innerWidth
    const screenHeight = window.innerHeight

    let left = parentRect.right + 5
    let top = parentRect.top

    if (left + subMenuRect.width > screenWidth)
      left = parentRect.left - subMenuRect.width - 5
    if (top + subMenuRect.height > screenHeight)
      top = screenHeight - subMenuRect.height - 10
    left = Math.max(10, left)
    top = Math.max(10, top)

    subMenu.style.left = `${left}px`
    subMenu.style.top = `${top}px`

    setTimeout(() => {
      document.addEventListener("click", function closeSubMenu(e) {
        if (!subMenu.contains(e.target) && !parentMenu.contains(e.target)) {
          if (document.body.contains(subMenu)) subMenu.remove()
          document.removeEventListener("click", closeSubMenu)
        }
      })
    }, 0)
  }

  function renderSearchResults(songs, offset = 0) {
    if (!searchResultList) return
    if (offset === 0) {
      searchResultList.innerHTML = ""
    }

    songs.forEach((song, idx) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
      const canDl = !isSongLocalPath(song)
      const li = document.createElement("li")
      li.className = "song-item p-4 transition-colors duration-200"
      li.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          ${
            canDl
              ? `<input type="checkbox" class="download-song-cb selection-sq-checkbox mt-1 h-4 w-4 flex-shrink-0" data-song-id="${escapeHtml(song.id)}" ${selectedSearchIds.has(song.id) ? "checked" : ""} />`
              : `<span class="w-4 flex-shrink-0"></span>`
          }
          <div class="flex-1 min-w-0">
            <h3 class="font-medium dark:text-white truncate">${escapeHtml(song.name)}</h3>
            <p class="text-sm text-gray-400 dark:text-gray-500 truncate"><span class="artist-link" data-artist="${escapeHtml(song.artist)}">${escapeHtml(song.artist)}</span>${sourceBadgeHtml(song)} - ${escapeHtml(song.album)}</p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button class="like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"} hover:text-red-500 transition-colors" data-song-id="${escapeHtml(song.id)}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="${isLiked ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </button>
            <button class="add-to-playlist" data-song-id="${escapeHtml(song.id)}">+</button>
            <button class="more-btn" data-song-id="${escapeHtml(song.id)}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" /></svg>
            </button>
          </div>
        </div>
      `
      const globalIndex = searchResults.length - songs.length + idx
      li.dataset.index = globalIndex
      li.dataset.songId = song.id
      li.dataset.list = "search"
      let lastClickTime = 0
      li.addEventListener("click", (e) => {
        if (e.target.closest(".download-song-cb")) return
        const now = Date.now()
        if (now - lastClickTime < 300) {
          playSelectedSong(song, "search")
          lastClickTime = 0
        } else {
          lastClickTime = now
          selectSong(song, globalIndex, "search")
        }
      })
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault()
        showSongContextMenu(e, song, "search")
      })
      const searchCb = li.querySelector(".download-song-cb")
      if (searchCb) {
        searchCb.addEventListener("click", (e) => e.stopPropagation())
        searchCb.addEventListener("change", () => {
          if (searchCb.checked) selectedSearchIds.add(song.id)
          else selectedSearchIds.delete(song.id)
          syncSearchSelectAllCheckbox()
        })
      }
      searchResultList.appendChild(li)
    })

    syncSearchSelectAllCheckbox()

    setLoadMoreVisible(songs.length >= PAGE_SIZE)
    if (loadMoreBtn) loadMoreBtn.style.margin = "0 auto"
  }

  function removeFromPlaylist(index) {
    const song = playQueue[index]
    playQueue.splice(index, 1)
    renderPlaylist()
    showToast(`已从播放列表中移除《${song.name}》`)

    if (index === currentSongIndex) {
      if (playQueue.length === 0) {
        userIntentPause = true
        if (audioPlayer) audioPlayer.pause()
        currentSongIndex = -1
        syncNowPlayingRows(null)
        if (songTitle) songTitle.textContent = "未播放歌曲"
        if (songArtist) songArtist.textContent = "--"
        if (coverImg) coverImg.src = "../../assets/icon.ico"
        if (lyricsCoverImg) lyricsCoverImg.src = "../../assets/icon.ico"
        renderLyrics("")
      } else {
        playNextSong()
      }
    } else if (index < currentSongIndex) {
      currentSongIndex--
    }
  }

  // 清空整个播放队列并停止播放
  function clearQueue() {
    if (playQueue.length === 0) return
    playQueue = []
    currentSongIndex = -1
    userIntentPause = true
    if (audioPlayer) audioPlayer.pause()
    renderPlaylist()
    syncNowPlayingRows(null)
    if (songTitle) songTitle.textContent = "未播放歌曲"
    if (songArtist) songArtist.textContent = "--"
    if (coverImg) coverImg.src = "../../assets/icon.ico"
    if (lyricsCoverImg) lyricsCoverImg.src = "../../assets/icon.ico"
    renderLyrics("")
    localStorage.removeItem("mp-session")
  }

  // 把歌曲设为"下一首播放"（插入到当前曲目的后一位）
  function playSongNext(song) {
    if (!song || !song.id) return
    const existIdx = playQueue.findIndex((s) => s.id === song.id)
    if (existIdx === currentSongIndex) {
      showToast("该歌曲正在播放")
      return
    }
    if (existIdx !== -1) {
      const [moved] = playQueue.splice(existIdx, 1)
      if (existIdx < currentSongIndex) currentSongIndex--
      const insertAt = currentSongIndex >= 0 ? currentSongIndex + 1 : 0
      playQueue.splice(insertAt, 0, moved)
    } else {
      const insertAt = currentSongIndex >= 0 ? currentSongIndex + 1 : 0
      playQueue.splice(insertAt, 0, song)
    }
    renderPlaylist()
    showToast(`已将《${song.name}》设为下一首播放`)
  }

  // 拖拽重排队列，保持当前播放索引正确
  function reorderQueue(from, to) {
    if (
      from === to ||
      from < 0 ||
      from >= playQueue.length ||
      to < 0 ||
      to >= playQueue.length
    )
      return
    const [moved] = playQueue.splice(from, 1)
    playQueue.splice(to, 0, moved)
    if (from === currentSongIndex) {
      currentSongIndex = to
    } else if (from < currentSongIndex && to >= currentSongIndex) {
      currentSongIndex--
    } else if (from > currentSongIndex && to <= currentSongIndex) {
      currentSongIndex++
    }
    renderPlaylist()
  }

  async function removeFromLatestPlayed(song) {
    const index = latestPlayed.findIndex((item) => item.id === song.id)
    if (index > -1) {
      latestPlayed.splice(index, 1)
      if (recentCount) recentCount.textContent = latestPlayed.length
      try {
        await window.ElectronAPI.saveLatestPlayed(latestPlayed)
        showToast(`已从最近播放中移除《${song.name}》`)
      } catch (err) {
        console.error("保存最近播放失败:", err)
        showToastError("移除失败")
      }
    }
  }

  function addToPlaylist(song) {
    const isExist = playQueue.some((item) => item.id === song.id)
    if (isExist) {
      showToast("该歌曲已在播放列表中")
      return
    }
    playQueue.push(song)
    renderPlaylist()
    showToast(`已添加《${song.name}》到播放列表`)
  }

  function showAddToPlaylistMenu(e, song) {
    const existingMenus = document.querySelectorAll(
      ".absolute.bg-white.border.border-gray-300.rounded.shadow-lg.z-50.py-2, .absolute.bg-gray-800.border.border-gray-700.rounded.shadow-lg.z-50.py-2, .artist-selection-menu"
    )
    existingMenus.forEach((menu) => menu.remove())

    const menu = document.createElement("div")
    menu.className =
      "absolute bg-white border border-gray-300 rounded shadow-lg z-50 py-2 dark:bg-gray-800 dark:border-gray-700"
    // 压过队列抽屉 z72 / 标题栏 z200，防止菜单被盖住
    menu.style.zIndex = "320"
    menu.style.position = "absolute"

    menu.innerHTML = `
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="addToCurrentPlaylistBtn">添加到当前播放列表</button>
      <div class="border-t border-gray-300 my-1 dark:border-gray-700"></div>
      <div class="px-4 py-1 text-xs text-gray-400 dark:text-gray-500">添加到自定义歌单</div>
    `

    diyPlaylists.forEach((playlist) => {
      const btn = document.createElement("button")
      btn.className =
        "w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white"
      btn.textContent = playlist.name
      btn.addEventListener("click", () => {
        addSongToCustomPlaylist(song, playlist)
        document.body.removeChild(menu)
      })
      menu.appendChild(btn)
    })

    const addToCurrentBtn = menu.querySelector("#addToCurrentPlaylistBtn")
    if (addToCurrentBtn) {
      addToCurrentBtn.addEventListener("click", () => {
        addToPlaylist(song)
        document.body.removeChild(menu)
      })
    }

    document.body.appendChild(menu)

    // 计算菜单位置
    const menuRect = menu.getBoundingClientRect()
    const screenWidth = window.innerWidth
    const screenHeight = window.innerHeight

    let left = e.clientX
    let top = e.clientY

    // 调整水平位置
    if (left + menuRect.width > screenWidth) {
      left = screenWidth - menuRect.width - 10
    }

    // 调整垂直位置
    if (top + menuRect.height > screenHeight) {
      top = screenHeight - menuRect.height - 10
    }

    // 确保菜单在屏幕内
    left = Math.max(10, left)
    top = Math.max(10, top)

    // 设置菜单位置
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`

    setTimeout(() => {
      document.addEventListener("click", function closeMenu(e) {
        if (!menu.contains(e.target)) {
          if (document.body.contains(menu)) document.body.removeChild(menu)
          document.removeEventListener("click", closeMenu)
        }
      })
    }, 0)
  }

  function showSongContextMenu(e, song, listType = "") {
    const existingMenus = document.querySelectorAll(
      ".absolute.bg-white.border.border-gray-300.rounded.shadow-lg.z-50.py-2, .absolute.bg-gray-800.border.border-gray-700.rounded.shadow-lg.z-50.py-2, .artist-selection-menu"
    )
    existingMenus.forEach((menu) => menu.remove())

    const menu = document.createElement("div")
    menu.className =
      "absolute bg-white border border-gray-300 rounded shadow-lg z-50 py-2 dark:bg-gray-800 dark:border-gray-700"
    // 队列抽屉 z72 / 标题栏 z200 / 弹窗 z280 都高于 Tailwind z-50，
    // 右键菜单会被盖住（看似“消失”），用内联 z-index 压过全部层
    menu.style.zIndex = "320"
    menu.style.position = "absolute"

    document.body.appendChild(menu)

    const isLiked = likedSongs.some((item) => item.id === song.id)
    const isFollowed = followedArtists.includes(song.artist)
    const dlSongs = getDownloadSongsForContext(song, listType)
    const dlLabel =
      dlSongs.length > 1
        ? `下载选中（${dlSongs.length} 首）`
        : "下载到本地"

    menu.innerHTML = `
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="addToLikedBtn">${isLiked ? "移除我喜欢" : "添加到我喜欢"}</button>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="addToFollowedBtn">${isFollowed ? "取消关注歌手" : "关注歌手"}</button>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="addToCurrentPlaylistBtn">添加到当前播放列表</button>
      ${listType === "playlist" ? `<button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="playNextMenuBtn">下一首播放</button><button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-red-400" id="removeFromQueueBtn">从队列移除</button>` : ""}
      ${!isSongLocalPath(song) && dlSongs.length ? `<button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="downloadSongMenuBtn">${dlLabel}</button>` : ""}
      <div class="border-t border-gray-300 my-1 dark:border-gray-700"></div>
      <div class="px-4 py-1 text-xs text-gray-400 dark:text-gray-500">添加到自定义歌单</div>
    `

    diyPlaylists.forEach((playlist) => {
      const btn = document.createElement("button")
      btn.className =
        "w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white"
      btn.textContent = playlist.name
      btn.addEventListener("click", () => {
        addSongToCustomPlaylist(song, playlist)
        document.body.removeChild(menu)
      })
      menu.appendChild(btn)
    })

    const menuRect = menu.getBoundingClientRect()
    const screenWidth = window.innerWidth
    const screenHeight = window.innerHeight

    let left = e.clientX
    let top = e.clientY

    if (left + menuRect.width > screenWidth)
      left = screenWidth - menuRect.width - 10
    if (top + menuRect.height > screenHeight)
      top = screenHeight - menuRect.height - 10
    left = Math.max(10, left)
    top = Math.max(10, top)

    menu.style.left = `${left}px`
    menu.style.top = `${top}px`

    const addToLikedBtn = menu.querySelector("#addToLikedBtn")
    const addToFollowedBtn = menu.querySelector("#addToFollowedBtn")
    const addToCurrentBtn = menu.querySelector("#addToCurrentPlaylistBtn")

    if (addToLikedBtn) {
      addToLikedBtn.addEventListener("click", () => {
        toggleLike(song)
        document.body.removeChild(menu)
      })
    }

    if (addToFollowedBtn) {
      addToFollowedBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        const artists = song.artist
          .split("/")
          .map((artist) => artist.trim())
          .filter((artist) => artist)
        if (artists.length === 1) {
          toggleFollowArtist(artists[0])
          document.body.removeChild(menu)
        } else {
          showArtistSelectionMenu(e, artists, menu)
        }
      })
    }

    if (addToCurrentBtn) {
      addToCurrentBtn.addEventListener("click", () => {
        addToPlaylist(song)
        document.body.removeChild(menu)
      })
    }

    const playNextMenuBtn = menu.querySelector("#playNextMenuBtn")
    if (playNextMenuBtn) {
      playNextMenuBtn.addEventListener("click", () => {
        playSongNext(song)
        if (document.body.contains(menu)) document.body.removeChild(menu)
      })
    }
    const removeFromQueueBtn = menu.querySelector("#removeFromQueueBtn")
    if (removeFromQueueBtn) {
      removeFromQueueBtn.addEventListener("click", () => {
        const idx = playQueue.findIndex((item) => item.id === song.id)
        if (idx > -1) removeFromPlaylist(idx)
        if (document.body.contains(menu)) document.body.removeChild(menu)
      })
    }

    const downloadSongMenuBtn = menu.querySelector("#downloadSongMenuBtn")
    if (downloadSongMenuBtn) {
      downloadSongMenuBtn.addEventListener("click", async () => {
        if (document.body.contains(menu)) document.body.removeChild(menu)
        openDownloadModal(dlSongs)
      })
    }

    setTimeout(() => {
      document.addEventListener("click", function closeMenu(e) {
        if (!menu.contains(e.target)) {
          if (document.body.contains(menu)) document.body.removeChild(menu)
          document.removeEventListener("click", closeMenu)
        }
      })
    }, 0)
  }

  function addSongToCustomPlaylist(song, playlist) {
    const isExist = playlist.songs.some((item) => item.id === song.id)
    if (isExist) {
      showToast(`该歌曲已在歌单《${playlist.name}》中`)
      return
    }
    playlist.songs.push(song)
    window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
    if (currentPlaylist && currentPlaylist.id === playlist.id) {
      renderPlaylistDetail(playlist)
    }
    renderPlaylistSidebar()
    showToast(`已添加《${song.name}》到歌单《${playlist.name}》`)
  }

  async function addToLatestPlayed(song) {
    latestPlayed = latestPlayed.filter((item) => item.id !== song.id)
    latestPlayed.unshift(song)
    if (latestPlayed.length > MAX_LATEST_PLAYED) {
      latestPlayed = latestPlayed.slice(0, MAX_LATEST_PLAYED)
    }
    recentSavesQueue.push([...latestPlayed])
    flushRecentSaves()
  }

  async function preloadNextSong() {
    if (!playQueue.length) return
    let nextIndex = currentSongIndex
    switch (playMode) {
      case "order":
      case "listLoop":
        nextIndex = (currentSongIndex + 1) % playQueue.length
        break
      case "reverse":
        nextIndex = (currentSongIndex - 1 + playQueue.length) % playQueue.length
        break
      case "shuffle":
        nextIndex = Math.floor(Math.random() * playQueue.length)
        break
      case "singleLoop":
        return
    }
    const nextSong = playQueue[nextIndex]
    if (
      nextSong &&
      nextSong.url &&
      audioPlayer &&
      nextSong.url !== audioPlayer.src
    ) {
      const link = document.createElement("link")
      link.rel = "preload"
      link.as = "audio"
      link.href = nextSong.url
      document.head.appendChild(link)
      setTimeout(() => link.remove(), 10000)
    }
  }

  // 同步“当前播放行”高亮到搜索结果 / 歌单详情列表（队列由 renderPlaylist 处理）
  let nowPlayingSongId = null
  function syncNowPlayingRows(song) {
    const id = song ? String(song.id) : null
    nowPlayingSongId = id
    ;[searchResultList, playlistDetailList].forEach((c) => {
      if (!c) return
      c.querySelectorAll("li.song-item").forEach((li) => {
        li.classList.toggle("now-playing", li.dataset.songId === id)
      })
    })
  }

  // 歌曲加载/解码失败兜底：CDN 偶发挂起或链接失效时自动跳过，避免永久卡在加载态。
  // 连续失败超过上限则停止，防止全队列失效时死循环。
  // 在线歌曲失败时优先尝试跨平台换源（go-music-dl /api/switch_source），
  // 换源成功则以新音源原地续播；失败或无替代再走跳过逻辑。
  const sourceSwitchTried = new Set() // 同一逻辑歌曲（name|artist）仅换源一次，避免链式换源死循环

  async function attemptSourceSwitch(song) {
    const key = `${String(song.name)}|${String(song.artist || "")}`
    if (sourceSwitchTried.has(key)) return null
    sourceSwitchTried.add(key)
    let dur = Number(song.duration) || 0
    if (dur > 7200) dur = Math.round(dur / 1000) // 兼容毫秒时长的歌曲结构
    showToast(`正在为《${song.name}》寻找其他音源…`, "info")
    try {
      const res = await window.ElectronAPI.musicDlSwitchSource(
        song.name,
        song.artist || "",
        song.source || "",
        dur
      )
      if (!res || !res.success || !res.song || !res.song.url) return null
      const switched = enrichMusicDlSearchSong(res.song)
      if (!switched || !/^https?:\/\//i.test(switched.url)) return null
      return switched
    } catch (e) {
      return null
    }
  }

  async function handlePlaybackFailure() {
    const n = playQueue.length
    if (n === 0) return

    // 先尝试换源：链接失效但其他平台可能有同名可播曲目
    const failedSong = playQueue[currentSongIndex]
    if (
      failedSong &&
      failedSong.name &&
      !isSongLocalPath(failedSong) &&
      window.ElectronAPI &&
      typeof window.ElectronAPI.musicDlSwitchSource === "function"
    ) {
      const myGeneration = playGeneration
      loadingSong = true // 换源期间看护不干预
      const switched = await attemptSourceSwitch(failedSong)
      if (myGeneration !== playGeneration) {
        loadingSong = false // 用户已切歌，放弃本次换源
        return
      }
      if (switched) {
        playQueue[currentSongIndex] = switched
        recoverTries = 0
        stallTicks = 0
        consecutiveFailCount = 0
        renderPlaylist()
        showToast(`已切换至 ${switched.source} 音源继续播放`, "success")
        playCurrentSong()
        return
      }
      loadingSong = false
    }

    if (consecutiveFailCount >= 3) {
      userIntentPause = true
      if (audioPlayer) audioPlayer.pause()
      showToastError("多首歌曲加载失败，请检查网络后重试")
      return
    }
    consecutiveFailCount++
    if (n <= 1) {
      userIntentPause = true
      if (audioPlayer) audioPlayer.pause()
      showToastError("播放失败：歌曲链接可能失效")
      return
    }
    showToast("当前歌曲加载失败，正在尝试下一首…", "info")
    currentSongIndex = (currentSongIndex + 1) % n
    playCurrentSong()
  }

  async function playCurrentSong(opts = {}) {
    const autoplay = opts.autoplay !== false
    if (currentSongIndex < 0 || currentSongIndex >= playQueue.length) return

    const myGeneration = ++playGeneration
    loadingSong = true
    const song = playQueue[currentSongIndex]
    if (!song.url || song.url.trim() === "") {
      loadingSong = false
      showToastError("播放失败：歌曲链接无效")
      return
    }
    if (!isSongLocalPath(song) && !/^https?:\/\//i.test(song.url)) {
      loadingSong = false
      showToastError("播放失败：歌曲链接格式错误")
      return
    }

    // 在线歌封面缺失或误用歌曲 id 构造（meting pic 直接用歌曲id会 404）时，按 id 解析真实封面
    if (
      !isSongLocalPath(song) &&
      /^https?:\/\//i.test(song.url) &&
      window.ElectronAPI &&
      typeof window.ElectronAPI.musicSongDetail === "function"
    ) {
      const badCover =
        !song.coverUrl ||
        (song.coverUrl.indexOf("type=pic") >= 0 &&
          song.coverUrl.indexOf("id=" + song.id) >= 0)
      if (badCover) {
        try {
          const d = await window.ElectronAPI.musicSongDetail(
            song.source || "netease",
            song.id
          )
          if (myGeneration !== playGeneration) return
          if (d && d.success) {
            if (d.pic) song.coverUrl = d.pic
            if ((!song.name || song.name === "未知歌曲") && d.name)
              song.name = d.name
            if ((!song.artist || song.artist === "未知歌手") && d.artist)
              song.artist = d.artist
          }
        } catch (e) {}
      }
    }

    // 重置并直接加载目标音频（不再用临时 Audio 双重加载）
    audioPlayer.pause()
    audioPlayer.src =
      window.ElectronAPI && typeof window.ElectronAPI.proxyMedia === "function"
        ? window.ElectronAPI.proxyMedia(song.url)
        : song.url
    syncNowPlayingRows(song)
    if (songTitle) songTitle.textContent = song.name
    if (songArtist) {
      songArtist.textContent = song.artist
      if (song.artist) {
        songArtist.classList.add("artist-link")
        songArtist.dataset.artist = song.artist
        songArtist.title = "查看歌手：" + song.artist
      } else {
        songArtist.classList.remove("artist-link")
        delete songArtist.dataset.artist
        songArtist.removeAttribute("title")
      }
    }

    if (song.coverUrl) {
      if (coverImg) coverImg.src = song.coverUrl
      if (lyricsCoverImg) lyricsCoverImg.src = song.coverUrl
    } else {
      const defaultCover = "../../assets/icon.ico"
      if (coverImg) coverImg.src = defaultCover
      if (lyricsCoverImg) lyricsCoverImg.src = defaultCover
    }
    // 歌词页沉浸式模糊背景跟随当前封面
    const lyricsBg = document.getElementById("lyricsBg")
    if (lyricsBg) {
      lyricsBg.style.backgroundImage = song.coverUrl
        ? `url("${song.coverUrl}")`
        : ""
    }

    if (lyricsSongTitle) lyricsSongTitle.textContent = song.name
    if (lyricsSongArtist) {
      lyricsSongArtist.textContent = song.artist
      if (song.artist) {
        lyricsSongArtist.classList.add("artist-link")
        lyricsSongArtist.dataset.artist = song.artist
        lyricsSongArtist.title = "查看歌手：" + song.artist
      } else {
        lyricsSongArtist.classList.remove("artist-link")
        delete lyricsSongArtist.dataset.artist
        lyricsSongArtist.removeAttribute("title")
      }
    }

    await loadLyricsWithStatus(song)
    if (myGeneration !== playGeneration) return

    try {
      if (audioPlayer.readyState < 2) {
        await new Promise((resolve) => {
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(metaTimer)
            resolve()
          }
          const metaTimer = setTimeout(finish, 12000)
          audioPlayer.addEventListener("loadedmetadata", finish, { once: true })
          audioPlayer.addEventListener("error", finish, { once: true })
        })
      }
      if (myGeneration !== playGeneration) return
      // 加载超时或 error 事件：readyState 仍无元数据，判定加载失败
      if (audioPlayer.readyState < 1) {
        const err = new Error("MEDIA_TIMEOUT")
        err.name = "MediaTimeoutError"
        throw err
      }
      if (autoplay) {
        await audioPlayer.play()
        if (myGeneration !== playGeneration) return
        if (isFinite(opts.startTime) && opts.startTime > 1) {
          audioPlayer.currentTime = opts.startTime
        }
        consecutiveFailCount = 0
        stallTicks = 0
        loadingSong = false
        watchdogLastTime = -1
        userIntentPause = false
        renderPlaylist()
        await addToLatestPlayed(song)
        emitFeature("songchange", song)
      } else {
        if (isFinite(opts.startTime) && opts.startTime > 0) {
          audioPlayer.currentTime = opts.startTime
        }
        loadingSong = false
        userIntentPause = true
        renderPlaylist()
        emitFeature("songchange", song)
      }
    } catch (err) {
      if (myGeneration !== playGeneration) return
      loadingSong = false
      userIntentPause = true
      if (err.name === "NotAllowedError") {
        showToastError("播放失败：浏览器阻止了自动播放")
      } else if (
        err.name === "MediaTimeoutError" ||
        err.name === "NetworkError" ||
        err.name === "DecodeError" ||
        err.name === "NotSupportedError"
      ) {
        handlePlaybackFailure()
      }
    }
    if (myGeneration !== playGeneration) return
    preloadNextSong()
  }

  // ========== 事件委托处理函数 ==========
  function handlePlaylistClick(e) {
    if (e.target.closest(".download-song-cb")) return
    const target = e.target.closest("button")
    if (!target) return
    const li = target.closest("li")
    const index = parseInt(li?.dataset.index, 10)
    if (isNaN(index)) return
    const song = playQueue[index]
    if (!song) return

    if (target.classList.contains("like-btn")) {
      e.stopPropagation()
      toggleLike(song)
      const isLiked = likedSongs.some((item) => item.id === song.id)
      target.className = `like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"} hover:text-red-500 transition-colors`
      target
        .querySelector("svg")
        .setAttribute("fill", isLiked ? "currentColor" : "none")
    } else if (target.classList.contains("add-to-playlist")) {
      e.stopPropagation()
      showAddToPlaylistMenu(e, song)
    } else if (target.classList.contains("delete-btn")) {
      e.stopPropagation()
      removeFromPlaylist(index)
    } else if (target.classList.contains("more-btn")) {
      e.stopPropagation()
      showSongContextMenu(e, song, "playlist")
    }
  }

  function handleSearchResultClick(e) {
    if (e.target.closest(".download-song-cb")) return
    const target = e.target.closest("button")
    if (!target) return
    const li = target.closest("li")
    const globalIndex = parseInt(li?.dataset.index, 10)
    if (isNaN(globalIndex)) return
    const song = searchResults[globalIndex]
    console.log("[搜索结果] globalIndex:", globalIndex, "song:", song)
    console.log("[搜索结果] song.url:", song?.url)
    if (!song) return

    if (target.classList.contains("like-btn")) {
      e.stopPropagation()
      toggleLike(song)
      const isLiked = likedSongs.some((item) => item.id === song.id)
      target.className = `like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"} hover:text-red-500 transition-colors`
      target
        .querySelector("svg")
        .setAttribute("fill", isLiked ? "currentColor" : "none")
    } else if (target.classList.contains("add-to-playlist")) {
      e.stopPropagation()
      showAddToPlaylistMenu(e, song)
    } else if (target.classList.contains("more-btn")) {
      e.stopPropagation()
      showSongContextMenu(e, song, "search")
    }
  }

  function handlePlaylistDetailClick(e) {
    if (e.target.closest(".download-song-cb")) return
    const target = e.target.closest("button")
    if (!target) return
    const li = target.closest("li")
    const index = parseInt(li?.dataset.index, 10)
    if (isNaN(index) || !currentPlaylist) return
    const song = currentPlaylist.songs[index]
    if (!song) return

    if (target.classList.contains("like-btn")) {
      e.stopPropagation()
      toggleLike(song)
      const isLiked = likedSongs.some((item) => item.id === song.id)
      target.className = `like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"} hover:text-red-500 transition-colors`
      target
        .querySelector("svg")
        .setAttribute("fill", isLiked ? "currentColor" : "none")
    } else if (target.classList.contains("add-to-playlist")) {
      e.stopPropagation()
      showAddToPlaylistMenu(e, song)
    } else if (target.classList.contains("delete-btn")) {
      e.stopPropagation()
      if (currentPlaylist.id === "liked") {
        toggleLike(song)
        renderPlaylistDetail(currentPlaylist)
      } else if (currentPlaylist.id === "recent") {
        removeFromLatestPlayed(song)
        renderPlaylistDetail(currentPlaylist)
      } else if (currentPlaylist.id === "local") {
        window.ElectronAPI.deleteLocalSong(song.url).then(async (result) => {
          if (result.success) {
            localSongs = await window.ElectronAPI.readLocalSongs()
            const localCountEl = document.getElementById("localCount")
            if (localCountEl) localCountEl.textContent = localSongs.length
            showLocalSongs()
            showToast(`已删除本地歌曲：${song.name}`)
          } else {
            showToastError(`删除失败：${result.error}`)
          }
        })
      } else if (currentPlaylist.id === "followed") {
        toggleFollowArtist(song.artist)
        renderPlaylistDetail(currentPlaylist)
      } else {
        removeFromCustomPlaylist(currentPlaylist, index)
      }
    } else if (target.classList.contains("more-btn")) {
      e.stopPropagation()
      showSongContextMenu(e, song, "playlist-detail")
    }
  }

  // ========== 播放控制功能 ==========
  function playNextSong() {
    if (playQueue.length === 0) return

    let wasLastSong = false
    if (playMode === "order" && currentSongIndex === playQueue.length - 1)
      wasLastSong = true
    if (playMode === "reverse" && currentSongIndex === 0) wasLastSong = true

    switch (playMode) {
      case "order":
        currentSongIndex = (currentSongIndex + 1) % playQueue.length
        if (wasLastSong) {
          userIntentPause = true
          if (audioPlayer) audioPlayer.pause()
          currentSongIndex = -1
          syncNowPlayingRows(null)
          if (songTitle) songTitle.textContent = "播放结束"
          if (songArtist) songArtist.textContent = ""
          if (lyricsInterface) lyricsInterface.classList.add("hidden")
          if (mainInterface) mainInterface.classList.remove("hidden")
          return
        }
        break
      case "reverse":
        currentSongIndex =
          (currentSongIndex - 1 + playQueue.length) % playQueue.length
        if (wasLastSong) {
          userIntentPause = true
          if (audioPlayer) audioPlayer.pause()
          currentSongIndex = -1
          syncNowPlayingRows(null)
          if (songTitle) songTitle.textContent = "播放结束"
          if (songArtist) songArtist.textContent = ""
          if (lyricsInterface) lyricsInterface.classList.add("hidden")
          if (mainInterface) mainInterface.classList.remove("hidden")
          return
        }
        break
      case "singleLoop":
        if (audioPlayer) {
          audioPlayer.currentTime = 0
          audioPlayer.play()
        }
        return
      case "listLoop":
        currentSongIndex = (currentSongIndex + 1) % playQueue.length
        break
      case "shuffle":
        currentSongIndex = Math.floor(Math.random() * playQueue.length)
        break
    }
    playCurrentSong()
  }

  // ========== 搜索功能 ==========
  async function loadSearchResults(keyword, offset) {
    // 记录当前关键词，供“返回搜索结果”按钮恢复搜索框
    currentKeyword = keyword
    if (offset === 0 && searchResultList) {
      searchResultList.innerHTML = `<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索中...</p></div>`
    }

    const cacheKey = `${keyword}_${offset}`
    let songs

    if (searchCache.has(cacheKey)) {
      console.log(
        `[搜索] 从缓存获取结果，关键词：${keyword}，偏移量：${offset}`
      )
      songs = searchCache.get(cacheKey)
    } else {
      try {
        // 检查用户是否选择了搜索源
        console.log(`[搜索] 开始搜索，关键词：${keyword}，偏移量：${offset}`)
        const savedSources = localStorage.getItem("selected-search-sources")
        let selectedSources = []
        if (savedSources) {
          try {
            selectedSources = JSON.parse(savedSources)
            console.log(
              `[搜索] 从本地存储读取的搜索源：${JSON.stringify(selectedSources)}`
            )
            console.log(`[搜索] 搜索源数量：${selectedSources.length}`)
          } catch (error) {
            console.error("解析搜索源失败:", error)
          }
        } else {
          console.log(`[搜索] 本地存储中没有保存的搜索源`)
        }

        if (selectedSources && selectedSources.length > 0) {
          // 使用 go-music-dl API 搜索
          const sourcesString = selectedSources.join(",")
          console.log(`[搜索] 使用 go-music-dl API 搜索，源：${sourcesString}`)
          console.log(
            `[搜索] 准备调用 musicDlSearch，关键词：${keyword}，源：${sourcesString}`
          )
          try {
            const response = await window.ElectronAPI.musicDlSearch(
              keyword,
              sourcesString,
              Math.floor(offset / PAGE_SIZE) + 1,
              PAGE_SIZE
            )

            console.log(`[搜索] go-music-dl API 响应状态：成功`)

            if (response && response.songs) {
              songs = response.songs
                .map((song) => enrichMusicDlSearchSong(song))
                .filter(Boolean)
              console.log(
                `[搜索] go-music-dl 有效条目：${songs.length}/${response.songs.length}`
              )
            } else if (response && response.error) {
              // API 调用失败，回退到默认 API
              console.log(`[搜索] go-music-dl API 调用失败：${response.error}，回退默认 API`)
              songs = await window.ElectronAPI.searchMusic(keyword, offset)
            } else {
              console.log(`[搜索] go-music-dl API 未返回 songs 字段，回退默认 API`)
              songs = await window.ElectronAPI.searchMusic(keyword, offset)
            }
          } catch (error) {
            // 发生异常，回退到默认 API
            console.error(`[搜索] go-music-dl API 调用异常：${error.message}，回退默认 API`)
            songs = await window.ElectronAPI.searchMusic(keyword, offset)
          }
        } else {
          // 使用默认 API 搜索
          songs = await window.ElectronAPI.searchMusic(keyword, offset)
        }

        if (songs && songs.length > 0) {
          searchCache.set(cacheKey, songs)
          // 简单 LRU：超出上限淘汰最早条目，避免长期使用无限增长
          if (searchCache.size > SEARCH_CACHE_MAX) {
            const oldestKey = searchCache.keys().next().value
            searchCache.delete(oldestKey)
          }
        }
      } catch (err) {
        console.error("[搜索] API请求失败：", err)
        showToastError("搜索失败，请查看日志或检查网络")
        if (offset === 0 && searchResultList) {
          searchResultList.innerHTML =
            '<div class="p-10 text-center text-red-500 dark:text-red-400">搜索失败，请稍后重试</div>'
          setLoadMoreVisible(false)
        }
        return
      }
    }

    if (songs && songs.length > 0) {
      if (offset === 0) {
        searchResults = songs
        renderSearchResults(songs, offset)
        if (searchResultsSection) {
          searchResultsSection.classList.remove("fade-in")
          void searchResultsSection.offsetWidth
          searchResultsSection.classList.add("fade-in")
        }
      } else {
        searchResults = [...searchResults, ...songs]
        renderSearchResults(songs, offset)
      }
    } else if (offset === 0) {
      if (searchResultList)
        searchResultList.innerHTML =
          '<div class="p-10 text-center text-gray-500 dark:text-gray-400">未找到相关歌曲</div>'
      setLoadMoreVisible(false)
    }
  }

  async function performSearch(keyword) {
    if (!keyword || isSearching) return
    isSearching = true
    try {
      selectedSearchIds.clear()
      searchOffset = 0
      if (searchResultsSection) searchResultsSection.classList.remove("hidden")
      if (playlistDetailSection) playlistDetailSection.classList.add("hidden")
      // 设置标题为"搜索结果"
      const titleElement = document.querySelector("#searchResultsSection h2")
      if (titleElement) titleElement.textContent = "搜索结果"
      // 显示加载动画
      if (searchResultList)
        searchResultList.innerHTML =
          '<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索中...</p></div>'
      if (searchType === "playlist") {
        await loadPlaylistSearchResults(keyword)
      } else {
        await loadSearchResults(keyword, searchOffset)
      }
      await updateSearchHistory(keyword)
      initSearchState()
      recordSearchNav(keyword)
      if (searchResultsSection) {
        searchResultsSection.classList.remove("fade-in")
        void searchResultsSection.offsetWidth
        searchResultsSection.classList.add("fade-in")
      }
    } finally {
      isSearching = false
    }
  }

  // ========== 歌单搜索（go-music-dl /api/playlist_search）==========
  function getSelectedSearchSourcesString() {
    try {
      const saved = JSON.parse(
        localStorage.getItem("selected-search-sources") || "[]"
      )
      if (Array.isArray(saved) && saved.length) return saved.join(",")
    } catch (e) {}
    return ""
  }

  async function loadPlaylistSearchResults(keyword) {
    if (searchResultList) {
      searchResultList.classList.remove("pl-grid")
      searchResultList.innerHTML =
        '<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索歌单中...</p></div>'
    }
    setLoadMoreVisible(false)

    let playlists = null
    const cacheKey = keyword
    if (playlistSearchCache.has(cacheKey)) {
      playlists = playlistSearchCache.get(cacheKey)
    } else {
      const res = await window.ElectronAPI.musicDlPlaylistSearch(
        keyword,
        getSelectedSearchSourcesString()
      )
      if (res && Array.isArray(res.playlists)) {
        playlists = res.playlists.filter((p) => p && p.id && p.name)
        playlistSearchCache.set(cacheKey, playlists)
        if (playlistSearchCache.size > PLAYLIST_SEARCH_CACHE_MAX) {
          const oldestKey = playlistSearchCache.keys().next().value
          playlistSearchCache.delete(oldestKey)
        }
      } else {
        if (searchResultList)
          searchResultList.innerHTML =
            '<div class="p-10 text-center text-red-500 dark:text-red-400">歌单搜索失败：' +
            escapeHtml(res && res.error ? res.error : "未知错误") +
            "</div>"
        return
      }
    }
    playlistSearchResults = playlists
    renderPlaylistSearchResults()
  }

  function renderPlaylistSearchResults() {
    if (!searchResultList) return
    searchResultList.classList.add("pl-grid")
    searchResultList.innerHTML = ""
    if (!playlistSearchResults.length) {
      searchResultList.classList.remove("pl-grid")
      searchResultList.innerHTML =
        '<div class="p-10 text-center text-gray-500 dark:text-gray-400">未找到相关歌单</div>'
      return
    }
    playlistSearchResults.forEach((p, idx) => {
      const li = document.createElement("li")
      li.className = "search-pl-card"
      li.dataset.plIdx = String(idx)
      const subParts = []
      if (p.play_count > 0) {
        subParts.push(
          p.play_count >= 10000
            ? (p.play_count / 10000).toFixed(1) + "万播放"
            : p.play_count + "播放"
        )
      }
      if (p.track_count > 0) subParts.push(p.track_count + "首")
      const srcLabel = SOURCE_LABELS[p.source] || p.source || ""
      if (srcLabel) subParts.push(srcLabel)
      const cover = p.cover || (p.extra && p.extra.cover) || ""
      li.innerHTML =
        '<div class="pl-cover">' +
        (cover
          ? '<img src="' + escapeHtml(cover) + '" alt="" loading="lazy">'
          : "") +
        "</div>" +
        '<div class="pl-name">' + escapeHtml(p.name) + "</div>" +
        '<div class="pl-sub">' + escapeHtml(subParts.join(" · ")) + "</div>"
      li.addEventListener("click", () => openSearchedPlaylist(p))
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault()
        showOnlinePlaylistMenu(e, {
          id: "search-pl-" + (p.source || "web") + "-" + p.id,
          name: p.name,
          description: p.description || "",
          loadSongs: () => fetchSearchedPlaylistSongs(p),
        })
      })
      searchResultList.appendChild(li)
    })
  }

  // 拉取歌单搜索结果的曲目（失败返回 null，由调用方决定提示文案）
  async function fetchSearchedPlaylistSongs(p) {
    let res = null
    try {
      res = await window.ElectronAPI.musicDlPlaylistDetail(
        p.source || "",
        String(p.id),
        p.name || ""
      )
    } catch (e) {
      res = null
    }
    if (!res || res.error || !Array.isArray(res.songs)) return null
    return res.songs
      .map((s) =>
        enrichMusicDlSearchSong(Object.assign({}, s, { source: s.source || p.source }))
      )
      .filter(Boolean)
  }

  async function openSearchedPlaylist(p) {
    if (!p || !p.id) return
    window.MusicPlayer.toast("正在加载歌单《" + p.name + "》", "info")
    const songs = await fetchSearchedPlaylistSongs(p)
    if (!songs) {
      showToastError("歌单加载失败，请稍后重试")
      return
    }
    if (!songs.length) {
      showToastWarning("该歌单暂无可用歌曲")
      return
    }
    window.MusicPlayer.openPlaylist(
      "search-pl-" + (p.source || "web") + "-" + p.id,
      p.name,
      songs,
      p.description || ""
    )
  }

  // ========== 下载管理（go-music-dl 持久化下载队列 / 下载记录）==========
  const DM_TASK_STATUS = {
    waiting: ["等待中", "dm-st-waiting"],
    downloading: ["下载中", "dm-st-downloading"],
    success: ["已完成", "dm-st-success"],
    skipped: ["已跳过", "dm-st-skipped"],
    failed: ["失败", "dm-st-failed"],
    canceled: ["已取消", "dm-st-canceled"],
  }

  function dmStatusChip(status) {
    const conf = DM_TASK_STATUS[status] || [status || "未知", "dm-st-waiting"]
    return `<span class="dm-chip ${conf[1]}">${conf[0]}</span>`
  }

  function dmSourceBadge(source) {
    const src = String(source || "").toLowerCase()
    if (!src) return ""
    const badge = SOURCE_BADGES[src] || src
    return ` <span class="src-badge">${badge}</span>`
  }

  function ensureDownloadManagerSection() {
    if (dmSection) return dmSection
    dmSection = document.createElement("section")
    dmSection.id = "downloadManagerSection"
    dmSection.className = "content-section hidden"
    const contentScroll = document.getElementById("contentScroll")
    if (!contentScroll) return null
    contentScroll.appendChild(dmSection)
    // 其他视图显示时自动隐藏下载管理
    const hideIfOtherVisible = () => {
      const ids = ["searchResultsSection", "playlistDetailSection", "statsSection", "mineSection"]
      const other = ids.some((id) => {
        const el = document.getElementById(id)
        return el && !el.classList.contains("hidden")
      })
      if (other) {
        dmSection.classList.add("hidden")
        stopDmQueuePolling()
      }
    }
    const observeClass = (el) => {
      new MutationObserver(hideIfOtherVisible).observe(el, {
        attributes: true,
        attributeFilter: ["class"],
      })
    }
    ;["searchResultsSection", "playlistDetailSection"].forEach((id) => {
      const el = document.getElementById(id)
      if (el) observeClass(el)
    })
    // statsSection / mineSection 为懒创建，动态挂观察器
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (
            node.nodeType === 1 &&
            (node.id === "statsSection" || node.id === "mineSection")
          ) {
            observeClass(node)
            hideIfOtherVisible()
          }
        }
      }
    }).observe(contentScroll, { childList: true })
    return dmSection
  }

  function openDownloadManager() {
    const sec = ensureDownloadManagerSection()
    if (!sec) return
    // 隐藏其他视图
    ;[
      "searchResultsSection",
      "playlistDetailSection",
      "homeSection",
      "statsSection",
      "mineSection",
    ].forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.classList.add("hidden")
    })
    sec.classList.remove("hidden")
    renderDownloadManager()
    refreshDmQueue(true)
    refreshDmRecords(true)
    startDmQueuePolling()
    navRecord("下载管理", () => openDownloadManager())
  }

  function startDmQueuePolling() {
    stopDmQueuePolling()
    dmQueueTimer = setInterval(() => {
      if (!dmSection || dmSection.classList.contains("hidden")) {
        stopDmQueuePolling()
        return
      }
      if (dmTab === "queue") refreshDmQueue(false)
    }, 2000)
  }

  function stopDmQueuePolling() {
    if (dmQueueTimer) {
      clearInterval(dmQueueTimer)
      dmQueueTimer = null
    }
  }

  function renderDownloadManager() {
    if (!dmSection) return
    dmSection.innerHTML = `
      <div class="sec-head-row">
        <h2 class="sec-title">下载管理</h2>
        <div class="tl-tabs" id="dmTabs">
          <button type="button" class="tl-tab${dmTab === "queue" ? " active" : ""}" id="dmTabQueue">下载队列</button>
          <button type="button" class="tl-tab${dmTab === "records" ? " active" : ""}" id="dmTabRecords">下载记录</button>
        </div>
      </div>
      <div id="dmQueuePane" class="${dmTab === "queue" ? "" : "hidden"}"></div>
      <div id="dmRecordsPane" class="${dmTab === "records" ? "" : "hidden"}"></div>
    `
    const tabQueue = document.getElementById("dmTabQueue")
    const tabRecords = document.getElementById("dmTabRecords")
    if (tabQueue)
      tabQueue.addEventListener("click", () => switchDmTab("queue"))
    if (tabRecords)
      tabRecords.addEventListener("click", () => switchDmTab("records"))
    renderDmQueuePane()
    renderDmRecordsPane()
  }

  function switchDmTab(tab) {
    if (dmTab === tab) return
    dmTab = tab
    const tabQueue = document.getElementById("dmTabQueue")
    const tabRecords = document.getElementById("dmTabRecords")
    const paneQueue = document.getElementById("dmQueuePane")
    const paneRecords = document.getElementById("dmRecordsPane")
    if (tabQueue) tabQueue.classList.toggle("active", tab === "queue")
    if (tabRecords) tabRecords.classList.toggle("active", tab === "records")
    if (paneQueue) paneQueue.classList.toggle("hidden", tab !== "queue")
    if (paneRecords) paneRecords.classList.toggle("hidden", tab !== "records")
    if (tab === "queue") refreshDmQueue(true)
    else refreshDmRecords(true)
  }

  function renderDmQueuePane() {
    const pane = document.getElementById("dmQueuePane")
    if (!pane) return
    if (!dmQueueData) {
      pane.innerHTML =
        '<div class="card dm-empty"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p>加载下载队列…</p></div>'
      return
    }
    const tasks = Array.isArray(dmQueueData.tasks) ? dmQueueData.tasks : []
    const counts = dmQueueData.counts || {}
    const active =
      (counts.waiting || 0) + (counts.downloading || 0)
    const summary = [
      counts.waiting ? `等待中 ${counts.waiting}` : "",
      counts.downloading ? `下载中 ${counts.downloading}` : "",
      counts.failed ? `失败 ${counts.failed}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
    const rows = tasks
      .map((t) => {
        const status = String(t.Status || "")
        const actions = []
        if (status === "waiting")
          actions.push(
            `<button class="btn btn-mini" data-dm-act="cancel" data-dm-id="${t.ID}">取消</button>`
          )
        if (status === "failed" || status === "canceled")
          actions.push(
            `<button class="btn btn-mini" data-dm-act="retry" data-dm-id="${t.ID}">重试</button>`
          )
        if (status !== "downloading")
          actions.push(
            `<button class="btn btn-mini btn-ghost" data-dm-act="remove" data-dm-id="${t.ID}">移除</button>`
          )
        return `
        <li class="dm-row">
          <div class="dm-info">
            <div class="dm-name">${escapeHtml(t.Name || "未知歌曲")}${dmSourceBadge(t.Source)}</div>
            <div class="dm-sub">${escapeHtml(t.Artist || "")}${t.Error ? ` · <span class="dm-error">${escapeHtml(t.Error)}</span>` : ""}${t.Warning ? ` · <span class="dm-warning">${escapeHtml(t.Warning)}</span>` : ""}${t.Path ? ` · <span class="dm-path">${escapeHtml(t.Path)}</span>` : ""}</div>
          </div>
          <div class="dm-actions">
            ${dmStatusChip(status)}
            ${actions.join("")}
          </div>
        </li>`
      })
      .join("")
    pane.innerHTML = `
      <div class="card">
        <ul class="dm-list">${rows || '<li class="dm-empty">队列为空，点击列表页的「队列下载」按钮把歌曲加入后台下载</li>'}</ul>
        <div class="card-foot dm-foot">
          <span class="dm-summary">${escapeHtml(summary || `共 ${dmQueueData.total || 0} 条任务${active ? "" : ""}`)}</span>
          <span class="flex gap-2">
            <button class="btn btn-mini" id="dmRefreshBtn">刷新</button>
            <button class="btn btn-mini btn-ghost" id="dmClearQueueBtn">清空队列</button>
          </span>
        </div>
      </div>
    `
    const refreshBtn = document.getElementById("dmRefreshBtn")
    if (refreshBtn)
      refreshBtn.addEventListener("click", () => refreshDmQueue(true))
    const clearBtn = document.getElementById("dmClearQueueBtn")
    if (clearBtn) clearBtn.addEventListener("click", dmClearQueue)
    pane.querySelectorAll("[data-dm-act]").forEach((btn) => {
      btn.addEventListener("click", () =>
        dmQueueAction(Number(btn.dataset.dmId), btn.dataset.dmAct)
      )
    })
  }

  function renderDmRecordsPane() {
    const pane = document.getElementById("dmRecordsPane")
    if (!pane) return
    if (!dmRecordsData) {
      pane.innerHTML =
        '<div class="card dm-empty"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p>加载下载记录…</p></div>'
      return
    }
    const records = Array.isArray(dmRecordsData.records)
      ? dmRecordsData.records
      : []
    const rows = records
      .map((r) => {
        const status = String(r.Status || "")
        return `
        <li class="dm-row">
          <div class="dm-info">
            <div class="dm-name">${escapeHtml(r.Name || "未知歌曲")}${dmSourceBadge(r.Source)}</div>
            <div class="dm-sub">${escapeHtml(r.Artist || "")}${r.Error ? ` · <span class="dm-error">${escapeHtml(r.Error)}</span>` : ""}</div>
          </div>
          <div class="dm-actions">
            ${dmStatusChip(status)}
            <span class="dm-time">${escapeHtml(dmFormatTime(r.CreatedAt))}</span>
          </div>
        </li>`
      })
      .join("")
    const page = dmRecordsData.page || 1
    const totalPages = dmRecordsData.total_pages || 1
    pane.innerHTML = `
      <div class="card">
        <ul class="dm-list">${rows || '<li class="dm-empty">暂无下载记录</li>'}</ul>
        <div class="card-foot dm-foot">
          <span class="dm-summary">共 ${dmRecordsData.total || 0} 条记录 · 第 ${page}/${totalPages} 页</span>
          <span class="flex gap-2">
            <button class="btn btn-mini" id="dmRecPrevBtn" ${page <= 1 ? "disabled" : ""}>上一页</button>
            <button class="btn btn-mini" id="dmRecNextBtn" ${page >= totalPages ? "disabled" : ""}>下一页</button>
            <button class="btn btn-mini btn-ghost" id="dmClearRecordsBtn">清空记录</button>
          </span>
        </div>
      </div>
    `
    const prev = document.getElementById("dmRecPrevBtn")
    if (prev)
      prev.addEventListener("click", () => {
        dmRecordsPage = Math.max(1, (dmRecordsData.page || 1) - 1)
        refreshDmRecords(true)
      })
    const next = document.getElementById("dmRecNextBtn")
    if (next)
      next.addEventListener("click", () => {
        dmRecordsPage = Math.min(
          dmRecordsData.total_pages || 1,
          (dmRecordsData.page || 1) + 1
        )
        refreshDmRecords(true)
      })
    const clearBtn = document.getElementById("dmClearRecordsBtn")
    if (clearBtn) clearBtn.addEventListener("click", dmClearRecords)
  }

  function dmFormatTime(value) {
    if (!value) return ""
    const d = new Date(value)
    if (isNaN(d.getTime())) return ""
    const pad = (n) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  async function refreshDmQueue(showLoading) {
    if (dmLoading && !showLoading) return
    if (showLoading) dmLoading = true
    try {
      const res = await window.ElectronAPI.musicDlDownloadQueueList(1, 100, "")
      if (res && !res.error) {
        dmQueueData = res
        renderDmQueuePane()
      } else if (showLoading) {
        dmQueueData = { tasks: [], total: 0, counts: {} }
        renderDmQueuePane()
      }
    } catch (e) {
      // 静默失败，下轮轮询重试
    } finally {
      dmLoading = false
    }
  }

  async function refreshDmRecords(showLoading) {
    try {
      const res = await window.ElectronAPI.musicDlDownloadRecordsList(
        dmRecordsPage,
        20
      )
      if (res && !res.error) {
        dmRecordsData = res
        if (res.page) dmRecordsPage = res.page
        renderDmRecordsPane()
      } else if (showLoading) {
        dmRecordsData = { records: [], page: 1, total: 0, total_pages: 1 }
        renderDmRecordsPane()
      }
    } catch (e) {}
  }

  async function dmQueueAction(id, action) {
    if (!id || !action) return
    const res = await window.ElectronAPI.musicDlDownloadQueueAction(
      id,
      action
    )
    if (res && res.error) {
      showToastError(`队列操作失败：${res.error}`)
    } else if (action === "cancel") {
      showToast("已取消该下载任务")
    } else if (action === "retry") {
      showToast("已重新加入下载队列")
    }
    refreshDmQueue(true)
  }

  async function dmClearQueue() {
    const res = await window.ElectronAPI.musicDlDownloadQueueClear()
    if (res && res.error) {
      showToastError(`清空队列失败：${res.error}`)
      return
    }
    showToast("已清空下载队列")
    refreshDmQueue(true)
  }

  async function dmClearRecords() {
    const res = await window.ElectronAPI.musicDlDownloadRecordsClear()
    if (res && res.error) {
      showToastError(`清空记录失败：${res.error}`)
      return
    }
    dmRecordsPage = 1
    showToast("已清空下载记录")
    refreshDmRecords(true)
  }

  // 下载预检确认弹窗：告知将跳过多少首已下载过的歌曲，返回用户是否继续
  function confirmPrecheckDialog(total, skipped) {
    return new Promise((resolve) => {
      const layer = document.createElement("div")
      layer.className = "dialog-layer hidden"
      layer.innerHTML =
        '<div class="dialog dialog-sm">' +
        '<div class="dialog-head"><h3 class="dialog-title">下载预检</h3></div>' +
        '<div class="dialog-body"><p class="confirm-msg">检测到 ' +
        skipped +
        " / " +
        total +
        " 首歌曲此前已下载过，这些将被跳过。仍要加入下载队列吗？</p></div>" +
        '<div class="dialog-foot-right">' +
        '<button class="btn btn-ghost" data-c>取消</button>' +
        '<button class="btn btn-primary" data-o>继续下载</button>' +
        "</div></div>"
      document.body.appendChild(layer)
      requestAnimationFrame(() => layer.classList.remove("hidden"))
      let settled = false
      const close = (v) => {
        if (settled) return
        settled = true
        layer.classList.add("hidden")
        setTimeout(() => layer.remove(), 200)
        resolve(v)
      }
      layer.querySelector("[data-c]").addEventListener("click", () => close(false))
      layer.querySelector("[data-o]").addEventListener("click", () => close(true))
      layer.addEventListener("click", (e) => {
        if (e.target === layer) close(false)
      })
    })
  }

  // 把歌曲批量加入 go-music-dl 后台下载队列（去重 + 元数据嵌入，完成后可在「本地和下载」导入）
  async function enqueueSongsToDownloadQueue(songs) {
    const list = (songs || []).filter((s) => s && !isSongLocalPath(s) && (s.songId || s.id) && s.source)
    if (!list.length) {
      showToastError("没有可加入队列的在线歌曲")
      return
    }
    // 下载预检：go 侧统计已有同名歌曲的数量，提前告知用户将跳过多少首
    if (window.ElectronAPI && window.ElectronAPI.musicDlPrecheck) {
      let pre = null
      try {
        pre = await window.ElectronAPI.musicDlPrecheck(
          list.map((s) => ({ name: s.name || "", artist: s.artist || "" }))
        )
      } catch (e) {
        pre = null
      }
      if (pre && pre.available && pre.skipped > 0) {
        const proceed = await confirmPrecheckDialog(pre.total, pre.skipped)
        if (!proceed) return
      }
    }
    const requestId = `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const res = await window.ElectronAPI.musicDlDownloadQueueEnqueue(
      requestId,
      list
    )
    if (!res || res.error) {
      showToastError(`加入下载队列失败：${res && res.error ? res.error : "未知错误"}`)
      return
    }
    const added = res.added || 0
    const existing = res.existing || 0
    showToast(
      `已加入下载队列：新增 ${added} 首${existing ? `，已在队列 ${existing} 首` : ""}（后台下载，可到「下载管理」查看进度）`,
      "success"
    )
    openDownloadManager()
  }

  // 仅同步搜索类型 UI（不触发重新搜索）
  function setSearchTypeUi(type) {
    searchType = type
    const tabSongs = document.getElementById("searchTabSongs")
    const tabPlaylists = document.getElementById("searchTabPlaylists")
    if (tabSongs) tabSongs.classList.toggle("active", type === "song")
    if (tabPlaylists) tabPlaylists.classList.toggle("active", type === "playlist")
    const toolbar = document.getElementById("searchDownloadToolbar")
    if (toolbar) toolbar.style.display = type === "playlist" ? "none" : ""
    if (type === "song" && searchResultList)
      searchResultList.classList.remove("pl-grid")
  }

  // 切换搜索类型 tab；有关键词时自动切换结果
  function setSearchType(type) {
    if (type !== "song" && type !== "playlist") return
    if (searchType === type) return
    setSearchTypeUi(type)
    if (currentKeyword && !isSearching) {
      performSearch(currentKeyword)
    } else if (!currentKeyword) {
      // 无关键词：显示对应空态提示
      if (searchResultList) {
        searchResultList.classList.remove("pl-grid")
        searchResultList.innerHTML =
          '<div class="p-10 text-center text-gray-500 dark:text-gray-400">输入关键词后回车搜索' +
          (type === "playlist" ? "歌单" : "歌曲") +
          "</div>"
      }
      setLoadMoreVisible(false)
    }
  }

  // ========== 音频事件监听 ==========
  function setupAudioListeners() {
    if (audioPlayer) {
      setupPlaybackWatchdog()
      audioPlayer.removeEventListener("timeupdate", updateLyricHighlight)
      audioPlayer.removeEventListener("ended", playNextSong)
      audioPlayer.removeEventListener("loadedmetadata", handleLoadedMetadata)
      audioPlayer.removeEventListener("canplay", handleCanPlay)
      audioPlayer.removeEventListener("canplaythrough", handleCanPlayThrough)
      audioPlayer.removeEventListener("play", handlePlay)
      audioPlayer.removeEventListener("pause", handlePause)
      audioPlayer.removeEventListener("error", handleError)
      audioPlayer.addEventListener("timeupdate", updateLyricHighlight)
      audioPlayer.addEventListener("ended", playNextSong)
      audioPlayer.addEventListener("loadedmetadata", handleLoadedMetadata)
      audioPlayer.addEventListener("canplay", handleCanPlay)
      audioPlayer.addEventListener("canplaythrough", handleCanPlayThrough)
      audioPlayer.addEventListener("play", handlePlay)
      audioPlayer.addEventListener("pause", handlePause)
      audioPlayer.addEventListener("error", handleError)
    }

    // 处理音频元数据加载完成事件
    function handleLoadedMetadata() {
      console.log(
        "[播放器] loadedmetadata事件触发，时长：",
        audioPlayer.duration,
        "readyState:",
        audioPlayer.readyState
      )
      // 元数据加载完成后，音频应该可以播放了
    }

    // 处理音频可以播放事件
    function handleCanPlay() {
      console.log(
        "[播放器] canplay事件触发，readyState:",
        audioPlayer.readyState
      )
    }

    // 处理音频可以连续播放事件
    function handleCanPlayThrough() {
      console.log(
        "[播放器] canplaythrough事件触发，readyState:",
        audioPlayer.readyState
      )
    }

    // 处理播放事件
    function handlePlay() {
      console.log("[播放器] 开始播放")
      emitFeature("play")
    }

    // 处理暂停事件
    function handlePause() {
      console.log("[播放器] 暂停播放")
      emitFeature("pause")
    }

    // 处理错误事件
    function handleError(e) {
      console.error("[播放器] 音频加载错误：", e)
      console.error("[播放器] 错误详情：", audioPlayer.error)
      if (audioPlayer.error) {
        switch (audioPlayer.error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            console.error("[播放器] 音频加载被中止")
            break
          case MediaError.MEDIA_ERR_NETWORK:
            console.error("[播放器] 网络错误导致音频加载失败")
            break
          case MediaError.MEDIA_ERR_DECODE:
            console.error("[播放器] 音频解码失败")
            break
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            console.error("[播放器] 音频格式不支持或URL无效")
            break
          default:
            console.error("[播放器] 未知错误")
        }
      }
    }

    // 播放看护：网络/CDN 抖动或解码器异常导致的意外暂停、缓冲卡死会被自动恢复，
    // 而不是静默停在某一秒。用户主动暂停（userIntentPause）与切歌瞬间不会被干预。
    function setupPlaybackWatchdog() {
      if (watchdogStarted || !audioPlayer) return
      watchdogStarted = true
      const STALL_LIMIT = 8 // 连续 8 秒无进度且缓冲不足判定为卡死
      const MAX_RECOVER = 3 // 单首最多自动恢复 3 次，超限走失败兜底跳下一首
      setInterval(() => {
        if (!audioPlayer) return
        if (currentSongIndex < 0 || userIntentPause) return
        const song = playQueue[currentSongIndex]
        if (!song || !song.url) return
        if (loadingSong) return
        const t = audioPlayer.currentTime

        if (audioPlayer.paused) {
          // 已加载出数据却被暂停：典型的意外暂停
          if (audioPlayer.readyState >= 2 && recoverTries < MAX_RECOVER) {
            recoverTries++
            console.log("[播放看护] 检测到异常暂停，尝试恢复播放（", recoverTries, "）")
            audioPlayer.play().catch(() => {})
          } else if (audioPlayer.readyState < 2) {
            // 曾在播放却被重置为无数据：缓冲/连接中断
            stallTicks++
            if (stallTicks >= STALL_LIMIT) {
              stallTicks = 0
              recoverTries++
              if (recoverTries > MAX_RECOVER) return handlePlaybackFailure()
              loadingSong = true
              showToast("网络缓冲，正在重新缓冲…", "info")
              playCurrentSong({ startTime: Math.max(0, t) })
            }
          } else if (recoverTries >= MAX_RECOVER) {
            handlePlaybackFailure()
          }
          return
        }

        // 未暂停：监测进度是否推进
        if (t === watchdogLastTime) {
          if (audioPlayer.readyState < 3) {
            stallTicks++
            if (stallTicks >= STALL_LIMIT) {
              stallTicks = 0
              recoverTries++
              if (recoverTries > MAX_RECOVER) return handlePlaybackFailure()
              loadingSong = true
              console.log("[播放看护] 缓冲卡死，重新加载当前曲目续播于", t)
              showToast("网络缓冲，正在重新缓冲…", "info")
              playCurrentSong({ startTime: Math.max(0, t) })
            }
          }
        } else {
          watchdogLastTime = t
          stallTicks = 0
          if (audioPlayer.readyState >= 3) recoverTries = 0
        }
      }, 1000)
    }
  }

  // ========== 侧边栏拉伸功能 ==========
  function setupSidebarResize() {
    const sidebar = document.getElementById("sidebar")
    const sidebarResizer = document.getElementById("sidebarResizer")
    let isResizing = false

    if (sidebarResizer) {
      sidebarResizer.addEventListener("mousedown", (e) => {
        isResizing = true
        document.body.style.cursor = "col-resize"
      })
    }

    document.addEventListener("mousemove", (e) => {
      if (!isResizing || !sidebar) return
      const sidebarRect = sidebar.getBoundingClientRect()
      const newWidth = e.clientX - sidebarRect.left
      if (newWidth >= 120 && newWidth <= 300) {
        sidebar.style.width = `${newWidth}px`
      }
    })

    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false
        document.body.style.cursor = ""
      }
    })
  }

  // ========== 绑定所有事件 ==========
  function bindAllEvents() {
    // 用户信息按钮
    bindUserInfoEvents()
    bindUpdateModalEvents()
    bindDeleteConfirmEvents()
    setupKeyboardShortcuts()
    setupModalAutoFocus()

    // 搜索相关
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = ""
        if (searchInput) searchInput.dispatchEvent(new Event("input"))
        if (searchHistoryContainer)
          searchHistoryContainer.classList.add("hidden")
      })
    }

    if (searchInput) {
      searchInput.addEventListener("click", (e) => {
        // 关闭搜索源选择菜单
        const sourceMenu = document.getElementById("searchSourceMenu")
        if (sourceMenu) {
          sourceMenu.classList.add("hidden")
        }

        if (searchHistory.length > 0) {
          renderSearchHistory()
          if (searchHistoryContainer)
            searchHistoryContainer.classList.remove("hidden")
          // 阻止事件冒泡，防止搜索历史记录被关闭
          e.stopPropagation()
        }
      })
    }

    // 清除缓存并搜索按钮
    const refreshSearchBtn = document.getElementById("refreshSearchBtn")
    if (refreshSearchBtn) {
      refreshSearchBtn.addEventListener("click", async () => {
        // 忽略本地搜索缓存，强制重新拉取一次结果
        searchCache.clear()
        const keyword = searchInput ? searchInput.value.trim() : ""
        if (!keyword) {
          showToast("请先输入要搜索的内容", "info")
          return
        }
        searchOffset = 0
        if (searchResultList) searchResultList.innerHTML = ""
        if (searchResultsSection) searchResultsSection.classList.remove("hidden")
        if (playlistDetailSection) playlistDetailSection.classList.add("hidden")
        if (searchResultList)
          searchResultList.innerHTML =
            '<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索中...</p></div>'
        await loadSearchResults(keyword, searchOffset)
        if (searchResultsSection) {
          searchResultsSection.classList.remove("fade-in")
          void searchResultsSection.offsetWidth
          searchResultsSection.classList.add("fade-in")
        }
        showToast("已刷新搜索结果", "info")
      })
    }

    document.addEventListener("click", () => {
      if (searchHistoryContainer) searchHistoryContainer.classList.add("hidden")
    })

    if (searchHistoryContainer) {
      searchHistoryContainer.addEventListener("click", (e) => {
        e.stopPropagation()
      })
    }

    // 默认选中顺序播放
    setActiveModeBtn(orderBtn)

    // 从网页导入歌单（网易云 / QQ音乐）
    if (importWebPlaylistBtn && webPlaylistImportModal) {
      importWebPlaylistBtn.addEventListener("click", () => {
        if (webPlaylistUrlInput) webPlaylistUrlInput.value = ""
        if (webPlaylistPlatformSelect) webPlaylistPlatformSelect.value = "auto"
        webPlaylistImportModal.classList.remove("hidden")
        if (webPlaylistUrlInput) webPlaylistUrlInput.focus()
      })
    }
    if (cancelWebPlaylistImportBtn && webPlaylistImportModal) {
      cancelWebPlaylistImportBtn.addEventListener("click", () => {
        webPlaylistImportModal.classList.add("hidden")
      })
    }
    if (confirmWebPlaylistImportBtn && webPlaylistImportModal) {
      confirmWebPlaylistImportBtn.addEventListener("click", async () => {
        const raw = webPlaylistUrlInput ? webPlaylistUrlInput.value.trim() : ""
        if (!raw) {
          showToastWarning("请粘贴歌单链接或 ID")
          return
        }
        const platform = webPlaylistPlatformSelect
          ? webPlaylistPlatformSelect.value
          : "auto"
        const btn = confirmWebPlaylistImportBtn
        const prevText = btn.textContent
        btn.disabled = true
        btn.textContent = "导入中…"
        try {
          const result = await window.ElectronAPI.fetchWebPlaylist(raw, platform)
          if (!result.success) {
            showToastError(result.error || "导入失败")
            return
          }
          const playlistId = `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          const srcLabel = result.platformLabel || "网页歌单"
          const newPlaylist = {
            id: playlistId,
            name: result.name || `${srcLabel}歌单`,
            description: `来源：${srcLabel}，歌单 ID ${result.playlistId}`,
            coverPath: "",
            songs: result.songs || [],
            createdAt: new Date().toISOString(),
          }
          diyPlaylists.push(newPlaylist)
          const saveResult = await window.ElectronAPI.saveDIYPlaylists(
            diyPlaylists
          )
          if (!saveResult) {
            diyPlaylists.pop()
            showToastError("保存失败，请检查日志")
            return
          }
          renderPlaylistSidebar()
          webPlaylistImportModal.classList.add("hidden")
          showPlaylistDetail(newPlaylist)
          showToast(`已导入 ${newPlaylist.songs.length} 首歌曲`)
        } catch (err) {
          console.error("导入网页歌单失败:", err)
          showToastError("导入失败，请稍后重试")
        } finally {
          btn.disabled = false
          btn.textContent = prevText
        }
      })
    }

    // 创建歌单
    if (createPlaylistBtn) {
      createPlaylistBtn.addEventListener("click", () => {
        if (playlistName) playlistName.value = ""
        if (playlistDescription) playlistDescription.value = ""
        if (coverPreview)
          coverPreview.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`
        currentCover = null
        currentEditingPlaylistId = null
        const modalTitle = document.querySelector("#playlistEditModal h2")
        if (modalTitle) modalTitle.textContent = "创建歌单"
        const submitBtn = document.getElementById("savePlaylistBtn")
        if (submitBtn) submitBtn.textContent = "创建"
        if (playlistEditModal) playlistEditModal.classList.remove("hidden")
      })
    }

    // 导入歌单
    const importPlaylistBtnModal = document.getElementById(
      "importPlaylistBtnModal"
    )
    if (importPlaylistBtnModal) {
      importPlaylistBtnModal.addEventListener("click", async () => {
        const result = await window.ElectronAPI.importPlaylist()
        if (result.success) {
          diyPlaylists = result.playlists
          renderPlaylistSidebar()
          if (playlistEditModal) playlistEditModal.classList.add("hidden")
          showToast("歌单导入成功")
        } else {
          showToastError(`导入失败：${result.error}`)
        }
      })
    }

    // 封面上传
    if (coverUpload) {
      coverUpload.addEventListener("change", (e) => {
        const file = e.target.files[0]
        if (file) {
          const reader = new FileReader()
          reader.onload = (event) => {
            if (coverPreview)
              coverPreview.innerHTML = `<img src="${event.target.result}" class="w-full h-full object-cover rounded-md">`
            currentCover = event.target.result
          }
          reader.readAsDataURL(file)
        }
      })
    }

    // 取消按钮
    if (cancelPlaylistBtn) {
      cancelPlaylistBtn.addEventListener("click", () => {
        if (playlistEditModal) playlistEditModal.classList.add("hidden")
        currentEditingPlaylistId = null
      })
    }

    // 主“创建/保存”按钮在 form 外，点击时提交表单（触发校验与 submit 逻辑）
    if (savePlaylistBtn && playlistEditForm) {
      savePlaylistBtn.addEventListener("click", () => playlistEditForm.requestSubmit())
    }

    // 提交表单
    if (playlistEditForm) {
      playlistEditForm.addEventListener("submit", async (e) => {
        e.preventDefault()
        const name = playlistName ? playlistName.value.trim() : ""
        const description = playlistDescription
          ? playlistDescription.value.trim()
          : ""

        if (!name) {
          showToast("请输入歌单名称")
          return
        }

        if (currentEditingPlaylistId) {
          const targetIndex = diyPlaylists.findIndex(
            (p) => p.id === currentEditingPlaylistId
          )
          if (targetIndex === -1) {
            showToastError("歌单不存在")
            return
          }
          const targetPlaylist = diyPlaylists[targetIndex]
          let coverPath = targetPlaylist.coverPath

          if (currentCover && currentCover !== targetPlaylist.coverPath) {
            const result = await window.ElectronAPI.savePlaylistCover({
              playlistId: targetPlaylist.id,
              coverData: currentCover,
            })
            if (result.success) {
              coverPath = result.coverPath
            } else {
              showToastError("封面保存失败")
            }
          }

          targetPlaylist.name = name
          targetPlaylist.description = description
          if (coverPath) targetPlaylist.coverPath = coverPath

          try {
            const saveResult =
              await window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
            if (!saveResult) {
              showToastError("保存失败，请检查日志")
              return
            }
            renderPlaylistSidebar()
            if (currentPlaylist && currentPlaylist.id === targetPlaylist.id) {
              showPlaylistDetail(targetPlaylist)
            }
            showToast(`已修改歌单：${name}`)
            if (playlistEditModal) playlistEditModal.classList.add("hidden")
            currentEditingPlaylistId = null
          } catch (err) {
            console.error("保存自建歌单失败:", err)
            showToastError("歌单修改失败")
          }
        } else {
          const playlistId = Date.now().toString()
          let coverPath = ""

          if (currentCover) {
            const result = await window.ElectronAPI.savePlaylistCover({
              playlistId,
              coverData: currentCover,
            })
            if (result.success) {
              coverPath = result.coverPath
            } else {
              showToastError("封面保存失败")
            }
          }

          const newPlaylist = {
            id: playlistId,
            name: name,
            description: description,
            coverPath: coverPath,
            songs: [],
            createdAt: new Date().toISOString(),
          }

          diyPlaylists.push(newPlaylist)
          try {
            const saveResult =
              await window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
            if (!saveResult) {
              showToastError("保存失败，请检查日志")
              return
            }
            renderPlaylistSidebar()
            showToast(`已创建歌单：${name}`)
            if (playlistEditModal) playlistEditModal.classList.add("hidden")
          } catch (err) {
            console.error("保存自建歌单失败:", err)
            showToastError("歌单创建失败")
          }
        }
      })
    }

    // 功能按钮
    if (likeSongsBtn) likeSongsBtn.addEventListener("click", showLikedSongs)
    if (recentPlayBtn) recentPlayBtn.addEventListener("click", showRecentSongs)

    const localSongsBtn = document.getElementById("localSongsBtn")
    if (localSongsBtn) localSongsBtn.addEventListener("click", showLocalSongs)

    const followedSongsBtn = document.getElementById("followedSongsBtn")
    if (followedSongsBtn)
      followedSongsBtn.addEventListener("click", showFollowedArtists)

    // 导入本地歌曲
    const importLocalBtn = document.getElementById("importLocalBtn")
    if (importLocalBtn) {
      importLocalBtn.addEventListener("click", async () => {
        const filePaths = await window.ElectronAPI.openFileDialog()
        if (filePaths && filePaths.length > 0) {
          const result = await window.ElectronAPI.importLocalSongs(filePaths)
          if (result.success) {
            localSongs = await window.ElectronAPI.readLocalSongs()
            const localCountEl = document.getElementById("localCount")
            if (localCountEl) localCountEl.textContent = localSongs.length
            showLocalSongs()
            showToast(`成功导入 ${result.songs.length} 首本地歌曲`)
          } else {
            showToastError(`导入失败：${result.error}`)
          }
        }
      })
    }

    // 播放控制
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        if (playQueue.length === 0) return

        switch (playMode) {
          case "order":
          case "listLoop":
            currentSongIndex =
              (currentSongIndex - 1 + playQueue.length) % playQueue.length
            break
          case "reverse":
            currentSongIndex = (currentSongIndex + 1) % playQueue.length
            break
          case "shuffle":
            currentSongIndex = Math.floor(Math.random() * playQueue.length)
            break
          case "singleLoop":
            if (audioPlayer) {
              audioPlayer.currentTime = 0
              audioPlayer.play()
            }
            return
        }
        playCurrentSong()
      })
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        playNextSong()
      })
    }

    // 播放模式
    modeBtns.forEach((btn) => {
      if (btn) {
        btn.addEventListener("click", () => {
          playMode = btn.dataset.mode
          setActiveModeBtn(btn)
          if (audioPlayer) audioPlayer.loop = playMode === "singleLoop"
        })
      }
    })

    // 底栏单个模式按钮：在各模式间循环切换
    if (modeCycleBtn) {
      modeCycleBtn.addEventListener("click", () => {
        const idx = MODE_CYCLE.indexOf(playMode)
        const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]
        const target = modeBtns.find((b) => b && b.dataset.mode === next)
        if (target) target.click()
        showToast(MODE_LABELS[next], "info")
      })
    }

    // 歌词界面
    if (coverImg) {
      coverImg.addEventListener("click", () => {
        if (currentSongIndex >= 0) {
          if (lyricsInterface && lyricsInterface.classList.contains("hidden")) {
            const song = playQueue[currentSongIndex]
            if (lyricsCoverImg) {
              lyricsCoverImg.src = song.coverUrl || "../../assets/icon.ico"
            }
            if (lyricsSongTitle) lyricsSongTitle.textContent = song.name
            if (lyricsSongArtist) lyricsSongArtist.textContent = song.artist
            lyricsInterface.classList.remove("hidden")
          } else {
            if (lyricsInterface) lyricsInterface.classList.add("hidden")
          }
        }
      })
    }

    if (closeLyricsBtn) {
      closeLyricsBtn.addEventListener("click", () => {
        if (lyricsInterface) lyricsInterface.classList.add("hidden")
      })
    }

    // 播放列表浮窗
    const isQueueOpen = () =>
      playlistFloat && playlistFloat.classList.contains("open")
    const closeQueue = () => {
      if (playlistFloat) playlistFloat.classList.remove("open")
    }
    if (togglePlaylistBtn) {
      togglePlaylistBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        if (playlistFloat) playlistFloat.classList.toggle("open")
      })
    }

    if (closePlaylistBtn) {
      closePlaylistBtn.addEventListener("click", () => {
        closeQueue()
      })
    }

    if (playlistFloat) {
      // 点击抽屉内部不触发外部关闭
      playlistFloat.addEventListener("click", (e) => e.stopPropagation())
      // 点击抽屉外部任意位置即关闭（light-dismiss）
      document.addEventListener("click", () => {
        if (isQueueOpen()) closeQueue()
      })
    }

    // 导航历史：返回上一页 / 前进下一页
    if (navBackBtn) {
      navBackBtn.addEventListener("click", navGoBack)
    }
    if (navForwardBtn) {
      navForwardBtn.addEventListener("click", navGoForward)
    }

    // 隐藏 / 显示播放器（np-bar）
    const hidePlayerBtn = document.getElementById("hidePlayerBtn")
    if (hidePlayerBtn)
      hidePlayerBtn.addEventListener("click", () => applyPlayerHidden(true))
    const showPlayerBtnEl = document.getElementById("showPlayerBtn")
    if (showPlayerBtnEl)
      showPlayerBtnEl.addEventListener("click", () => applyPlayerHidden(false))

    // 搜索
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        if (searchInput.value.trim() !== "") {
          if (clearSearchBtn) clearSearchBtn.classList.remove("hidden")
        } else {
          if (clearSearchBtn) clearSearchBtn.classList.add("hidden")
          if (searchResultList) searchResultList.innerHTML = ""
          setLoadMoreVisible(false)
        }
      })
    }

    if (searchBtn) {
      searchBtn.addEventListener("click", () => {
        const keyword = searchInput ? searchInput.value.trim() : ""
        performSearch(keyword)
      })
    }

    // 搜索类型 tab：单曲 / 歌单
    const searchTabSongsEl = document.getElementById("searchTabSongs")
    const searchTabPlaylistsEl = document.getElementById("searchTabPlaylists")
    if (searchTabSongsEl)
      searchTabSongsEl.addEventListener("click", () => setSearchType("song"))
    if (searchTabPlaylistsEl)
      searchTabPlaylistsEl.addEventListener("click", () => setSearchType("playlist"))

    if (searchInput) {
      searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          const keyword = searchInput.value.trim()
          performSearch(keyword)
        }
      })
    }

    if (loadMoreBtn) {
      let isLoadingMore = false
      loadMoreBtn.addEventListener("click", async () => {
        if (isLoadingMore) return
        const keyword = searchInput ? searchInput.value.trim() : ""
        if (!keyword) return
        isLoadingMore = true
        loadMoreBtn.disabled = true
        try {
          searchOffset += PAGE_SIZE
          await loadSearchResults(keyword, searchOffset)
          // 加载更多后刷新导航快照（同名条目原地更新回放闭包）
          recordSearchNav(keyword)
        } finally {
          isLoadingMore = false
          loadMoreBtn.disabled = false
        }
      })
    }

    bindDownloadModalEvents()

    document.addEventListener("mouseup", () => {
      listDragState = null
    })

    setupListDragMultiSelect(searchResultList, "search")
    setupListDragMultiSelect(playlistDetailList, "playlist-detail")
    setupListDragMultiSelect(playlistList, "playlist")

    document.querySelectorAll(".download-quality-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        setDownloadQualityStorage(sel.value)
        syncDownloadQualitySelects()
      })
    })

    const searchSelectAllCheckbox = document.getElementById(
      "searchSelectAllCheckbox"
    )
    if (searchSelectAllCheckbox) {
      searchSelectAllCheckbox.addEventListener("change", () => {
        const on = searchSelectAllCheckbox.checked
        searchResults.forEach((s) => {
          if (s.id && !isSongLocalPath(s)) {
            if (on) selectedSearchIds.add(s.id)
            else selectedSearchIds.delete(s.id)
          }
        })
        if (searchResultList) {
          searchResultList.querySelectorAll(".download-song-cb").forEach((box) => {
            box.checked = on
          })
        }
        syncSearchSelectAllCheckbox()
      })
    }

    const downloadSearchToolbarBtn = document.getElementById(
      "downloadSearchToolbarBtn"
    )
    if (downloadSearchToolbarBtn) {
      downloadSearchToolbarBtn.addEventListener("click", () => {
        openDownloadModal(getSearchDownloadSongs())
      })
    }

    const queueDownloadSearchToolbarBtn = document.getElementById(
      "queueDownloadSearchToolbarBtn"
    )
    if (queueDownloadSearchToolbarBtn) {
      queueDownloadSearchToolbarBtn.addEventListener("click", () => {
        enqueueSongsToDownloadQueue(getSearchDownloadSongs())
      })
    }

    const downloadManagerBtn = document.getElementById("downloadManagerBtn")
    if (downloadManagerBtn) {
      downloadManagerBtn.addEventListener("click", openDownloadManager)
    }

    const playlistDetailSelectAllCheckbox = document.getElementById(
      "playlistDetailSelectAllCheckbox"
    )
    if (playlistDetailSelectAllCheckbox) {
      playlistDetailSelectAllCheckbox.addEventListener("change", () => {
        wirePlaylistDetailSelectAll(playlistDetailSelectAllCheckbox.checked)
      })
    }

    const playlistDetailSelectAllCheckboxStandalone = document.getElementById(
      "playlistDetailSelectAllCheckboxStandalone"
    )
    if (playlistDetailSelectAllCheckboxStandalone) {
      playlistDetailSelectAllCheckboxStandalone.addEventListener(
        "change",
        () => {
          wirePlaylistDetailSelectAll(
            playlistDetailSelectAllCheckboxStandalone.checked
          )
        }
      )
    }

    const downloadPlaylistDetailBtn = document.getElementById(
      "downloadPlaylistDetailBtn"
    )
    if (downloadPlaylistDetailBtn) {
      downloadPlaylistDetailBtn.addEventListener("click", () => {
        openDownloadModal(getPlaylistDetailDownloadSongs())
      })
    }

    const queueDownloadPlaylistDetailBtn = document.getElementById(
      "queueDownloadPlaylistDetailBtn"
    )
    if (queueDownloadPlaylistDetailBtn) {
      queueDownloadPlaylistDetailBtn.addEventListener("click", () => {
        enqueueSongsToDownloadQueue(getPlaylistDetailDownloadSongs())
      })
    }

    const downloadPlaylistDetailBtnStandalone = document.getElementById(
      "downloadPlaylistDetailBtnStandalone"
    )
    if (downloadPlaylistDetailBtnStandalone) {
      downloadPlaylistDetailBtnStandalone.addEventListener("click", () => {
        openDownloadModal(getPlaylistDetailDownloadSongs())
      })
    }

    const playlistQueueSelectAllCheckbox = document.getElementById(
      "playlistQueueSelectAllCheckbox"
    )
    if (playlistQueueSelectAllCheckbox) {
      playlistQueueSelectAllCheckbox.addEventListener("change", () => {
        const on = playlistQueueSelectAllCheckbox.checked
        playQueue.forEach((s) => {
          if (s.id && !isSongLocalPath(s)) {
            if (on) selectedQueueIds.add(s.id)
            else selectedQueueIds.delete(s.id)
          }
        })
        if (playlistList) {
          playlistList.querySelectorAll(".download-song-cb").forEach((box) => {
            box.checked = on
          })
        }
        syncPlaylistQueueSelectAllCheckbox()
      })
    }

    const downloadPlayQueueBtn = document.getElementById("downloadPlayQueueBtn")
    if (downloadPlayQueueBtn) {
      downloadPlayQueueBtn.addEventListener("click", () => {
        openDownloadModal(getPlayQueueDownloadSongs())
      })
    }

    // 事件委托
    if (playlistList)
      playlistList.addEventListener("click", handlePlaylistClick)
    if (searchResultList)
      searchResultList.addEventListener("click", handleSearchResultClick)
    if (playlistDetailList)
      playlistDetailList.addEventListener("click", handlePlaylistDetailClick)
    initDetailViewToggle()
  }

  // ========== 初始化数据读取 ==========
  function updateBrandGreeting() {
    const el = document.getElementById("brandGreeting")
    if (!el) return
    const h = new Date().getHours()
    // 侧边栏用户卡片列宽有限，问候语过长会溢出遮挡右侧按钮，保持 3-5 字
    let g = "享受音乐"
    if (h >= 5 && h < 11) g = "早上好"
    else if (h >= 11 && h < 14) g = "中午好"
    else if (h >= 14 && h < 18) g = "下午好"
    else if (h >= 18 && h < 23) g = "晚上好"
    else g = "夜深了"
    el.textContent = g
  }

  async function initApp() {
    initDOMElements()
    bindAllEvents()
    setupCoverFallback()
    setupDownloadProgressListener()
    setupAudioListeners()
    setupSidebarResize()
    updateBrandGreeting()

    // 并行读取全部持久化数据：单项失败不影响其他项
    const results = await Promise.allSettled([
      window.ElectronAPI.readPlaylist(),
      window.ElectronAPI.readLikedSongs(),
      window.ElectronAPI.readFollowedArtists(),
      window.ElectronAPI.readCustomPlaylists(),
      window.ElectronAPI.readLatestPlayed(),
      window.ElectronAPI.readDIYPlaylists(),
      window.ElectronAPI.readSearchHistory(),
      window.ElectronAPI.readLocalSongs(),
    ])
    const val = (i, fallback, label) => {
      if (results[i].status === "fulfilled") return results[i].value || fallback
      console.error(`${label}失败:`, results[i].reason)
      return fallback
    }

    playQueue = val(0, [], "读取播放列表") || []
    likedSongs = val(1, [], "读取我喜欢的歌曲") || []
    followedArtists = val(2, [], "读取关注歌手列表") || []
    customPlaylists = val(3, [], "读取自定义歌单") || []
    latestPlayed = val(4, [], "读取最近播放") || []
    diyPlaylists = val(5, [], "读取自建歌单") || []
    searchHistory = val(6, [], "读取搜索历史") || []
    localSongs = val(7, [], "读取本地歌曲") || []

    if (playQueue.length > 0) {
      renderPlaylist()
      // 启动时的首次渲染并未修改队列，取消随之而来的无意义写盘
      if (queueSaveTimer) {
        clearTimeout(queueSaveTimer)
        queueSaveTimer = null
      }
    }
    if (likeCount) likeCount.textContent = likedSongs.length
    const followCountEl = document.getElementById("followCount")
    if (followCountEl) followCountEl.textContent = followedArtists.length
    if (recentCount) recentCount.textContent = latestPlayed.length
    const localCountEl = document.getElementById("localCount")
    if (localCountEl) localCountEl.textContent = localSongs.length
    renderPlaylistSidebar()

    async function checkUpdateOnStartup() {
      try {
        const result = await window.ElectronAPI.checkForUpdates()
        if (result && result.success && result.hasUpdate) {
          showUpdateBadge()
        }
      } catch (err) {
        console.error("启动时检查更新失败:", err)
      }
    }

    checkUpdateOnStartup()

    if (searchInput && searchInput.value.trim() !== "") {
      if (clearSearchBtn) clearSearchBtn.classList.remove("hidden")
    }

    syncDownloadQualitySelects()
    // 恢复播放器隐藏状态；首页作为导航历史的起点
    let npHidden = false
    try {
      npHidden = localStorage.getItem("mp-np-hidden") === "1"
    } catch (e) {}
    applyPlayerHidden(npHidden)
    navRecord("首页", navShowHome)
    emitFeature("app-ready")
  }

  // ========== 对外功能桥接（供 features.js 使用）==========
  const MODE_BTN_IDS = {
    order: "orderBtn",
    reverse: "reverseBtn",
    singleLoop: "singleLoopBtn",
    listLoop: "listLoopBtn",
    shuffle: "shuffleBtn",
  }
  window.MusicPlayer = {
    on(evt, cb) {
      ;(featureEventListeners[evt] =
        featureEventListeners[evt] || []).push(cb)
      return () => {
        featureEventListeners[evt] = (featureEventListeners[evt] || []).filter(
          (f) => f !== cb
        )
      }
    },
    getAudio: () => audioPlayer,
    getCurrentSong: () =>
      currentSongIndex >= 0 && playQueue[currentSongIndex]
        ? playQueue[currentSongIndex]
        : null,
    getCurrentIndex: () => currentSongIndex,
    getQueue: () => playQueue.slice(),
    getMode: () => playMode,
    isPlaying: () =>
      !!(audioPlayer && currentSongIndex >= 0 && !audioPlayer.paused),
    getLyrics: () => ({ lines: currentLyrics, activeIndex: lastActiveIndex }),
    getLyricOffset: () => lyricOffset,
    adjustLyricOffset: (d) => adjustLyricOffset(d),
    toggle: () => togglePlayback(),
    play: () => {
      if (audioPlayer && currentSongIndex >= 0) {
        userIntentPause = false
        recoverTries = 0
        stallTicks = 0
        watchdogLastTime = -1
        audioPlayer.play().catch(() => {})
      }
    },
    pause: () => {
      userIntentPause = true
      if (audioPlayer) audioPlayer.pause()
    },
    next: () => playNextSong(),
    prev: () => {
      if (prevBtn) prevBtn.click()
    },
    playAt: (i, opts) => {
      if (i >= 0 && i < playQueue.length) {
        currentSongIndex = i
        return playCurrentSong(opts)
      }
      return Promise.resolve()
    },
    playSongNext: (s) => playSongNext(s),
    removeAt: (i) => {
      if (i >= 0 && i < playQueue.length) removeFromPlaylist(i)
    },
    appendRaw: (s) => {
      if (s && s.id) {
        playQueue.push(s)
        renderPlaylist()
      }
    },
    clearQueue: () => clearQueue(),
    openSmartPlaylist: (id, name, songs) =>
      showPlaylistDetail({ id, name, songs, description: "根据你的收听习惯自动生成" }),
    // 通用歌单详情入口（排行榜/在线歌单等）
    openPlaylist: (id, name, songs, description) =>
      showPlaylistDetail({ id, name, songs, description: description || "" }),
    // 页面导航历史（后退/前进）
    navRecord: (title, replay) => navRecord(title, replay),
    navGoBack: () => navGoBack(),
    navGoForward: () => navGoForward(),
    navShowHome: () => navShowHome(),
    // 歌单整卡操作
    playPlaylist: (p) => playPlaylist(p),
    showOnlinePlaylistMenu: (e, opts) => showOnlinePlaylistMenu(e, opts),
    // 将 go-music-dl 返回的歌曲归一化为播放器内部结构
    enrichDlSong: (s) => enrichMusicDlSearchSong(s),
    // 歌手页（多源热门歌曲 + 专辑浏览）
    showArtist: (name) => showArtistDetail(name),
    reorder: (from, to) => reorderQueue(from, to),
    seek: (t) => {
      if (audioPlayer && isFinite(t)) audioPlayer.currentTime = t
    },
    setMode: (m) => {
      const id = MODE_BTN_IDS[m]
      const btn = id && document.getElementById(id)
      if (btn) btn.click()
    },
    toast: (m, t) => showToast(m, t || "success"),
  }

  // 启动应用
  window.addEventListener("DOMContentLoaded", initApp)

  window.addEventListener("beforeunload", () => {
    if (playlistList)
      playlistList.removeEventListener("click", handlePlaylistClick)
    if (searchResultList)
      searchResultList.removeEventListener("click", handleSearchResultClick)
    if (playlistDetailList)
      playlistDetailList.removeEventListener("click", handlePlaylistDetailClick)
    if (likedSaveTimer) clearTimeout(likedSaveTimer)
    if (recentSaveTimer) clearTimeout(recentSaveTimer)
    // 关闭前把防抖窗口内未落盘的队列立即保存
    flushQueueSave()
    if (animationFrameId) cancelAnimationFrame(animationFrameId)
    if (lyricUpdateFallbackTimer) clearTimeout(lyricUpdateFallbackTimer)
    if (audioPlayer) {
      audioPlayer.removeEventListener("timeupdate", updateLyricHighlight)
      audioPlayer.removeEventListener("ended", playNextSong)
    }
  })
})()
