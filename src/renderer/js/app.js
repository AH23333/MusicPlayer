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
  }

  // ========== 导出用户信息 ==========
  function bindUserInfoEvents() {
    if (exportUserBtn) {
      exportUserBtn.addEventListener("click", async () => {
        const result = await window.ElectronAPI.exportUserInfo()
        if (result.success) {
          showToast(`用户信息导出成功：${result.filePath}`)
        } else {
          showToast(`导出失败：${result.error}`)
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
          showToast(`导入失败：${result.error}`)
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
          showToast(result?.message || "检查更新失败")
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
    playlistList.innerHTML = ""
    playQueue.forEach((song, index) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
      const li = document.createElement("li")
      li.className = `song-item p-4 ${index === currentSongIndex ? "active" : ""} hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200`
      li.innerHTML = `
        <div class="flex items-center justify-between">
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
        showSongContextMenu(e, song)
      })
      playlistList.appendChild(li)
    })
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
        "p-3 hover:bg-gray-100 cursor-pointer transition-colors duration-200 dark:hover:bg-gray-700"
      li.textContent = item
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
  let toastQueue = []
  function showToast(message) {
    const toast = document.createElement("div")
    toast.className =
      "fixed right-4 bg-primary text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-y-0 opacity-100"
    toast.textContent = message
    document.body.appendChild(toast)
    toastQueue.push(toast)
    updateToastPositions()
    setTimeout(() => {
      toast.classList.add("opacity-0", "translate-y-4")
      setTimeout(() => {
        document.body.removeChild(toast)
        const index = toastQueue.indexOf(toast)
        if (index > -1) toastQueue.splice(index, 1)
        updateToastPositions()
      }, 300)
    }, 3000)
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
    const isExist = playQueue.some((item) => item.id === song.id)
    if (!isExist) {
      if (currentSongIndex >= 0) {
        playQueue.splice(currentSongIndex + 1, 0, song)
      } else {
        playQueue.push(song)
      }
      renderPlaylist()
    }
    currentSongIndex = playQueue.findIndex((item) => item.id === song.id)
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
      const lyrics = await window.ElectronAPI.fetchLyrics(song.songId)
      if (lyrics && (lyrics.lrc || lyrics.tlrc)) {
        renderLyrics(lyrics.lrc || lyrics.tlrc, song.songId)
      } else {
        if (lyricsArea) {
          lyricsArea.innerHTML =
            '<div class="lyrics-empty">🎵 暂无歌词，享受音乐吧~</div>'
        }
      }
    } catch (err) {
      if (lyricsArea) {
        lyricsArea.innerHTML = '<div class="lyrics-error">😔 歌词加载失败</div>'
      }
    }
  }

  function showPlaylistDetail(playlist) {
    currentPlaylist = playlist
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
            showToast(`导出失败：${result.error}`)
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
    if (searchResultsSection) searchResultsSection.classList.add("hidden")
    if (playlistDetailSection) playlistDetailSection.classList.remove("hidden")
    if (playlistDetailSection) {
      playlistDetailSection.classList.remove("fade-in")
      void playlistDetailSection.offsetWidth
      playlistDetailSection.classList.add("fade-in")
    }
  }

  function renderPlaylistDetail(playlist) {
    if (!playlistDetailList) return
    playlistDetailList.innerHTML = ""
    playlist.songs.forEach((song, index) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
      const li = document.createElement("li")
      li.className = "song-item p-4"
      li.innerHTML = `
        <div class="flex items-center justify-between">
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
        showSongContextMenu(e, song)
      })
      playlistDetailList.appendChild(li)
    })
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
      showToast("歌单为空，无法播放")
      return
    }
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
      showToast("歌手名称无效，无法添加到关注列表")
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
      showToast("保存关注歌手列表失败，请检查日志")
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
      const li = document.createElement("li")
      li.className = "song-item p-4 transition-colors duration-200"
      li.innerHTML = `
        <div class="flex items-center justify-between">
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
        showSongContextMenu(e, song)
      })
      searchResultList.appendChild(li)
    })

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
        showToast("移除失败")
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

  function showSongContextMenu(e, song) {
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

    menu.innerHTML = `
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="addToLikedBtn">${isLiked ? "移除我喜欢" : "添加到我喜欢"}</button>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="addToFollowedBtn">${isFollowed ? "取消关注歌手" : "关注歌手"}</button>
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

    document.body.appendChild(menu)

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
    if (currentSongIndex < 0 || currentSongIndex >= playQueue.length) return

    const song = playQueue[currentSongIndex]
    if (!audioPlayer) return
    audioPlayer.src = song.url
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
      await audioPlayer.play()
      renderPlaylist()
      await addToLatestPlayed(song)
    } catch (err) {
      if (
        err.name === "NotAllowedError" ||
        err.name === "NetworkError" ||
        err.name === "DecodeError"
      ) {
        showToast("播放失败：歌曲链接可能失效")
      }
    }
    preloadNextSong()
  }

  // ========== 事件委托处理函数 ==========
  function handlePlaylistClick(e) {
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
    const target = e.target.closest("button")
    if (!target) return
    const li = target.closest("li")
    const globalIndex = parseInt(li?.dataset.index, 10)
    if (isNaN(globalIndex)) return
    const song = searchResults[globalIndex]
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
            showToast(`删除失败：${result.error}`)
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
      songs = searchCache.get(cacheKey)
    } else {
      try {
        songs = await window.ElectronAPI.searchMusic(keyword, offset)
        if (songs && songs.length > 0) {
          searchCache.set(cacheKey, songs)
        }
      } catch (err) {
        console.error("[搜索] API请求失败：", err)
        showToast("搜索失败，请查看日志")
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
      audioPlayer.addEventListener("timeupdate", updateLyricHighlight)
      audioPlayer.addEventListener("ended", playNextSong)
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
        e.stopPropagation()
        if (searchHistory.length > 0) {
          renderSearchHistory()
          if (searchHistoryContainer)
            searchHistoryContainer.classList.remove("hidden")
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
          showToast(`导入失败：${result.error}`)
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
            showToast("歌单不存在")
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
              showToast("封面保存失败")
            }
          }

          targetPlaylist.name = name
          targetPlaylist.description = description
          if (coverPath) targetPlaylist.coverPath = coverPath

          try {
            const saveResult =
              await window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
            if (!saveResult) {
              showToast("保存失败，请检查日志")
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
            showToast("歌单修改失败")
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
              showToast("封面保存失败")
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
              showToast("保存失败，请检查日志")
              return
            }
            renderPlaylistSidebar()
            showToast(`已创建歌单：${name}`)
            if (playlistEditModal) playlistEditModal.classList.add("hidden")
          } catch (err) {
            console.error("保存自建歌单失败:", err)
            showToast("歌单创建失败")
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
            showToast(`导入失败：${result.error}`)
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
