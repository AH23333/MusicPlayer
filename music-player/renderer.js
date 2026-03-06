// ========== 浏览器环境兼容补丁（新增，本地开发请注释掉） ==========
if (typeof window !== 'undefined' && !window.ElectronAPI) {
    // 1. 直接定义你 utils.js 中的所有 API 链接（复制你实际的链接）
    const API_CONFIGS = {
        // 替换成你 utils.js 中实际可用的链接！！！
        neteaseSearch: { url: 'https://music.163.com/weapi/cloudsearch/get/web?csrf_token=' },
        neteaseLyric: { url: 'https://music.163.com/weapi/song/lyric?csrf_token=' },
        neteaseAudioUrl: { url: 'https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=' },
        metingFallback: { url: 'https://api.injahow.cn/meting/api?server=netease' }, // 备用接口
        // 可以继续添加你 utils.js 中的其他接口
    };

    // 2. 复刻你 utils.js 中的 fetchViaProxy 函数（核心请求逻辑）
    async function fetchViaProxy(url, method = 'GET', data = {}) {
        try {
            const options = {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Referer': 'https://music.163.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            };

            if (method === 'POST') {
                options.body = JSON.stringify(data);
            }

            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            return await response.json();
        } catch (err) {
            console.error("请求失败:", url, err);
            return null;
        }
    }

    // 3. 模拟 ElectronAPI（完全独立，不依赖任何外部变量）
    window.ElectronAPI = {
        // 搜索功能（使用上面定义的 API_CONFIGS 和 fetchViaProxy）
        searchMusic: async (keyword, offset) => {
            try {
                // 1. 优先尝试网易云主接口
                let searchUrl = `${API_CONFIGS.neteaseSearch.url}?keywords=${encodeURIComponent(keyword)}&offset=${offset}&limit=20&type=1`;
                let data = await fetchViaProxy(searchUrl);
                
                // 2. 主接口失败则用备用接口
                if (!data || !data.result || !data.result.songs) {
                    searchUrl = `${API_CONFIGS.metingFallback.url}&type=search&keyword=${encodeURIComponent(keyword)}&page=${Math.floor(offset/20)+1}&limit=20`;
                    data = await fetchViaProxy(searchUrl);
                }

                // 3. 统一格式化歌曲数据
                let songs = [];
                if (data && data.result && data.result.songs) {
                    // 网易云接口格式
                    songs = data.result.songs.map(song => ({
                        id: song.id,
                        name: song.name,
                        artist: song.ar?.map(a => a.name).join(',') || '未知歌手',
                        album: song.al?.name || '未知专辑',
                        coverUrl: song.al?.picUrl || '',
                        songId: song.id,
                        url: '' // 先留空，后续获取播放链接
                    }));
                } else if (data && data.data) {
                    // 备用接口格式
                    songs = data.data.map(song => ({
                        id: song.id,
                        name: song.name,
                        artist: song.artist,
                        album: song.album,
                        coverUrl: song.pic,
                        songId: song.id,
                        url: song.url || ''
                    }));
                }

                // 4. 为每首歌获取可用播放链接（多接口尝试）
                for (let song of songs) {
                    if (!song.url) {
                        song.url = await getAvailableSongUrl(song.id);
                    }
                }

                return songs;
            } catch (err) {
                console.error("搜索失败:", err);
                alert("搜索失败，请检查API链接是否可用");
                return [];
            }
        },

        // 歌词功能
        fetchLyrics: async (songId) => {
            try {
                // 1. 优先尝试网易云歌词接口
                let lyricUrl = `${API_CONFIGS.neteaseLyric.url}?id=${songId}`;
                let data = await fetchViaProxy(lyricUrl);
                
                // 2. 备用歌词接口
                if (!data || !data.lrc) {
                    lyricUrl = `${API_CONFIGS.metingFallback.url}&type=lyric&id=${songId}`;
                    data = await fetchViaProxy(lyricUrl);
                }
                
                return { 
                    lrc: data.lrc?.lyric || data.lyric || "暂无歌词",
                    tlrc: data.tlyric?.lyric || data.tlyric || ""
                };
            } catch (err) {
                return { lrc: "歌词加载失败" };
            }
        },

        // 其他 ElectronAPI 方法（全部返回空，避免报错）
        savePlaylist: () => {},
        readPlaylist: async () => [],
        readLikedSongs: async () => [],
        saveLikedSongs: async () => {},
        readCustomPlaylists: async () => [],
        readLatestPlayed: async () => [],
        saveLatestPlayed: async () => {},
        readDIYPlaylists: async () => [],
        saveDIYPlaylists: async () => true,
        readSearchHistory: async () => [],
        saveSearchHistory: async () => {},
        readLocalSongs: async () => [],
        openFileDialog: async () => [],
        importLocalSongs: async () => ({ success: false }),
        deleteLocalSong: async () => ({ success: false }),
        savePlaylistCover: async () => ({ success: false }),
    };

    // 4. 获取可用播放链接（多接口尝试，解决网易云外链失效）
    async function getAvailableSongUrl(songId) {
        // 定义你 utils.js 中的所有备用播放链接（按优先级排序）
        const urlSources = [
            `${API_CONFIGS.metingFallback.url}&type=url&id=${songId}`, // 优先用备用接口
            `${API_CONFIGS.neteaseAudioUrl}?id=${songId}`,            // 网易云音频接口
            `https://music.163.com/song/media/outer/url?id=${songId}.mp3` // 最后兜底
        ];

        // 依次尝试每个链接源
        for (let url of urlSources) {
            try {
                const data = await fetchViaProxy(url);
                if (data && (data.url || data.data)) {
                    const playUrl = data.url || data.data.url;
                    // 简单验证链接有效性
                    if (playUrl && playUrl.trim() && !playUrl.includes('404')) {
                        return playUrl;
                    }
                }
            } catch (err) {
                continue; // 这个接口失败，试下一个
            }
        }

        return ''; // 所有接口都失败
    }
}
//=======================================================================}


// ========== 原有代码从这里开始（完全保留） ==========

window.onload = async () => {
  // ========== DOM元素获取 ==========
  // 搜索相关
  const searchInput = document.getElementById("searchInput")
  const searchBtn = document.getElementById("searchBtn")
  const clearSearchBtn = document.getElementById("clearSearchBtn")
  const searchResultList = document.getElementById("searchResultList")
  const loadMoreBtn = document.getElementById("loadMoreBtn")
  // 播放列表相关
  const playlistList = document.getElementById("playlistList")
  const playlistSidebarList = document.getElementById("playlistSidebarList")
  const createPlaylistBtn = document.getElementById("createPlaylistBtn")
  const likeSongsBtn = document.getElementById("likeSongsBtn")
  const likeCount = document.getElementById("likeCount")
  const recentPlayBtn = document.getElementById("recentPlayBtn")
  const recentCount = document.getElementById("recentCount")
  const togglePlaylistBtn = document.getElementById("togglePlaylistBtn")
  const closePlaylistBtn = document.getElementById("closePlaylistBtn")
  const playlistFloat = document.getElementById("playlistFloat")
  // 歌单详情相关
  const searchResultsSection = document.getElementById("searchResultsSection")
  const playlistDetailSection = document.getElementById("playlistDetailSection")
  const playlistDetailTitle = document.getElementById("playlistDetailTitle")
  const playlistDetailList = document.getElementById("playlistDetailList")
  const backToSearchBtn = document.getElementById("backToSearchBtn")
  // 歌词相关
  const lyricsArea = document.getElementById("lyricsArea")
  const lyricsInterface = document.getElementById("lyricsInterface")
  const closeLyricsBtn = document.getElementById("closeLyricsBtn")
  const lyricsCoverImg = document.getElementById("lyricsCoverImg")
  const lyricsSongTitle = document.getElementById("lyricsSongTitle")
  const lyricsSongArtist = document.getElementById("lyricsSongArtist")

  // 播放器相关
  const audioPlayer = document.getElementById("audioPlayer")
  const coverImg = document.getElementById("coverImg")
  const songTitle = document.getElementById("songTitle")
  const songArtist = document.getElementById("songArtist")
  const prevBtn = document.getElementById("prevBtn")
  const nextBtn = document.getElementById("nextBtn")
  // 播放模式相关
  const orderBtn = document.getElementById("orderBtn")
  const reverseBtn = document.getElementById("reverseBtn")
  const singleLoopBtn = document.getElementById("singleLoopBtn")
  const listLoopBtn = document.getElementById("listLoopBtn")
  const shuffleBtn = document.getElementById("shuffleBtn")
  const modeBtns = [
    orderBtn,
    reverseBtn,
    singleLoopBtn,
    listLoopBtn,
    shuffleBtn,
  ]
  // 主界面
  const mainInterface = document.getElementById("mainInterface")
  // 歌单编辑模态框
  const playlistEditModal = document.getElementById("playlistEditModal")
  const playlistEditForm = document.getElementById("playlistEditForm")
  const playlistName = document.getElementById("playlistName")
  const playlistDescription = document.getElementById("playlistDescription")
  const coverUpload = document.getElementById("coverUpload")
  const coverPreview = document.getElementById("coverPreview")
  const cancelPlaylistBtn = document.getElementById("cancelPlaylistBtn")
  const savePlaylistBtn = document.getElementById("savePlaylistBtn")

  // 全局状态 ==========
  let searchResults = [] // 搜索结果列表（独立）
  let playQueue = [] // 播放列表（独立）
  let likedSongs = [] // 我喜欢的歌曲
  let customPlaylists = [] // 自定义歌单
  let diyPlaylists = [] // 自建歌单
  let latestPlayed = [] // 最近播放的歌曲
  let localSongs = [] // 本地导入的歌曲
  let currentSongIndex = -1 // 当前播放歌曲在播放列表中的索引
  let playMode = "order" // 默认播放模式：order(顺序)/reverse(倒序)/singleLoop(单曲循环)/listLoop(列表循环)/shuffle(随机)
  let currentLyrics = [] // 解析后的歌词数组 [{time: 秒数, text: 歌词}]
  let lyricLines = [] // 歌词DOM元素数组
  let searchOffset = 0 // 搜索偏移量（加载更多）
  let isLoadingMore = false // 防止重复加载
  let currentPlaylist = null // 当前选中的自定义歌单
  let currentCover = null // 当前上传的封面
  // let currentEditingPlaylist = null // 当前正在编辑的歌单
  let searchHistory = [] // 搜索历史
  let selectedSongIndex = -1 // 当前选中的歌曲索引
  let selectedSongList = null // 当前选中的歌曲列表类型
  const MAX_SEARCH_HISTORY = 50 // 最大搜索历史记录数
  const PAGE_SIZE = 20 // 每次加载20条
  const MAX_LATEST_PLAYED = 50 // 最近播放最大数量

  // ========== 核心函数定义（移到前面） ==========
  // 渲染播放列表
  function renderPlaylist() {
    playlistList.innerHTML = ""
    playQueue.forEach((song, index) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
      const li = document.createElement("li")
      li.className = `list-group-item song-item ${index === currentSongIndex ? "active" : ""}`
      li.innerHTML = `
        <div class="flex-1">
          <strong>${song.name}</strong> - ${song.artist}
        </div>
        <div class="flex items-center gap-2">
          <button class="like-btn ${isLiked ? "liked" : ""}" data-song-id="${song.id}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="${isLiked ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
          <button class="delete-btn" data-index="${index}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      `
      li.dataset.index = index
      li.dataset.list = "playlist"

      // 点击事件处理（单击选中，双击播放）
      let lastClickTime = 0
      li.addEventListener("click", (e) => {
        const currentTime = Date.now()

        if (currentTime - lastClickTime < 300) {
          // 双击：播放歌曲
          currentSongIndex = index
          playCurrentSong()
          lastClickTime = 0
        } else {
          // 单击：选中歌曲
          lastClickTime = currentTime
          setTimeout(() => {
            if (Date.now() - lastClickTime >= 300) {
              selectSong(song, index, "playlist")
            }
          }, 300)
        }
      })
      playlistList.appendChild(li)
    })
    // 保存播放列表到本地
    window.ElectronAPI.savePlaylist(playQueue)
  }

  // 渲染歌单侧边栏
  function renderPlaylistSidebar() {
    playlistSidebarList.innerHTML = ""
    diyPlaylists.forEach((playlist, index) => {
      const li = document.createElement("li")
      li.className =
        "flex items-center gap-2 p-2 rounded hover:bg-gray-300 transition-colors duration-200 cursor-pointer dark:hover:bg-gray-700"
      // 检查是否有封面
      const hasCover = playlist.coverPath
      li.innerHTML = `
        ${
          hasCover
            ? `
          <img src="DIYSongListPage/${playlist.coverPath}" class="w-8 h-8 rounded object-cover" />
        `
            : `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 13c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
          </svg>
        `
        }
        <span class="flex-1">${playlist.name}</span>
        <span class="text-xs text-gray-400">${playlist.songs.length}</span>
      `
      li.dataset.index = index
      // 点击歌单
      li.addEventListener("click", () => {
        showPlaylistDetail(playlist)
      })
      // 右键菜单
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault()
        showPlaylistContextMenu(e, playlist)
      })
      playlistSidebarList.appendChild(li)
    })
  }

  // 设置活跃模式按钮
  function setActiveModeBtn(btn) {
    modeBtns.forEach((b) => b.classList.remove("active"))
    btn.classList.add("active")
  }

  // ========== 初始化数据读取 ==========
  // 读取本地播放列表
  try {
    const savedPlaylist = await window.ElectronAPI.readPlaylist()
    if (savedPlaylist.length > 0) {
      playQueue = savedPlaylist
      renderPlaylist()
    }
  } catch (err) {
    console.error("读取播放列表失败:", err)
  }

  // 读取我喜欢的歌曲
  try {
    likedSongs = await window.ElectronAPI.readLikedSongs()
    likeCount.textContent = likedSongs.length
  } catch (err) {
    console.error("读取我喜欢的歌曲失败:", err)
  }

  // 读取自定义歌单
  try {
    customPlaylists = await window.ElectronAPI.readCustomPlaylists()
    renderPlaylistSidebar()
  } catch (err) {
    console.error("读取自定义歌单失败:", err)
  }

  // 读取最近播放
  try {
    latestPlayed = await window.ElectronAPI.readLatestPlayed()
    recentCount.textContent = latestPlayed.length
  } catch (err) {
    console.error("读取最近播放失败:", err)
  }

  // 读取自建歌单
  try {
    diyPlaylists = await window.ElectronAPI.readDIYPlaylists()
    renderPlaylistSidebar()
  } catch (err) {
    console.error("读取自建歌单失败:", err)
  }

  // 读取搜索历史
  try {
    searchHistory = await window.ElectronAPI.readSearchHistory()
  } catch (err) {
    console.error("读取搜索历史失败:", err)
  }

  // 读取本地歌曲
  try {
    localSongs = await window.ElectronAPI.readLocalSongs()
    document.getElementById("localCount").textContent = localSongs.length
  } catch (err) {
    console.error("读取本地歌曲失败:", err)
  }

  // 搜索历史相关DOM元素
  const searchHistoryContainer = document.getElementById(
    "searchHistoryContainer"
  )
  const searchHistoryList = document.getElementById("searchHistoryList")

  // 搜索框点击事件 - 显示搜索历史
  searchInput.addEventListener("click", (e) => {
    e.stopPropagation() // 防止点击搜索框时触发其他事件
    if (searchHistory.length > 0) {
      renderSearchHistory()
      searchHistoryContainer.classList.remove("hidden")
    }
  })

  // 点击页面其他地方关闭搜索历史
  document.addEventListener("click", () => {
    searchHistoryContainer.classList.add("hidden")
  })

  // 阻止搜索历史容器内的点击事件冒泡
  searchHistoryContainer.addEventListener("click", (e) => {
    e.stopPropagation()
  })

  // 渲染搜索历史
  function renderSearchHistory() {
    searchHistoryList.innerHTML = ""
    searchHistory.forEach((item) => {
      const li = document.createElement("li")
      li.className =
        "p-3 hover:bg-gray-100 cursor-pointer transition-colors duration-200 dark:hover:bg-gray-700"
      li.textContent = item
      li.addEventListener("click", async () => {
        searchInput.value = item
        searchInput.dispatchEvent(new Event("input")) // 触发 input 事件以更新清空按钮
        searchHistoryContainer.classList.add("hidden")
        // 自动搜索
        const keyword = item.trim()
        if (keyword) {
          searchOffset = 0
          searchResultList.innerHTML = ""
          await loadSearchResults(keyword, searchOffset)
          // 更新搜索历史
          await updateSearchHistory(keyword)
          // 跳转到搜索结果界面
          searchResultsSection.classList.remove("hidden")
          playlistDetailSection.classList.add("hidden")
          // 添加淡入动画
          searchResultsSection.classList.remove("fade-in")
          void searchResultsSection.offsetWidth // 强制重绘
          searchResultsSection.classList.add("fade-in")
        }
      })
      searchHistoryList.appendChild(li)
    })
  }

  // 更新搜索历史
  async function updateSearchHistory(keyword) {
    // 去重 - 移除已存在的相同关键词
    searchHistory = searchHistory.filter((item) => item !== keyword)
    // 添加到开头
    searchHistory.unshift(keyword)
    // 限制数量
    if (searchHistory.length > MAX_SEARCH_HISTORY) {
      searchHistory = searchHistory.slice(0, MAX_SEARCH_HISTORY)
    }
    // 保存到文件
    try {
      await window.ElectronAPI.saveSearchHistory(searchHistory)
    } catch (err) {
      console.error("保存搜索历史失败:", err)
    }
  }

  // 默认选中顺序播放
  setActiveModeBtn(orderBtn)

  createPlaylistBtn.addEventListener("click", () => {
    // 重置表单
    playlistName.value = ""
    playlistDescription.value = ""
    coverPreview.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  `
    currentCover = null
    // 重置编辑状态
    currentEditingPlaylistId = null
    // 更改模态框标题和按钮文本
    document.querySelector("#playlistEditModal h2").textContent = "创建歌单"
    document.querySelector(
      '#playlistEditForm button[type="submit"]'
    ).textContent = "创建"
    // 显示模态框
    playlistEditModal.classList.remove("hidden")
  })

  // 封面上传处理
  coverUpload.addEventListener("change", (e) => {
    const file = e.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        coverPreview.innerHTML = `<img src="${event.target.result}" class="w-full h-full object-cover rounded-md">`
        currentCover = event.target.result
      }
      reader.readAsDataURL(file)
    }
  })

  // 取消按钮点击事件
  cancelPlaylistBtn.addEventListener("click", () => {
    playlistEditModal.classList.add("hidden")
    currentEditingPlaylistId = null // 新增
  })

  playlistEditForm.addEventListener("submit", async (e) => {
    e.preventDefault()

    console.log("【调试】提交事件触发")
    console.log("【调试】当前焦点元素:", document.activeElement)

    // 重新获取表单元素，确保引用是最新的
    const nameInput = document.getElementById("playlistName")
    const descInput = document.getElementById("playlistDescription")

    console.log("【调试】nameInput:", nameInput)
    console.log("【调试】descInput:", descInput)
    console.log(
      "【调试】descInput value:",
      descInput ? descInput.value : "null"
    )
    console.log(
      "【调试】descInput outerHTML:",
      descInput ? descInput.outerHTML : "null"
    )

    if (!nameInput || !descInput) {
      showToast("表单元素不存在")
      return
    }

    const name = nameInput.value.trim()
    const description = descInput.value.trim()

    console.log("【提交】获取到的 name:", name)
    console.log("【提交】获取到的 description:", description) // 必须能看到值

    if (!name) {
      showToast("请输入歌单名称")
      return
    }

    if (currentEditingPlaylistId) {
      // 修改现有歌单
      console.log("【编辑】当前编辑 ID:", currentEditingPlaylistId)
      const targetIndex = diyPlaylists.findIndex(
        (p) => p.id === currentEditingPlaylistId
      )
      if (targetIndex === -1) {
        showToast("歌单不存在")
        return
      }
      const targetPlaylist = diyPlaylists[targetIndex]
      console.log("【编辑】原歌单信息:", targetPlaylist)

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

      // 更新歌单
      targetPlaylist.name = name
      targetPlaylist.description = description
      if (coverPath) {
        targetPlaylist.coverPath = coverPath
      }

      console.log("【编辑】更新后的歌单:", targetPlaylist)

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
        playlistEditModal.classList.add("hidden")
        currentEditingPlaylistId = null
      } catch (err) {
        console.error("保存自建歌单失败:", err)
        showToast("歌单修改失败")
      }
    } else {
      // 创建新歌单
      console.log("【创建】准备创建歌单，名称:", name, "描述:", description)
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
      console.log("【创建】新歌单对象:", newPlaylist)

      try {
        const saveResult =
          await window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
        if (!saveResult) {
          showToast("保存失败，请检查日志")
          return
        }
        renderPlaylistSidebar()
        showToast(`已创建歌单：${name}`)
        playlistEditModal.classList.add("hidden")
      } catch (err) {
        console.error("保存自建歌单失败:", err)
        showToast("歌单创建失败")
      }
    }
  })

  // 点击"我喜欢"按钮
  likeSongsBtn.addEventListener("click", () => {
    showLikedSongs()
  })

  // 点击"最近播放"按钮
  recentPlayBtn.addEventListener("click", () => {
    showRecentSongs()
  })

  // 点击"本地和下载"按钮
  const localSongsBtn = document.getElementById("localSongsBtn")
  localSongsBtn.addEventListener("click", () => {
    showLocalSongs()
  })

  // 导入本地歌曲按钮点击事件
  const importLocalBtn = document.getElementById("importLocalBtn")
  importLocalBtn.addEventListener("click", async () => {
    // 打开文件选择对话框
    const filePaths = await window.ElectronAPI.openFileDialog()

    if (filePaths && filePaths.length > 0) {
      // 导入本地歌曲
      const result = await window.ElectronAPI.importLocalSongs(filePaths)
      if (result.success) {
        // 重新读取本地歌曲
        localSongs = await window.ElectronAPI.readLocalSongs()
        document.getElementById("localCount").textContent = localSongs.length
        // 重新显示本地歌曲
        showLocalSongs()
        showToast(`成功导入 ${result.songs.length} 首本地歌曲`)
      } else {
        showToast(`导入失败：${result.error}`)
      }
    }
  })

  // 显示"我喜欢"歌单
  function showLikedSongs() {
    const likedPlaylist = { id: "liked", name: "我喜欢", songs: likedSongs }
    showPlaylistDetail(likedPlaylist)
  }

  // 显示"最近播放"歌单
  function showRecentSongs() {
    const recentPlaylist = {
      id: "recent",
      name: "最近播放",
      songs: latestPlayed,
    }
    showPlaylistDetail(recentPlaylist)
  }

  // 显示"本地和下载"歌单
  function showLocalSongs() {
    const localPlaylist = {
      id: "local",
      name: "本地和下载",
      songs: localSongs,
    }
    showPlaylistDetail(localPlaylist)
  }

  // ========== 歌词核心功能 ==========
  // 解析歌词（提取时间戳和文本）- 增强版
  function parseLyrics(lrcText) {
    if (!lrcText) return []
    const lyrics = []
    const lines = lrcText.split("\n")

    // 支持多种时间格式：[mm:ss.xxx], [mm:ss], [mm:ss:xx]
    const timeRegex = /\[(\d{1,2}):(\d{2})(?:[:.](\d{2,3}))?\]/g

    lines.forEach((line) => {
      const matches = [...line.matchAll(timeRegex)]
      if (matches.length > 0) {
        const text = line.replace(timeRegex, "").trim()
        if (text) {
          // 处理一行歌词可能有多个时间标签的情况
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

    // 按时间排序并去重（相同时间的歌词只保留一个）
    return lyrics
      .sort((a, b) => a.time - b.time)
      .filter((lyric, index, array) => {
        return index === 0 || lyric.time !== array[index - 1].time
      })
  }

  // 渲染歌词（带滚动和高亮）
  function renderLyrics(lyrics) {
    currentLyrics = parseLyrics(lyrics)

    // 检查lyricsArea是否存在
    if (!lyricsArea) {
      return
    }

    lyricsArea.innerHTML = ""
    lyricLines = []

    if (currentLyrics.length === 0) {
      lyricsArea.innerHTML = '<div class="lyrics-empty">暂无歌词</div>'
      return
    }

    // 添加空行作为顶部填充，让歌词从中间开始显示（减少顶部填充）
    for (let i = 0; i < 3; i++) {
      const emptyLine = document.createElement("div")
      emptyLine.className = "lyric-line"
      emptyLine.style.opacity = "0"
      emptyLine.style.minHeight = "3.5rem"
      lyricsArea.appendChild(emptyLine)
      lyricLines.push(emptyLine)
    }

    // 渲染实际歌词
    currentLyrics.forEach((lyric, index) => {
      const line = document.createElement("div")
      line.className = "lyric-line"
      line.textContent = lyric.text
      line.dataset.index = index
      lyricsArea.appendChild(line)
      lyricLines.push(line)
    })

    // 添加空行作为底部填充（减少底部填充）
    for (let i = 0; i < 3; i++) {
      const emptyLine = document.createElement("div")
      emptyLine.className = "lyric-line"
      emptyLine.style.opacity = "0"
      emptyLine.style.minHeight = "3.5rem"
      lyricsArea.appendChild(emptyLine)
      lyricLines.push(emptyLine)
    }

    // 渲染完成后立即更新歌词高亮
    updateLyricHighlight()
  }

  // 歌词滚动和高亮（监听音频播放进度）- 简化可靠版
  function updateLyricHighlight() {
    // 确保lyricsArea存在
    if (!lyricsArea || !audioPlayer || currentLyrics.length === 0) return

    const currentTime = audioPlayer.currentTime
    let activeIndex = -1

    // 简化歌词匹配算法
    for (let i = 0; i < currentLyrics.length; i++) {
      const currentLyricTime = currentLyrics[i].time
      const nextLyricTime =
        i < currentLyrics.length - 1 ? currentLyrics[i + 1].time : Infinity

      // 当前时间在歌词时间范围内
      if (currentTime >= currentLyricTime && currentTime < nextLyricTime) {
        activeIndex = i
        break
      }
    }

    // 移除所有高亮
    lyricLines.forEach((line) => {
      line.classList.remove("active")
    })

    // 高亮当前歌词
    if (activeIndex >= 0 && activeIndex < currentLyrics.length) {
      // 计算实际歌词行的索引（考虑空行填充）
      const actualLyricIndex = activeIndex + 3 // 3个顶部空行
      if (actualLyricIndex < lyricLines.length) {
        const activeLine = lyricLines[actualLyricIndex]
        activeLine.classList.add("active")

        // 简化滚动算法：直接滚动到当前歌词元素
        const scrollContainer = lyricsArea.parentElement
        if (scrollContainer && activeLine.offsetParent) {
          // 获取当前歌词元素相对于滚动容器的位置
          const lineRect = activeLine.getBoundingClientRect()
          const containerRect = scrollContainer.getBoundingClientRect()

          // 计算需要滚动的距离
          const lineTop = lineRect.top + scrollContainer.scrollTop
          const containerMiddle = containerRect.height / 2
          const targetScrollTop = lineTop - containerMiddle

          // 平滑滚动
          scrollContainer.scrollTo({
            top: Math.max(0, targetScrollTop),
            behavior: "smooth",
          })
        }
      }
    }
  }

  // ========== 播放列表核心功能 ==========
  // 显示提示信息
  let toastQueue = []
  function showToast(message) {
    const toast = document.createElement("div")
    toast.className =
      "fixed right-4 bg-primary text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-y-0 opacity-100"
    toast.textContent = message
    document.body.appendChild(toast)

    // 添加到队列
    toastQueue.push(toast)
    // 更新所有提示的位置
    updateToastPositions()

    // 3秒后自动消失
    setTimeout(() => {
      toast.classList.add("opacity-0", "translate-y-4")
      setTimeout(() => {
        document.body.removeChild(toast)
        // 从队列中移除
        const index = toastQueue.indexOf(toast)
        if (index > -1) {
          toastQueue.splice(index, 1)
          // 更新剩余提示的位置
          updateToastPositions()
        }
      }, 300)
    }, 3000)
  }

  // 更新提示的位置
  function updateToastPositions() {
    toastQueue.forEach((toast, index) => {
      // 每个提示之间的间距为8px，从底部20px开始
      const bottom = 20 + index * 50 // 50px是每个提示的高度加上间距
      toast.style.bottom = `${bottom}px`
    })
  }

  // 选中歌曲（单击）
  function selectSong(song, index, listType) {
    // 移除之前选中的歌曲高亮
    document.querySelectorAll(".song-item.selected").forEach((item) => {
      item.classList.remove("selected")
    })

    // 设置新的选中状态
    selectedSongIndex = index
    selectedSongList = listType

    // 添加选中高亮 - 使用更可靠的选择器
    const currentSongElement = document.querySelector(
      `.song-item[data-index="${index}"][data-list="${listType}"]`
    )

    if (currentSongElement) {
      currentSongElement.classList.add("selected")
    }
  }

  // 播放选中的歌曲（双击）
  function playSelectedSong(song, listType) {
    // 先添加到播放列表
    const isExist = playQueue.some((item) => item.id === song.id)
    if (!isExist) {
      if (currentSongIndex >= 0) {
        // 如果有正在播放的歌曲，添加到下一首位置
        playQueue.splice(currentSongIndex + 1, 0, song)
      } else {
        // 如果没有正在播放的歌曲，添加到列表末尾
        playQueue.push(song)
      }
      renderPlaylist()
    }

    // 设置当前播放歌曲
    currentSongIndex = playQueue.findIndex((item) => item.id === song.id)
    playCurrentSong()

    // 清除选中状态
    selectedSongIndex = -1
    selectedSongList = null
    document.querySelectorAll(".song-item.selected").forEach((item) => {
      item.classList.remove("selected")
    })
  }

  // 增强歌词加载功能（带状态显示）
  async function loadLyricsWithStatus(song) {
    // 显示加载状态
    if (lyricsArea) {
      lyricsArea.innerHTML =
        '<div class="lyrics-loading">🎵 歌词加载中...</div>'
    }

    try {
      const lyrics = await window.ElectronAPI.fetchLyrics(song.songId)
      if (lyrics && (lyrics.lrc || lyrics.tlrc)) {
        renderLyrics(lyrics.lrc || lyrics.tlrc)
      } else {
        // 显示友好的无歌词提示
        if (lyricsArea) {
          lyricsArea.innerHTML =
            '<div class="lyrics-empty">🎵 暂无歌词，享受音乐吧~</div>'
        }
      }
    } catch (err) {
      // 显示错误提示
      if (lyricsArea) {
        lyricsArea.innerHTML = '<div class="lyrics-error">😔 歌词加载失败</div>'
      }
    }
  }

  function showPlaylistDetail(playlist) {
    currentPlaylist = playlist

    // 处理顶部标题：仅在“我喜欢”、“最近播放”和“本地和下载”时显示，其他情况隐藏
    if (
      playlist.id === "liked" ||
      playlist.id === "recent" ||
      playlist.id === "local"
    ) {
      playlistDetailTitle.textContent = playlist.name
      playlistDetailTitle.classList.remove("hidden")
    } else {
      playlistDetailTitle.classList.add("hidden")
    }

    // 处理导入按钮显示
    const importLocalBtn = document.getElementById("importLocalBtn")
    if (playlist.id === "local") {
      importLocalBtn.classList.remove("hidden")
    } else {
      importLocalBtn.classList.add("hidden")
    }

    // 更新歌单信息区域
    document.getElementById("playlistDetailName").textContent = playlist.name
    document.getElementById("playlistSongCount").textContent =
      `${playlist.songs.length}首`
    document.getElementById("playlistDetailDescription").textContent =
      playlist.description || "暂无描述"

    // 处理歌单信息区域的显示（封面、名称、描述等）
    const playlistInfoArea = document.getElementById("playlistInfoArea")

    if (
      playlist.id === "liked" ||
      playlist.id === "recent" ||
      playlist.id === "local"
    ) {
      // “我喜欢”、“最近播放”和“本地和下载”只显示歌曲列表，完全隐藏信息区域
      playlistInfoArea.classList.add("hidden")
      // 清除所有歌单信息，避免残留
      document.getElementById("playlistDetailName").textContent = ""
      document.getElementById("playlistSongCount").textContent = ""
      document.getElementById("playlistDetailDescription").textContent = ""
      // 隐藏封面容器并清除封面
      const playlistCoverContainer = document.getElementById(
        "playlistCoverContainer"
      )
      const playlistCoverImg = document.getElementById("playlistCoverImg")
      playlistCoverContainer.classList.add("hidden")
      playlistCoverImg.src = ""
    } else {
      // 自定义歌单显示完整信息
      playlistInfoArea.classList.remove("hidden")

      // 处理歌单封面
      const playlistCoverImg = document.getElementById("playlistCoverImg")
      const playlistCoverContainer = document.getElementById(
        "playlistCoverContainer"
      )

      if (playlist.songs.length === 0) {
        playlistCoverContainer.classList.add("hidden")
      } else {
        playlistCoverContainer.classList.remove("hidden")
        if (playlist.coverPath) {
          playlistCoverImg.src = `DIYSongListPage/${playlist.coverPath}`
        } else {
          const firstSong = playlist.songs[0]
          playlistCoverImg.src = firstSong.coverUrl || "默认封面地址" // 保持原有默认封面
        }
      }
    }

    renderPlaylistDetail(playlist)
    searchResultsSection.classList.add("hidden")
    playlistDetailSection.classList.remove("hidden")
    // 添加淡入动画
    playlistDetailSection.classList.remove("fade-in")
    void playlistDetailSection.offsetWidth // 强制重绘
    playlistDetailSection.classList.add("fade-in")
  }

  // 渲染歌单详情
  function renderPlaylistDetail(playlist) {
    playlistDetailList.innerHTML = ""
    playlist.songs.forEach((song, index) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
      const li = document.createElement("li")
      li.className = "song-item p-4"
      li.innerHTML = `
        <div class="flex-1">
          <h3 class="font-medium dark:text-white">${song.name}</h3>
          <p class="text-xs text-gray-400 dark:text-gray-500">${song.artist} - ${song.album}</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"}" data-song-id="${song.id}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="${isLiked ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
          <button class="add-to-playlist" data-song-id="${song.id}">+</button>
          <button class="delete-btn text-gray-400 hover:text-red-500 transition-colors duration-200 dark:text-gray-500" data-index="${index}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button class="more-btn" data-song-id="${song.id}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </div>
      `
      // 设置歌曲列表属性
      li.dataset.index = index
      li.dataset.list = "playlist-detail"

      // 点击事件处理（单击选中，双击播放）
      let lastClickTime = 0
      li.addEventListener("click", (e) => {
        const currentTime = Date.now()

        if (currentTime - lastClickTime < 300) {
          // 双击：播放歌曲
          playSelectedSong(song, "playlist-detail")
          lastClickTime = 0
        } else {
          // 单击：选中歌曲
          lastClickTime = currentTime
          setTimeout(() => {
            if (Date.now() - lastClickTime >= 300) {
              selectSong(song, index, "playlist-detail")
            }
          }, 300)
        }
      })
      // 喜欢按钮点击事件
      li.querySelector(".like-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        toggleLike(song)
        renderPlaylistDetail(playlist)
      })
      // 添加到播放列表的点击事件
      li.querySelector(".add-to-playlist").addEventListener("click", (e) => {
        e.stopPropagation()
        showAddToPlaylistMenu(e, song)
      })
      // 删除按钮点击事件
      li.querySelector(".delete-btn").addEventListener("click", async (e) => {
        e.stopPropagation()
        if (playlist.id === "liked") {
          await toggleLike(song) // 切换喜欢状态
          renderPlaylistDetail(playlist) // 重新渲染当前歌单
        } else if (playlist.id === "recent") {
          await removeFromLatestPlayed(song)
          renderPlaylistDetail(playlist)
        } else if (playlist.id === "local") {
          // 删除本地歌曲
          const result = await window.ElectronAPI.deleteLocalSong(song.url)
          if (result.success) {
            // 重新读取本地歌曲
            localSongs = await window.ElectronAPI.readLocalSongs()
            document.getElementById("localCount").textContent =
              localSongs.length
            // 重新显示本地歌曲
            showLocalSongs()
            showToast(`已删除本地歌曲：${song.name}`)
          } else {
            showToast(`删除失败：${result.error}`)
          }
        } else {
          removeFromCustomPlaylist(playlist, index)
        }
      })
      // 更多按钮点击事件
      li.querySelector(".more-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        showToast("更多功能开发中...")
      })
      playlistDetailList.appendChild(li)
    })
  }

  // 从自建歌单中删除歌曲
  function removeFromCustomPlaylist(playlist, index) {
    const song = playlist.songs[index]
    playlist.songs.splice(index, 1)
    // 保存自建歌单
    window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
    // 重新渲染歌单详情
    renderPlaylistDetail(playlist)
    // 重新渲染左侧歌单列表
    renderPlaylistSidebar()
    showToast(`已从歌单《${playlist.name}》中移除《${song.name}》`)
  }

  // 显示歌单右键菜单
  function showPlaylistContextMenu(e, playlist) {
    // 先移除已存在的右键菜单
    const existingMenus = document.querySelectorAll(".context-menu")
    existingMenus.forEach((menu) => menu.remove())

    // 创建右键菜单
    const menu = document.createElement("div")
    menu.className =
      "absolute bg-white border border-gray-300 rounded shadow-lg z-50 py-2 dark:bg-gray-800 dark:border-gray-700 context-menu"
    menu.style.left = `${e.clientX}px`
    menu.style.top = `${e.clientY}px`
    menu.innerHTML = `
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="playPlaylistBtn">播放歌单</button>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="editPlaylistBtn">修改歌单</button>
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 text-red-500 dark:hover:bg-gray-700" id="deletePlaylistBtn">删除歌单</button>
    `
    document.body.appendChild(menu)

    // 点击播放歌单
    menu.querySelector("#playPlaylistBtn").addEventListener("click", () => {
      playPlaylist(playlist)
      document.body.removeChild(menu)
    })

    // 点击修改歌单
    menu.querySelector("#editPlaylistBtn").addEventListener("click", () => {
      editPlaylist(playlist)
      document.body.removeChild(menu)
    })

    // 点击删除歌单
    menu.querySelector("#deletePlaylistBtn").addEventListener("click", () => {
      deletePlaylist(playlist)
      document.body.removeChild(menu)
    })

    // 点击其他地方关闭菜单
    setTimeout(() => {
      document.addEventListener("click", function closeMenu(e) {
        if (!menu.contains(e.target)) {
          if (document.body.contains(menu)) {
            document.body.removeChild(menu)
          }
          document.removeEventListener("click", closeMenu)
        }
      })
    }, 0)
  }

  // 播放歌单
  function playPlaylist(selectedPlaylist) {
    if (selectedPlaylist.songs.length === 0) {
      showToast("歌单为空，无法播放")
      return
    }
    // 替换当前播放列表
    playQueue = selectedPlaylist.songs
    renderPlaylist()
    // 播放第一首歌
    currentSongIndex = 0
    playCurrentSong()
    showToast(`开始播放歌单《${selectedPlaylist.name}》`)
  }

  let currentEditingPlaylistId = null

  function editPlaylist(playlist) {
    // 存储要编辑的歌单 ID
    currentEditingPlaylistId = playlist.id

    // 填充表单
    playlistName.value = playlist.name
    playlistDescription.value = playlist.description || ""

    // 显示现有封面
    if (playlist.coverPath) {
      coverPreview.innerHTML = `<img src="DIYSongListPage/${playlist.coverPath}" class="w-full h-full object-cover rounded" />`
      currentCover = playlist.coverPath
    } else {
      coverPreview.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    `
      currentCover = null
    }

    // 更改模态框标题和按钮文本
    document.querySelector("#playlistEditModal h2").textContent = "修改歌单"
    document.querySelector(
      '#playlistEditForm button[type="submit"]'
    ).textContent = "保存"

    // 显示模态框
    playlistEditModal.classList.remove("hidden")
  }

  // 删除歌单
  function deletePlaylist(playlist) {
    // 显示删除确认模态框
    const deleteConfirmModal = document.getElementById("deleteConfirmModal")
    const deleteConfirmMessage = document.getElementById("deleteConfirmMessage")

    // 设置确认消息
    deleteConfirmMessage.textContent = `确定要删除歌单《${playlist.name}》吗？`

    // 显示模态框
    deleteConfirmModal.classList.remove("hidden")

    // 确认删除按钮点击事件
    document.getElementById("confirmDeleteBtn").onclick = function () {
      const index = diyPlaylists.findIndex((p) => p.id === playlist.id)
      if (index > -1) {
        diyPlaylists.splice(index, 1)
        // 保存自建歌单
        window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
        // 重新渲染左侧歌单列表
        renderPlaylistSidebar()
        // 如果当前正在查看该歌单，返回搜索结果页面
        if (currentPlaylist && currentPlaylist.id === playlist.id) {
          backToSearch()
        }
        showToast(`歌单《${playlist.name}》已删除`)
      }
      // 关闭模态框
      deleteConfirmModal.classList.add("hidden")
      // 移除事件监听器
      document.getElementById("confirmDeleteBtn").onclick = null
      document.getElementById("cancelDeleteBtn").onclick = null
    }

    // 取消删除按钮点击事件
    document.getElementById("cancelDeleteBtn").onclick = function () {
      // 关闭模态框
      deleteConfirmModal.classList.add("hidden")
      // 移除事件监听器
      document.getElementById("confirmDeleteBtn").onclick = null
      document.getElementById("cancelDeleteBtn").onclick = null
    }

    // 点击模态框外部关闭
    deleteConfirmModal.addEventListener("click", function closeModal(e) {
      if (e.target === deleteConfirmModal) {
        deleteConfirmModal.classList.add("hidden")
        // 移除事件监听器
        document.getElementById("confirmDeleteBtn").onclick = null
        document.getElementById("cancelDeleteBtn").onclick = null
        deleteConfirmModal.removeEventListener("click", closeModal)
      }
    })
  }

  // 返回搜索结果页面
  function backToSearch() {
    currentPlaylist = null
    searchResultsSection.classList.remove("hidden")
    playlistDetailSection.classList.add("hidden")
    // 添加淡入动画
    searchResultsSection.classList.remove("fade-in")
    void searchResultsSection.offsetWidth // 强制重绘
    searchResultsSection.classList.add("fade-in")
  }

  // 切换喜欢状态
  async function toggleLike(song) {
    const index = likedSongs.findIndex((item) => item.id === song.id)
    if (index > -1) {
      likedSongs.splice(index, 1)
      showToast(`已从"我喜欢"中移除《${song.name}》`)
    } else {
      likedSongs.push(song)
      showToast(`已添加《${song.name}》到"我喜欢"`)
    }
    // 保存到 MyFavorite.json 文件
    try {
      await window.ElectronAPI.saveLikedSongs(likedSongs)
      likeCount.textContent = likedSongs.length
    } catch (err) {
      console.error("保存我喜欢的歌曲失败:", err)
    }
  }

  // 渲染搜索结果列表
  function renderSearchResults(songs) {
    songs.forEach((song) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
      const li = document.createElement("li")
      li.className = "song-item p-4 transition-colors duration-200"
      li.innerHTML = `
        <div class="flex-1">
          <h3 class="font-medium dark:text-white">${song.name}</h3>
          <p class="text-sm text-gray-400 dark:text-gray-500">${song.artist} - ${song.album}</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"}" data-song-id="${song.id}">
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
        </div>
      `
      // 设置歌曲列表属性
      li.dataset.index = songs.indexOf(song)
      li.dataset.list = "search"

      // 点击事件处理（单击选中，双击播放）
      let lastClickTime = 0

      li.addEventListener("click", (e) => {
        const now = Date.now()

        if (now - lastClickTime < 300) {
          // 双击：播放歌曲
          playSelectedSong(song, "search")
          lastClickTime = 0
        } else {
          // 单击：选中歌曲
          lastClickTime = now
          selectSong(song, songs.indexOf(song), "search")
        }
      })
      // 喜欢按钮点击事件
      li.querySelector(".like-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        toggleLike(song)
        renderSearchResults([song]) // 重新渲染当前歌曲
      })
      // 添加到播放列表的点击事件
      li.querySelector(".add-to-playlist").addEventListener("click", (e) => {
        e.stopPropagation() // 阻止触发播放
        showAddToPlaylistMenu(e, song)
      })
      // 更多按钮点击事件
      li.querySelector(".more-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        showToast("更多功能开发中...")
      })
      searchResultList.appendChild(li)
    })
    // 显示加载更多按钮（如果有更多数据）
    loadMoreBtn.style.display =
      songs.length >= PAGE_SIZE ? "inline-block" : "none"
  }

  // 从播放列表中删除歌曲
  function removeFromPlaylist(index) {
    const song = playQueue[index]
    playQueue.splice(index, 1)
    renderPlaylist()
    showToast(`已从播放列表中移除《${song.name}》`)

    // 如果删除的是当前正在播放的歌曲
    if (index === currentSongIndex) {
      if (playQueue.length === 0) {
        // 播放列表为空，停止播放
        audioPlayer.pause()
        currentSongIndex = -1
        songTitle.textContent = "未播放歌曲"
        songArtist.textContent = "--"
        coverImg.src = ""
        renderLyrics("")
      } else {
        // 播放下一首
        playNextSong()
      }
    } else if (index < currentSongIndex) {
      // 如果删除的歌曲在当前播放歌曲之前，更新索引
      currentSongIndex--
    }
  }

  async function removeFromLatestPlayed(song) {
    const index = latestPlayed.findIndex((item) => item.id === song.id)
    if (index > -1) {
      latestPlayed.splice(index, 1)
      recentCount.textContent = latestPlayed.length
      try {
        await window.ElectronAPI.saveLatestPlayed(latestPlayed)
        showToast(`已从最近播放中移除《${song.name}》`)
      } catch (err) {
        console.error("保存最近播放失败:", err)
        showToast("移除失败")
      }
    }
  }

  // 渲染播放列表
  function renderPlaylist() {
    playlistList.innerHTML = ""
    playQueue.forEach((song, index) => {
      if (!song.id) return
      const isLiked = likedSongs.some((item) => item.id === song.id)
      const li = document.createElement("li")
      li.className = `song-item p-4 ${index === currentSongIndex ? "bg-gray-200 dark:bg-gray-800" : ""}`
      li.innerHTML = `
        <div class="flex-1">
          <h3 class="font-medium dark:text-white">${song.name}</h3>
          <p class="text-xs text-gray-400 dark:text-gray-500">${song.artist} - ${song.album}</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="like-btn ${isLiked ? "text-red-500" : "text-gray-400 dark:text-gray-500"}" data-song-id="${song.id}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="${isLiked ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
          <button class="add-to-playlist" data-song-id="${song.id}">+</button>
          <button class="delete-btn text-gray-400 hover:text-red-500 transition-colors duration-200 dark:text-gray-500" data-index="${index}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button class="more-btn" data-song-id="${song.id}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </div>
      `
      li.dataset.index = index
      // 点击播放
      li.addEventListener("click", () => {
        currentSongIndex = index
        playCurrentSong()
      })
      // 喜欢按钮点击事件
      li.querySelector(".like-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        toggleLike(song)
        renderPlaylist() // 重新渲染播放列表
      })
      // 添加到播放列表的点击事件
      li.querySelector(".add-to-playlist").addEventListener("click", (e) => {
        e.stopPropagation() // 阻止触发播放
        showAddToPlaylistMenu(e, song)
      })
      // 删除按钮点击事件
      li.querySelector(".delete-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        removeFromPlaylist(index)
      })
      // 更多按钮点击事件
      li.querySelector(".more-btn").addEventListener("click", (e) => {
        e.stopPropagation()
        showToast("更多功能开发中...")
      })
      playlistList.appendChild(li)
    })
    // 保存播放列表到本地
    window.ElectronAPI.savePlaylist(playQueue)
  }

  // 添加歌曲到播放列表（尾部）
  function addToPlaylist(song) {
    // 避免重复添加
    const isExist = playQueue.some((item) => item.id === song.id)
    if (isExist) {
      showToast("该歌曲已在播放列表中")
      return
    }
    playQueue.push(song)
    renderPlaylist()
    showToast(`已添加《${song.name}》到播放列表`)
  }

  // 显示添加到歌单菜单
  function showAddToPlaylistMenu(e, song) {
    // 先关闭所有已存在的菜单，防止重叠
    const existingMenus = document.querySelectorAll(
      ".absolute.bg-white.border.border-gray-300.rounded.shadow-lg.z-50.py-2, .absolute.bg-gray-800.border.border-gray-700.rounded.shadow-lg.z-50.py-2"
    )
    existingMenus.forEach((menu) => menu.remove())

    // 创建菜单
    const menu = document.createElement("div")
    menu.className =
      "absolute bg-white border border-gray-300 rounded shadow-lg z-50 py-2 dark:bg-gray-800 dark:border-gray-700"
    menu.style.left = `${e.clientX}px`
    menu.style.top = `${e.clientY}px`

    // 添加到当前播放列表
    menu.innerHTML = `
      <button class="w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors duration-200 dark:hover:bg-gray-700 dark:text-white" id="addToCurrentPlaylistBtn">添加到当前播放列表</button>
      <div class="border-t border-gray-300 my-1 dark:border-gray-700"></div>
      <div class="px-4 py-1 text-xs text-gray-400 dark:text-gray-500">添加到自定义歌单</div>
    `

    // 添加自建歌单选项
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

    // 添加到当前播放列表按钮
    menu
      .querySelector("#addToCurrentPlaylistBtn")
      .addEventListener("click", () => {
        addToPlaylist(song)
        document.body.removeChild(menu)
      })

    document.body.appendChild(menu)

    // 点击其他地方关闭菜单
    setTimeout(() => {
      document.addEventListener("click", function closeMenu(e) {
        if (!menu.contains(e.target)) {
          if (document.body.contains(menu)) {
            document.body.removeChild(menu)
          }
          document.removeEventListener("click", closeMenu)
        }
      })
    }, 0)
  }

  // 添加歌曲到自建歌单
  function addSongToCustomPlaylist(song, playlist) {
    // 避免重复添加
    const isExist = playlist.songs.some((item) => item.id === song.id)
    if (isExist) {
      showToast(`该歌曲已在歌单《${playlist.name}》中`)
      return
    }
    playlist.songs.push(song)
    // 保存自建歌单
    window.ElectronAPI.saveDIYPlaylists(diyPlaylists)
    // 如果当前正在查看该歌单，重新渲染
    if (currentPlaylist && currentPlaylist.id === playlist.id) {
      renderPlaylistDetail(playlist)
    }
    // 重新渲染左侧歌单列表
    renderPlaylistSidebar()
    showToast(`已添加《${song.name}》到歌单《${playlist.name}》`)
  }

  // 添加歌曲到最近播放
  async function addToLatestPlayed(song) {
    // 移除已存在的相同歌曲
    latestPlayed = latestPlayed.filter((item) => item.id !== song.id)
    // 添加到开头
    latestPlayed.unshift(song)
    // 限制数量
    if (latestPlayed.length > MAX_LATEST_PLAYED) {
      latestPlayed = latestPlayed.slice(0, MAX_LATEST_PLAYED)
    }
    // 更新显示数量
    recentCount.textContent = latestPlayed.length
    // 保存到文件
    try {
      await window.ElectronAPI.saveLatestPlayed(latestPlayed)
    } catch (err) {
      console.error("保存最近播放失败:", err)
    }
  }

  // 播放当前选中的歌曲
  async function playCurrentSong() {
    if (currentSongIndex < 0 || currentSongIndex >= playQueue.length) return

    const song = playQueue[currentSongIndex]
    // 更新播放信息
    audioPlayer.src = song.url
    songTitle.textContent = song.name
    songArtist.textContent = song.artist

    // 显示封面
    if (song.coverUrl) {
      coverImg.src = song.coverUrl
      lyricsCoverImg.src = song.coverUrl
    } else {
      const defaultCover =
        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjUiIGN5PSIyNSIgcj0iMjUiIGZpbGw9IiNlZWVlZWUiLz4KPHBhdGggZD0iTTE1IDI1IEwyNSAxNSBMMzUgMjUiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yNSAxNSBMMjUgMzUiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+Cjwvc3ZnPgo="
      coverImg.src = defaultCover
      lyricsCoverImg.src = defaultCover
    }

    // 更新歌词界面信息
    lyricsSongTitle.textContent = song.name
    lyricsSongArtist.textContent = song.artist

    // 使用增强的歌词加载功能
    await loadLyricsWithStatus(song)

    // 播放歌曲
    try {
      await audioPlayer.play()
      // 更新播放列表选中状态
      renderPlaylist()
      // 添加到最近播放
      await addToLatestPlayed(song)
      // 不再自动显示歌词界面，让用户手动切换
    } catch (err) {
      // 仅在网络错误或解码错误时显示警告
      if (
        err.name === "NotAllowedError" ||
        err.name === "NetworkError" ||
        err.name === "DecodeError"
      ) {
        showToast("播放失败：歌曲链接可能失效")
      }
    }
  }

  // ========== 播放控制功能 ==========
  // 上一首
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
        // 单曲循环：重新播放当前歌曲
        audioPlayer.currentTime = 0
        audioPlayer.play()
        return
    }
    playCurrentSong()
  })

  // 下一首
  nextBtn.addEventListener("click", () => {
    playNextSong()
  })

  // 播放下一首（通用逻辑）
  function playNextSong() {
    if (playQueue.length === 0) return

    let wasLastSong = false
    // 检查是否是最后一首歌（用于顺序播放判断结束）
    if (playMode === "order" && currentSongIndex === playQueue.length - 1) {
      wasLastSong = true
    }
    // 检查是否是第一首歌（用于倒序播放判断结束）
    if (playMode === "reverse" && currentSongIndex === 0) {
      wasLastSong = true
    }

    switch (playMode) {
      case "order":
        currentSongIndex = (currentSongIndex + 1) % playQueue.length
        // 顺序播放到末尾停止
        if (wasLastSong) {
          audioPlayer.pause()
          currentSongIndex = -1
          songTitle.textContent = "播放结束"
          songArtist.textContent = ""
          // 关闭歌词界面
          lyricsInterface.classList.add("hidden")
          mainInterface.classList.remove("hidden")
          return
        }
        break
      case "reverse":
        currentSongIndex =
          (currentSongIndex - 1 + playQueue.length) % playQueue.length
        // 倒序播放到末尾停止
        if (wasLastSong) {
          audioPlayer.pause()
          currentSongIndex = -1
          songTitle.textContent = "播放结束"
          songArtist.textContent = ""
          // 关闭歌词界面
          lyricsInterface.classList.add("hidden")
          mainInterface.classList.remove("hidden")
          return
        }
        break
      case "singleLoop":
        // 单曲循环：重新播放当前歌曲
        audioPlayer.currentTime = 0
        audioPlayer.play()
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

  // ========== 播放模式切换 ==========
  // 设置激活的模式按钮
  function setActiveModeBtn(btn) {
    modeBtns.forEach((b) => b.classList.remove("active"))
    btn.classList.add("active")
  }

  // 模式按钮点击事件
  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      playMode = btn.dataset.mode
      setActiveModeBtn(btn)
      // 单曲循环需要设置audio的loop属性
      audioPlayer.loop = playMode === "singleLoop"
    })
  })

  // 歌词界面显示/隐藏
  coverImg.addEventListener("click", () => {
    if (currentSongIndex >= 0) {
      // 检查歌词界面是否已经显示
      if (lyricsInterface.classList.contains("hidden")) {
        // 显示歌词界面
        const song = playQueue[currentSongIndex]
        lyricsCoverImg.src =
          song.coverUrl ||
          "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjUiIGN5PSIyNSIgcj0iMjUiIGZpbGw9IiNlZWVlZWUiLz4KPHBhdGggZD0iTTE1IDI1IEwyNSAxNSBMMzUgMjUiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yNSAxNSBMMjUgMzUiIHN0cm9rZT0iIzY2NiIgc3Ryb2tlLXdpZHRoPSIyIi8+Cjwvc3ZnPgo="
        lyricsSongTitle.textContent = song.name
        lyricsSongArtist.textContent = song.artist
        lyricsInterface.classList.remove("hidden")
        mainInterface.classList.add("hidden")
      } else {
        // 隐藏歌词界面，显示主界面
        lyricsInterface.classList.add("hidden")
        mainInterface.classList.remove("hidden")
      }
    }
  })

  closeLyricsBtn.addEventListener("click", () => {
    lyricsInterface.classList.add("hidden")
    mainInterface.classList.remove("hidden")
  })

  // 播放列表浮窗显示/隐藏
  togglePlaylistBtn.addEventListener("click", () => {
    playlistFloat.classList.toggle("translate-x-full")
  })

  closePlaylistBtn.addEventListener("click", () => {
    playlistFloat.classList.add("translate-x-full")
  })

  // 返回按钮点击事件
  backToSearchBtn.addEventListener("click", backToSearch)

  // ========== 搜索功能 ==========
  // 搜索按钮点击
  searchBtn.addEventListener("click", async () => {
    const keyword = searchInput.value.trim()
    if (!keyword) return

    searchOffset = 0
    searchResultList.innerHTML = ""
    await loadSearchResults(keyword, searchOffset)
    // 更新搜索历史
    await updateSearchHistory(keyword)
    // 跳转到搜索结果界面
    searchResultsSection.classList.remove("hidden")
    playlistDetailSection.classList.add("hidden")
    // 添加淡入动画
    searchResultsSection.classList.remove("fade-in")
    void searchResultsSection.offsetWidth // 强制重绘
    searchResultsSection.classList.add("fade-in")
  })

  // 加载更多搜索结果
  loadMoreBtn.addEventListener("click", async () => {
    const keyword = searchInput.value.trim()
    if (!keyword) return
    searchOffset += PAGE_SIZE
    await loadSearchResults(keyword, searchOffset)
  })

  // 加载搜索结果
  async function loadSearchResults(keyword, offset) {
    try {
      // 注意：需要修改main.js的search-music接口，支持offset参数
      const songs = await window.ElectronAPI.searchMusic(keyword, offset)
      if (offset === 0 && songs.length === 0) {
        alert("未找到相关歌曲")
        return
      }
      searchResults = [...searchResults, ...songs]
      renderSearchResults(songs)
    } catch (err) {
      alert("搜索失败，请查看log.txt日志")
    }
  }

  // 控制清空按钮显示/隐藏
  searchInput.addEventListener("input", () => {
    if (searchInput.value.trim() !== "") {
      clearSearchBtn.classList.remove("hidden")
    } else {
      clearSearchBtn.classList.add("hidden")
    }
  })

  // 清空按钮点击事件
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = ""
    clearSearchBtn.classList.add("hidden")
    searchInput.focus() // 让搜索框重新获得焦点
    searchHistoryContainer.classList.add("hidden") // 同时关闭搜索历史浮窗
  })

  // 初始状态检查（如页面加载时已有默认文本）
  if (searchInput.value.trim() !== "") {
    clearSearchBtn.classList.remove("hidden")
  }

  // ========== 音频事件监听 ==========
  // 播放进度更新（更新歌词）
  if (audioPlayer) {
    // 先移除可能存在的监听器，避免重复绑定
    audioPlayer.removeEventListener("timeupdate", updateLyricHighlight)
    audioPlayer.removeEventListener("ended", playNextSong)

    // 重新绑定监听器
    audioPlayer.addEventListener("timeupdate", updateLyricHighlight)

    // 播放结束自动下一曲
    audioPlayer.addEventListener("ended", playNextSong)
  } else {
    // audioPlayer element not found
  }

  // 搜索框回车搜索
  searchInput.addEventListener("keypress", async (e) => {
    if (e.key === "Enter") {
      const keyword = searchInput.value.trim()
      if (keyword) {
        searchOffset = 0
        searchResultList.innerHTML = ""
        await loadSearchResults(keyword, searchOffset)
        // 更新搜索历史
        await updateSearchHistory(keyword)
        // 跳转到搜索结果界面
        searchResultsSection.classList.remove("hidden")
        playlistDetailSection.classList.add("hidden")
        // 添加淡入动画
        searchResultsSection.classList.remove("fade-in")
        void searchResultsSection.offsetWidth // 强制重绘
        searchResultsSection.classList.add("fade-in")
      }
    }
  })

  // 滚动监听，当滚动到搜索结果底部时自动加载更多
  searchResultList.addEventListener("scroll", () => {
    const { scrollTop, scrollHeight, clientHeight } = searchResultList
    // 当滚动到距离底部100px以内时，自动加载更多
    if (scrollTop + clientHeight >= scrollHeight - 100) {
      // 检查是否正在搜索中，避免重复请求
      if (!isLoadingMore) {
        const keyword = searchInput.value.trim()
        if (keyword) {
          isLoadingMore = true
          searchOffset += PAGE_SIZE
          loadSearchResults(keyword, searchOffset).finally(() => {
            isLoadingMore = false
          })
        }
      }
    }
  })

  // 侧边栏拉伸功能
  const sidebar = document.getElementById("sidebar")
  const sidebarResizer = document.getElementById("sidebarResizer")
  let isResizing = false

  sidebarResizer.addEventListener("mousedown", (e) => {
    isResizing = true
    document.body.style.cursor = "col-resize"
  })

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return

    const sidebarRect = sidebar.getBoundingClientRect()
    const newWidth = e.clientX - sidebarRect.left

    // 设置最小宽度和最大宽度
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

