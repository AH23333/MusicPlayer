// ========== 渲染进程入口文件 ==========

;(function () {
  "use strict"

  // ========== 性能优化辅助函数 ==========
  function debounce(fn, delay) {
    let timer
    const debounced = function (...args) {
      console.log("[防抖] 调用，延迟", delay, "ms")
      clearTimeout(timer)
      timer = setTimeout(() => {
        console.log("[防抖] 执行目标函数")
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
  let playMode = "order"
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
  let lastActiveIndex = -1
  let animationFrameId = null
  const MAX_SEARCH_HISTORY = 50
  const PAGE_SIZE = 20
  const MAX_LATEST_PLAYED = 50
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

  function escapeHtml(str) {
    if (!str) return ""
    return str.replace(/[&<>]/g, function (m) {
      if (m === "&") return "&amp;"
      if (m === "<") return "&lt;"
      if (m === ">") return "&gt;"
      return m
    })
  }

  function isSongLocalPath(song) {
    if (!song || song.local) return true
    const u = song.url || ""
    return /^[a-zA-Z]:\\/.test(u) || u.startsWith("file:")
  }

  /** 与主进程 utils.metingServerFromSource 一致，供搜索 go-music-dl 结果补全 Meting 播放/下载地址 */
  const METING_AUDIO_API_BASE = "https://api.qijieya.cn/meting/"
  function metingServerFromSourceForSearch(src) {
    const s = String(src ?? "netease").toLowerCase().trim()
    if (s === "qq" || s === "tencent" || s === "tx") return "tencent"
    if (s === "kugou" || s === "kg") return "kugou"
    if (s === "kuwo" || s === "kw") return "kuwo"
    if (s === "migu" || s === "mg") return "migu"
    if (s === "bilibili" || s === "bili") return "bilibili"
    return "netease"
  }
  function enrichMusicDlSearchSong(song) {
    if (!song) return null
    const rawId = song.id ?? song.songId ?? song.hash
    if (rawId == null || rawId === "") return null
    const id = String(rawId)
    const source = metingServerFromSourceForSearch(
      song.source || song.from || "netease"
    )
    let url = (song.url || song.playUrl || song.play_url || "").trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      url = `${METING_AUDIO_API_BASE}?server=${source}&type=url&id=${encodeURIComponent(id)}`
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
      source,
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
    playlistDetailList
  let backToSearchBtn
  let lyricsArea,
    lyricsInterface,
    closeLyricsBtn,
    lyricsCoverImg,
    lyricsSongTitle,
    lyricsSongArtist
  let audioPlayer, coverImg, songTitle, songArtist, prevBtn, nextBtn
  let orderBtn, reverseBtn, singleLoopBtn, listLoopBtn, shuffleBtn, modeBtns
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
    backToSearchBtn = document.getElementById("backToSearchBtn")
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

  function showUpdateModal(info) {
    const modal = document.getElementById("updateModal")
    const title = document.getElementById("updateModalTitle")
    const text = document.getElementById("updateModalText")
    const downloadBtn = document.getElementById("updateDownloadBtn")
    const gitHubBtn = document.getElementById("updateGitHubBtn")
    const laterBtn = document.getElementById("updateLaterBtn")

    currentUpdateInfo = info

    if (info.hasUpdate) {
      title.textContent = "发现新版本"
      text.innerHTML = `当前版本：${info.currentVersion || "1.0.0"}<br>最新版本：${info.latestVersion || "未知"}<br><br>请手动下载更新覆盖安装，注意备份用户数据！`
      downloadBtn.textContent = "前往下载"
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
  }

  function bindUpdateModalEvents() {
    document
      .getElementById("updateDownloadBtn")
      .addEventListener("click", async () => {
        if (currentUpdateInfo && currentUpdateInfo.downloadUrl) {
          await window.ElectronAPI.openDownloadPage(
            currentUpdateInfo.downloadUrl
          )
          showToast("请下载最新版本覆盖安装，记得备份用户数据！")
        } else {
          await window.ElectronAPI.openDownloadPage()
        }
        hideUpdateModal()
      })

    document.getElementById("updateLaterBtn").addEventListener("click", () => {
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
              ? `<input type="checkbox" class="download-song-cb selection-sq-checkbox mt-1 h-4 w-4 flex-shrink-0" data-song-id="${song.id}" ${selectedQueueIds.has(song.id) ? "checked" : ""} />`
              : `<span class="w-4 flex-shrink-0"></span>`
          }
          <div class="flex-1 min-w-0">
            <div class="font-medium dark:text-white truncate">${escapeHtml(song.name)}</div>
            <div class="text-xs text-gray-400 dark:text-gray-500 truncate">${escapeHtml(song.artist)}</div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button class="like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"} hover:text-red-500 transition-colors" data-song-id="${song.id}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="${isLiked ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
            <button class="add-to-playlist" data-song-id="${song.id}">+</button>
            <button class="more-btn" data-song-id="${song.id}">
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
    window.ElectronAPI.savePlaylist(playQueue)
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
        ${hasCover ? `<img src="./DIYSongListPage/${playlist.coverPath}" class="w-8 h-8 rounded object-cover" />` : hasSongCover ? `<img src="${playlist.songs[0].coverUrl}" class="w-8 h-8 rounded object-cover" />` : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>`}
        <span class="flex-1">${playlist.name}</span>
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
    const submitBtn = document.querySelector(
      '#playlistEditForm button[type="submit"]'
    )
    if (submitBtn) submitBtn.textContent = "保存"
    if (playlistEditModal) playlistEditModal.classList.remove("hidden")
  }

  function setActiveModeBtn(btn) {
    modeBtns.forEach((b) => b.classList.remove("active"))
    btn.classList.add("active")
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
          if (backToSearchBtn) backToSearchBtn.classList.add("hidden")
          if (searchResultList)
            searchResultList.innerHTML =
              '<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索中...</p></div>'
          await loadSearchResults(keyword, searchOffset)
          await updateSearchHistory(keyword)
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
    const loadMoreBtnEl = document.getElementById("loadMoreBtn")
    if (loadMoreBtnEl) loadMoreBtnEl.style.display = "none"
    if (backToSearchBtn) backToSearchBtn.classList.remove("hidden")

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
                <h3 class="font-medium dark:text-white">${artistName}</h3>
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
          if (backToSearchBtn) backToSearchBtn.classList.add("hidden")
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
          // 执行搜索
          await loadSearchResults(artistName, 0)
          // 更新搜索历史
          await updateSearchHistory(artistName)
          // 初始化搜索状态
          initSearchState()
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

    lines.forEach((line) => {
      const matches = [...line.matchAll(timeRegex)]
      if (matches.length > 0) {
        const text = line.replace(timeRegex, "").trim()
        if (text) {
          matches.forEach((match) => {
            const minutes = parseInt(match[1])
            const seconds = parseInt(match[2])
            const milliseconds = match[3]
              ? parseInt(match[3].padEnd(3, "0"))
              : 0
            const time = minutes * 60 + seconds + milliseconds / 1000
            lyrics.push({ time, text })
          })
        }
      }
    })

    return lyrics
      .sort((a, b) => a.time - b.time)
      .filter((lyric, index, array) => {
        return index === 0 || lyric.time !== array[index - 1].time
      })
  }

  function renderLyrics(lyrics, songId) {
    if (lyricsCache.has(songId)) {
      currentLyrics = lyricsCache.get(songId)
    } else {
      currentLyrics = parseLyrics(lyrics)
      lyricsCache.set(songId, currentLyrics)
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

  function updateLyricHighlight() {
    if (animationFrameId) return
    animationFrameId = requestAnimationFrame(() => {
      animationFrameId = null
      if (!lyricsArea || !audioPlayer || currentLyrics.length === 0) return
      const currentTime = audioPlayer.currentTime
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
        lastActiveIndex = activeIndex
      }
    })
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

  async function loadLyricsWithStatus(song) {
    if (lyricsArea) {
      lyricsArea.innerHTML =
        '<div class="lyrics-loading">🎵 歌词加载中...</div>'
    }
    try {
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
    if (backToSearchBtn) backToSearchBtn.classList.remove("hidden")

    if (
      playlist.id === "liked" ||
      playlist.id === "recent" ||
      playlist.id === "local" ||
      playlist.id === "followed"
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
      playlist.id !== "followed"
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
      playlist.id === "followed"
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

    renderPlaylistDetail(playlist)
    updatePlaylistDetailDownloadActionsVisibility()
    syncDownloadQualitySelects()
    if (searchResultsSection) searchResultsSection.classList.add("hidden")
    if (playlistDetailSection) playlistDetailSection.classList.remove("hidden")
    if (playlistDetailSection) {
      playlistDetailSection.classList.remove("fade-in")
      void playlistDetailSection.offsetWidth
      playlistDetailSection.classList.add("fade-in")
    }
    if (playlist.id === "local") {
      applyLocalDownloadProgressUI()
    }
  }

  function renderPlaylistDetail(playlist) {
    if (!playlistDetailList) return
    playlistDetailList.innerHTML = ""
    playlist.songs.forEach((song, index) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
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
            <p class="text-xs text-gray-400 dark:text-gray-500 truncate">${escapeHtml(song.artist)} - ${escapeHtml(song.album)}</p>
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
      li.dataset.list = "playlist-detail"
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
      playlistDetailList.appendChild(li)
    })
    syncPlaylistDetailSelectAllCheckbox()
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

  function deletePlaylist(playlist) {
    const deleteConfirmModal = document.getElementById("deleteConfirmModal")
    const deleteConfirmMessage = document.getElementById("deleteConfirmMessage")
    if (deleteConfirmMessage)
      deleteConfirmMessage.textContent = `确定要删除歌单《${playlist.name}》吗？`
    if (deleteConfirmModal) deleteConfirmModal.classList.remove("hidden")

    const confirmBtn = document.getElementById("confirmDeleteBtn")
    const cancelBtn = document.getElementById("cancelDeleteBtn")

    if (confirmBtn) {
      confirmBtn.onclick = () => {
        const index = diyPlaylists.findIndex((p) => p.id === playlist.id)
        if (index > -1) {
          diyPlaylists.splice(index, 1)
          window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
          renderPlaylistSidebar()
          if (currentPlaylist && currentPlaylist.id === playlist.id) {
            backToSearch()
          }
          showToast(`歌单《${playlist.name}》已删除`)
        }
        if (deleteConfirmModal) deleteConfirmModal.classList.add("hidden")
        confirmBtn.onclick = null
        if (cancelBtn) cancelBtn.onclick = null
      }
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        if (deleteConfirmModal) deleteConfirmModal.classList.add("hidden")
        confirmBtn.onclick = null
        cancelBtn.onclick = null
      }
    }

    if (deleteConfirmModal) {
      deleteConfirmModal.addEventListener("click", function closeModal(e) {
        if (e.target === deleteConfirmModal) {
          deleteConfirmModal.classList.add("hidden")
          confirmBtn.onclick = null
          cancelBtn.onclick = null
          deleteConfirmModal.removeEventListener("click", closeModal)
        }
      })
    }
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
    const loadMoreBtnEl = document.getElementById("loadMoreBtn")
    if (loadMoreBtnEl) {
      if (searchResults.length >= PAGE_SIZE) {
        loadMoreBtnEl.style.display = "block"
      } else {
        loadMoreBtnEl.style.display = "none"
      }
    }
  }

  function initSearchState() {
    initialSearchState = saveCurrentSearchState()
  }

  function backToSearch() {
    currentPlaylist = null
    if (backToSearchBtn) backToSearchBtn.classList.add("hidden")
    if (searchResultsSection) searchResultsSection.classList.remove("hidden")
    if (playlistDetailSection) playlistDetailSection.classList.add("hidden")
    if (searchResults.length > 0) {
      if (searchResultList) {
        searchResultList.innerHTML = ""
        renderSearchResults(searchResults, 0)
      }
      if (searchResultsSection) {
        searchResultsSection.classList.remove("fade-in")
        void searchResultsSection.offsetWidth
        searchResultsSection.classList.add("fade-in")
      }
    }
    // 确保标题是搜索结果
    const titleElement = document.querySelector("#searchResultsSection h2")
    if (titleElement) titleElement.textContent = "搜索结果"
    if (searchInput) searchInput.value = currentKeyword
    const loadMoreBtnEl = document.getElementById("loadMoreBtn")
    if (loadMoreBtnEl) {
      if (searchResults.length >= PAGE_SIZE) {
        loadMoreBtnEl.style.display = "block"
      } else {
        loadMoreBtnEl.style.display = "none"
      }
    }
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
              ? `<input type="checkbox" class="download-song-cb selection-sq-checkbox mt-1 h-4 w-4 flex-shrink-0" data-song-id="${song.id}" ${selectedSearchIds.has(song.id) ? "checked" : ""} />`
              : `<span class="w-4 flex-shrink-0"></span>`
          }
          <div class="flex-1 min-w-0">
            <h3 class="font-medium dark:text-white truncate">${escapeHtml(song.name)}</h3>
            <p class="text-sm text-gray-400 dark:text-gray-500 truncate">${escapeHtml(song.artist)} - ${escapeHtml(song.album)}</p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button class="like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"} hover:text-red-500 transition-colors" data-song-id="${song.id}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="${isLiked ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            </button>
            <button class="add-to-playlist" data-song-id="${song.id}">+</button>
            <button class="more-btn" data-song-id="${song.id}">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" /></svg>
            </button>
          </div>
        </div>
      `
      const globalIndex = searchResults.length - songs.length + idx
      li.dataset.index = globalIndex
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

    if (loadMoreBtn) {
      loadMoreBtn.style.display = songs.length >= PAGE_SIZE ? "block" : "none"
      loadMoreBtn.style.margin = "0 auto"
    }
  }

  function removeFromPlaylist(index) {
    const song = playQueue[index]
    playQueue.splice(index, 1)
    renderPlaylist()
    showToast(`已从播放列表中移除《${song.name}》`)

    if (index === currentSongIndex) {
      if (playQueue.length === 0) {
        if (audioPlayer) audioPlayer.pause()
        currentSongIndex = -1
        if (songTitle) songTitle.textContent = "未播放歌曲"
        if (songArtist) songArtist.textContent = "--"
        if (coverImg) coverImg.src = ""
        renderLyrics("")
      } else {
        playNextSong()
      }
    } else if (index < currentSongIndex) {
      currentSongIndex--
    }
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

  async function playCurrentSong() {
    console.log(
      "[播放器] playCurrentSong 被调用，currentSongIndex:",
      currentSongIndex
    )
    if (currentSongIndex < 0 || currentSongIndex >= playQueue.length) {
      console.log("[播放器] currentSongIndex 无效，返回")
      return
    }

    const song = playQueue[currentSongIndex]
    console.log("[播放器] 当前歌曲:", song)
    console.log("[播放器] 歌曲URL:", song.url)
    if (!audioPlayer) {
      console.log("[播放器] audioPlayer 不存在，返回")
      return
    }
    // 检查URL是否有效
    let audioUrl = song.url
    if (!audioUrl || audioUrl.trim() === "") {
      console.error("[播放器] 歌曲URL无效:", audioUrl)
      showToastError("播放失败：歌曲链接无效")
      return
    }

    // 尝试对URL进行编码处理
    try {
      // 检查URL是否包含有效协议
      if (!audioUrl.startsWith("http://") && !audioUrl.startsWith("https://")) {
        console.error("[播放器] 歌曲URL格式错误，缺少协议:", audioUrl)
        showToastError("播放失败：歌曲链接格式错误")
        return
      }
      console.log("[播放器] 原始URL:", audioUrl)
      console.log("[播放器] URL长度:", audioUrl.length)
      console.log("[播放器] URL是否包含特殊字符:", /[+&=]/.test(audioUrl))
      // 检查URL是否可以访问
      fetch(audioUrl, { method: "HEAD" })
        .then((response) => {
          console.log("[播放器] URL检查响应状态:", response.status)
          console.log(
            "[播放器] URL Content-Type:",
            response.headers.get("content-type")
          )
        })
        .catch((err) => {
          console.error("[播放器] URL检查失败:", err)
        })
    } catch (e) {
      console.error("[播放器] URL处理错误:", e)
    }

    // 尝试对URL进行编码处理
    let encodedUrl = audioUrl
    try {
      // 检查URL是否包含有效协议
      if (!audioUrl.startsWith("http://") && !audioUrl.startsWith("https://")) {
        console.error("[播放器] 歌曲URL格式错误，缺少协议:", audioUrl)
        showToastError("播放失败：歌曲链接格式错误")
        return
      }

      // 尝试对URL进行编码
      encodedUrl = encodeURIComponent(audioUrl)
      console.log("[播放器] 原始URL:", audioUrl)
      console.log("[播放器] 编码后URL:", encodedUrl)
      console.log("[播放器] URL长度:", audioUrl.length)

      // 检查URL是否可以访问
      fetch(audioUrl, { method: "HEAD" })
        .then((response) => {
          console.log("[播放器] URL检查响应状态:", response.status)
          console.log(
            "[播放器] URL Content-Type:",
            response.headers.get("content-type")
          )
        })
        .catch((err) => {
          console.error("[播放器] URL检查失败:", err)
        })
    } catch (e) {
      console.error("[播放器] URL处理错误:", e)
    }

    // 先尝试使用原始URL，如果失败再尝试编码后的URL
    // 检查URL中是否有+字符，这些可能需要特殊处理
    let processedUrl = audioUrl
    if (processedUrl.includes("+")) {
      console.log("[播放器] URL包含+字符，尝试替换")
    }

    // 使用新的方式加载音频：先创建新的Audio对象来测试
    console.log("[播放器] 测试音频URL是否可访问...")
    const testAudio = new Audio(processedUrl)
    testAudio.preload = "metadata"

    const canPlayPromise = new Promise((resolve, reject) => {
      testAudio.addEventListener("canplay", () => {
        console.log("[播放器] 测试音频可以播放")
        resolve(true)
      })
      testAudio.addEventListener("error", (e) => {
        console.error("[播放器] 测试音频加载失败:", e)
        resolve(false)
      })
      // 超时处理
      setTimeout(() => {
        console.log("[播放器] 测试音频加载超时")
        resolve(false)
      }, 5000)
    })

    const canPlay = await canPlayPromise
    console.log("[播放器] 测试结果:", canPlay)

    // 设置audioPlayer的src
    // 先重置audio元素
    audioPlayer.pause()
    audioPlayer.removeAttribute("src")
    audioPlayer.load()
    console.log("[播放器] audioPlayer已重置")

    audioPlayer.src = processedUrl
    console.log("[播放器] audioPlayer.src 已设置:", processedUrl)
    if (songTitle) songTitle.textContent = song.name
    if (songArtist) songArtist.textContent = song.artist

    if (song.coverUrl) {
      if (coverImg) coverImg.src = song.coverUrl
      if (lyricsCoverImg) lyricsCoverImg.src = song.coverUrl
    } else {
      const defaultCover =
        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjUiIGN5PSIyNSIgcj0iMjUiIGZpbGw9IiNlZWVlZWUiLz4KPHBhdGggZD0iTTE1IDI1IEwyNSAxNSBMMzUgMjUiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yNSAxNSBMMjUgMzUiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+Cjwvc3ZnPgo="
      if (coverImg) coverImg.src = defaultCover
      if (lyricsCoverImg) lyricsCoverImg.src = defaultCover
    }

    if (lyricsSongTitle) lyricsSongTitle.textContent = song.name
    if (lyricsSongArtist) lyricsSongArtist.textContent = song.artist

    await loadLyricsWithStatus(song)

    try {
      console.log("[播放器] 等待音频加载完成...")
      if (audioPlayer.readyState < 2) {
        console.log("[播放器] 音频未准备好，等待loadedmetadata事件...")
        await new Promise((resolve) => {
          audioPlayer.addEventListener(
            "loadedmetadata",
            () => {
              console.log("[播放器] loadedmetadata事件触发，音频已准备好")
              resolve()
            },
            { once: true }
          )
          audioPlayer.addEventListener(
            "error",
            (e) => {
              console.error("[播放器] 音频加载错误:", e)
              resolve()
            },
            { once: true }
          )
        })
      }
      console.log("[播放器] 开始播放，readyState:", audioPlayer.readyState)
      await audioPlayer.play()
      renderPlaylist()
      await addToLatestPlayed(song)
    } catch (err) {
      if (
        err.name === "NotAllowedError" ||
        err.name === "NetworkError" ||
        err.name === "DecodeError"
      ) {
        showToastError("播放失败：歌曲链接可能失效")
      }
    }
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
      showToast("更多功能开发中...")
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
      showToast("更多功能开发中...")
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
      showToast("更多功能开发中...")
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
          if (audioPlayer) audioPlayer.pause()
          currentSongIndex = -1
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
          if (audioPlayer) audioPlayer.pause()
          currentSongIndex = -1
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
              Math.floor(offset / 10) + 1,
              10
            )

            console.log(`[搜索] go-music-dl API 响应状态：成功`)

            if (response && response.songs) {
              console.log(
                `[搜索] 成功获取 go-music-dl API 结果，数量：${response.songs.length}`
              )
              console.log(`[搜索] 原始响应数据示例：`, response.songs[0])
              songs = response.songs
                .map((song) => enrichMusicDlSearchSong(song))
                .filter(Boolean)
              console.log(
                `[搜索] 补全 id/Meting 地址后有效条目：${songs.length}/${response.songs.length}`
              )
              if (songs[0]) {
                console.log(
                  `[搜索] 转换后示例：${JSON.stringify(songs[0])}`
                )
              }
            } else if (response && response.error) {
              // API 调用失败，回退到默认 API
              console.log(`[搜索] go-music-dl API 调用失败：${response.error}`)
              console.log(`[搜索] 回退到默认 API 搜索：${keyword}, ${offset}`)
              songs = await window.ElectronAPI.searchMusic(keyword, offset)
              console.log(
                `[搜索] 默认 API 响应：${JSON.stringify(songs[0])}... (共 ${songs.length} 条)`
              )
            } else {
              console.log(`[搜索] go-music-dl API 未返回 songs 字段`)
              console.log(`[搜索] 响应数据：`, response)
              console.log(`[搜索] 回退到默认 API 搜索`)
              songs = await window.ElectronAPI.searchMusic(keyword, offset)
              console.log(
                `[搜索] 默认 API 响应：${JSON.stringify(songs[0])}... (共 ${songs.length} 条)`
              )
            }
          } catch (error) {
            // 发生异常，回退到默认 API
            console.error(`[搜索] go-music-dl API 调用异常：${error.message}`)
            console.log(`[搜索] 回退到默认 API 搜索：${keyword}, ${offset}`)
            songs = await window.ElectronAPI.searchMusic(keyword, offset)
            console.log(
              `[搜索] 默认 API 响应：${JSON.stringify(songs[0])}... (共 ${songs.length} 条)`
            )
          }
        } else {
          // 使用默认 API 搜索
          console.log(
            `[搜索] 未选择搜索源，使用默认 API 搜索：${keyword}, ${offset}`
          )
          songs = await window.ElectronAPI.searchMusic(keyword, offset)
          console.log(
            `[搜索] 默认 API 响应：${JSON.stringify(songs[0])}... (共 ${songs.length} 条)`
          )
        }

        if (songs && songs.length > 0) {
          searchCache.set(cacheKey, songs)
        }
      } catch (err) {
        console.error("[搜索] API请求失败：", err)
        showToastError("搜索失败，请查看日志或检查网络")
        if (offset === 0 && searchResultList) {
          searchResultList.innerHTML =
            '<div class="p-10 text-center text-red-500 dark:text-red-400">搜索失败，请稍后重试</div>'
          if (loadMoreBtn) loadMoreBtn.style.display = "none"
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
      if (loadMoreBtn) loadMoreBtn.style.display = "none"
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
      if (backToSearchBtn) backToSearchBtn.classList.add("hidden")
      // 设置标题为"搜索结果"
      const titleElement = document.querySelector("#searchResultsSection h2")
      if (titleElement) titleElement.textContent = "搜索结果"
      // 显示加载动画
      if (searchResultList)
        searchResultList.innerHTML =
          '<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索中...</p></div>'
      await loadSearchResults(keyword, searchOffset)
      await updateSearchHistory(keyword)
      initSearchState()
      if (searchResultsSection) {
        searchResultsSection.classList.remove("fade-in")
        void searchResultsSection.offsetWidth
        searchResultsSection.classList.add("fade-in")
      }
    } finally {
      isSearching = false
    }
  }

  // ========== 音频事件监听 ==========
  function setupAudioListeners() {
    if (audioPlayer) {
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

      // 监听src变化
      let lastSrc = audioPlayer.src
      setInterval(() => {
        if (audioPlayer.src !== lastSrc) {
          console.log(
            "[播放器] audioPlayer.src 发生变化:",
            lastSrc,
            "->",
            audioPlayer.src
          )
          lastSrc = audioPlayer.src
        }
      }, 100)
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
      // store未导入，暂不更新播放状态
    }

    // 处理暂停事件
    function handlePause() {
      console.log("[播放器] 暂停播放")
      // store未导入，暂不更新播放状态
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

    // 添加错误事件监听器
    audioPlayer.addEventListener("error", handleError)
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
    const clearCacheBtn = document.getElementById("clearCacheBtn")
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener("click", async () => {
        console.log("[搜索] 清除缓存并搜索")
        // 清除搜索缓存
        searchCache.clear()
        console.log("[搜索] 搜索缓存已清除")

        // 获取当前搜索框的值
        const keyword = searchInput ? searchInput.value.trim() : ""
        if (keyword) {
          // 重新搜索
          searchOffset = 0
          if (searchResultList) searchResultList.innerHTML = ""
          if (searchResultsSection)
            searchResultsSection.classList.remove("hidden")
          if (playlistDetailSection)
            playlistDetailSection.classList.add("hidden")
          if (backToSearchBtn) backToSearchBtn.classList.add("hidden")
          if (searchResultList)
            searchResultList.innerHTML =
              '<div class="p-10 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div><p class="mt-2 text-gray-600 dark:text-gray-400">搜索中...</p></div>'
          await loadSearchResults(keyword, searchOffset)
          await updateSearchHistory(keyword)
          if (searchResultsSection) {
            searchResultsSection.classList.remove("fade-in")
            void searchResultsSection.offsetWidth
            searchResultsSection.classList.add("fade-in")
          }
        }
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
        const submitBtn = document.querySelector(
          '#playlistEditForm button[type="submit"]'
        )
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

    // 歌词界面
    if (coverImg) {
      coverImg.addEventListener("click", () => {
        if (currentSongIndex >= 0) {
          if (lyricsInterface && lyricsInterface.classList.contains("hidden")) {
            const song = playQueue[currentSongIndex]
            if (lyricsCoverImg) {
              lyricsCoverImg.src =
                song.coverUrl ||
                "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjUiIGN5PSIyNSIgcj0iMjUiIGZpbGw9IiNlZWVlZWUiLz4KPHBhdGggZD0iTTE1IDI1IEwyNSAxNSBMMzUgMjUiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yNSAxNSBMMjUgMzUiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+Cjwvc3ZnPgo="
            }
            if (lyricsSongTitle) lyricsSongTitle.textContent = song.name
            if (lyricsSongArtist) lyricsSongArtist.textContent = song.artist
            lyricsInterface.classList.remove("hidden")
            if (mainInterface) mainInterface.classList.add("hidden")
          } else {
            if (lyricsInterface) lyricsInterface.classList.add("hidden")
            if (mainInterface) mainInterface.classList.remove("hidden")
          }
        }
      })
    }

    if (closeLyricsBtn) {
      closeLyricsBtn.addEventListener("click", () => {
        if (lyricsInterface) lyricsInterface.classList.add("hidden")
        if (mainInterface) mainInterface.classList.remove("hidden")
      })
    }

    // 播放列表浮窗
    if (togglePlaylistBtn) {
      togglePlaylistBtn.addEventListener("click", () => {
        if (playlistFloat) playlistFloat.classList.toggle("translate-x-full")
      })
    }

    if (closePlaylistBtn) {
      closePlaylistBtn.addEventListener("click", () => {
        if (playlistFloat) playlistFloat.classList.add("translate-x-full")
      })
    }

    // 返回按钮
    if (backToSearchBtn) {
      backToSearchBtn.addEventListener("click", backToSearch)
    }

    // 搜索
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        if (searchInput.value.trim() !== "") {
          if (clearSearchBtn) clearSearchBtn.classList.remove("hidden")
        } else {
          if (clearSearchBtn) clearSearchBtn.classList.add("hidden")
          if (searchResultList) searchResultList.innerHTML = ""
          if (loadMoreBtn) loadMoreBtn.style.display = "none"
        }
      })
    }

    if (searchBtn) {
      searchBtn.addEventListener("click", () => {
        const keyword = searchInput ? searchInput.value.trim() : ""
        performSearch(keyword)
      })
    }

    if (searchInput) {
      searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          const keyword = searchInput.value.trim()
          performSearch(keyword)
        }
      })
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", async () => {
        const keyword = searchInput ? searchInput.value.trim() : ""
        if (!keyword) return
        searchOffset += PAGE_SIZE
        await loadSearchResults(keyword, searchOffset)
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
      syncPlaylistDetailSelectAllCheckbox()
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
  }

  // ========== 初始化数据读取 ==========
  async function initApp() {
    initDOMElements()
    bindAllEvents()
    setupDownloadProgressListener()
    setupAudioListeners()
    setupSidebarResize()

    try {
      const savedPlaylist = await window.ElectronAPI.readPlaylist()
      if (savedPlaylist && savedPlaylist.length > 0) {
        playQueue = savedPlaylist
        renderPlaylist()
      }
    } catch (err) {
      console.error("读取播放列表失败:", err)
    }

    try {
      likedSongs = (await window.ElectronAPI.readLikedSongs()) || []
      if (likeCount) likeCount.textContent = likedSongs.length
    } catch (err) {
      console.error("读取我喜欢的歌曲失败:", err)
      likedSongs = []
    }

    try {
      followedArtists = (await window.ElectronAPI.readFollowedArtists()) || []
      const followCountEl = document.getElementById("followCount")
      if (followCountEl) followCountEl.textContent = followedArtists.length
    } catch (err) {
      console.error("读取关注歌手列表失败:", err)
      followedArtists = []
    }

    try {
      customPlaylists = (await window.ElectronAPI.readCustomPlaylists()) || []
      renderPlaylistSidebar()
    } catch (err) {
      console.error("读取自定义歌单失败:", err)
      customPlaylists = []
    }

    try {
      latestPlayed = (await window.ElectronAPI.readLatestPlayed()) || []
      if (recentCount) recentCount.textContent = latestPlayed.length
    } catch (err) {
      console.error("读取最近播放失败:", err)
      latestPlayed = []
    }

    try {
      diyPlaylists = (await window.ElectronAPI.readDIYPlaylists()) || []
      renderPlaylistSidebar()
    } catch (err) {
      console.error("读取自建歌单失败:", err)
      diyPlaylists = []
    }

    try {
      searchHistory = (await window.ElectronAPI.readSearchHistory()) || []
    } catch (err) {
      console.error("读取搜索历史失败:", err)
      searchHistory = []
    }

    try {
      localSongs = (await window.ElectronAPI.readLocalSongs()) || []
      const localCountEl = document.getElementById("localCount")
      if (localCountEl) localCountEl.textContent = localSongs.length
    } catch (err) {
      console.error("读取本地歌曲失败:", err)
      localSongs = []
    }

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
    if (animationFrameId) cancelAnimationFrame(animationFrameId)
    if (audioPlayer) {
      audioPlayer.removeEventListener("timeupdate", updateLyricHighlight)
      audioPlayer.removeEventListener("ended", playNextSong)
    }
  })
})()
