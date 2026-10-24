/**
 * features.js — 播放器增强功能集（独立组件，不依赖任何 UI 框架）
 * 依赖：window.MusicPlayer（由 app.js 提供）、window.ElectronAPI（preload）
 * 包含：媒体键/MediaSession、托盘通知、记忆播放、迷你模式、睡眠定时、
 *       桌面歌词、频谱可视化、淡入淡出、队列拖拽、均衡器、听歌统计、设置面板
 */
(function () {
  "use strict"
  if (!window.MusicPlayer) {
    console.warn("[features] 未找到 MusicPlayer 桥接，功能模块未加载")
    return
  }
  const Player = window.MusicPlayer
  const API = window.ElectronAPI || {}
  const $ = (id) => document.getElementById(id)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // app.js 的 audioPlayer 闭包缓存可能在异步初始化后才赋值，这里直接以 DOM 为准兜底（同一元素）
  const getAudioEl = () => Player.getAudio() || document.getElementById("audioPlayer")

  // ============ 设置 ============
  const SETTINGS_KEY = "mp-settings"
  const SESSION_KEY = "mp-session"
  const STATS_KEY = "mp-stats"
  const VOLUME_KEY = "mp-volume"
  const MODE_KEY = "mp-playmode"
  const DEFAULT_SETTINGS = {
    notifySong: true,
    crossfade: false,
    fadeDur: 2,
    eqOn: false,
    eqPreset: "flat",
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    accent: "#1db954",
    playbackRate: 1,
    gainBoost: 1,
    pan: 0,
    lyricSize: "medium",
  }
  let settings = loadSettings()
  function loadSettings() {
    try {
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"))
    } catch {
      return Object.assign({}, DEFAULT_SETTINGS)
    }
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }
  function applyAccent(hex) {
    document.documentElement.style.setProperty("--accent", hex)
    // 派生亮色
    document.documentElement.style.setProperty("--accent-2", hex)
    // 同步桌面歌词主题色
    if (window.ElectronAPI && window.ElectronAPI.desktopLyricsAccent)
      window.ElectronAPI.desktopLyricsAccent(hex)
  }

  // ============ 音频引擎（EQ / 频谱 / 淡入淡出）============
  const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pop: [2, 3, 2, 0, -1, 0, 1, 2, 3, 3],
    rock: [4, 3, 2, 1, -1, 0, 2, 3, 4, 4],
    vocal: [-1, -1, 0, 1, 3, 4, 3, 2, 0, -1],
    bass: [5, 4, 3, 2, 1, 0, 0, 0, 0, 0],
  }
  const AudioEngine = {
    ctx: null,
    source: null,
    eq: [],
    analyser: null,
    master: null,
    boost: null,
    panner: null,
    freq: null,
    ensure() {
      if (this.ctx) return this.ctx
      const audio = getAudioEl()
      if (!audio) return null
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        this.ctx = new AC()
        this.source = this.ctx.createMediaElementSource(audio)
        let node = this.source
        EQ_FREQS.forEach((f) => {
          const filter = this.ctx.createBiquadFilter()
          filter.type = "peaking"
          filter.frequency.value = f
          filter.Q.value = 1
          filter.gain.value = 0
          node.connect(filter)
          node = filter
          this.eq.push(filter)
        })
        this.analyser = this.ctx.createAnalyser()
        this.analyser.fftSize = 128
        this.analyser.smoothingTimeConstant = 0.82
        this.master = this.ctx.createGain()
        this.master.gain.value = 1
        node.connect(this.analyser)
        this.analyser.connect(this.master)
        // 音量增益（响度增强）与左右声道平衡
        this.boost = this.ctx.createGain()
        this.boost.gain.value = 1
        this.panner = this.ctx.createStereoPanner()
        this.panner.pan.value = 0
        this.master.connect(this.boost)
        this.boost.connect(this.panner)
        this.panner.connect(this.ctx.destination)
        this.freq = new Uint8Array(this.analyser.frequencyBinCount)
        this.applyEQ()
        this.applyBoost()
        this.applyPan()
        this.applyPlaybackRate()
      } catch (e) {
        console.warn("[features] 音频引擎初始化失败", e)
        this.ctx = null
      }
      return this.ctx
    },
    resume() {
      const c = this.ensure()
      if (c && c.state === "suspended") c.resume().catch(() => {})
    },
    applyEQ() {
      const gains = settings.eqOn ? settings.eqGains : EQ_PRESETS.flat
      this.eq.forEach((f, i) => {
        f.gain.setTargetAtTime(gains[i] || 0, this.ctx.currentTime, 0.03)
      })
    },
    applyFade() {
      if (!this.ctx || !this.master) return
      const audio = getAudioEl()
      if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return
      let g = 1
      if (settings.crossfade) {
        const dur = settings.fadeDur
        const t = audio.currentTime
        const rem = audio.duration - t
        if (t < dur) g = Math.min(g, t / dur)
        if (rem < dur) g = Math.min(g, rem / dur)
      }
      g = Math.max(0, Math.min(1, g))
      this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.08)
    },
    // 音量增益（0.5–3，默认 1）
    applyBoost() {
      if (!this.ctx || !this.boost) return
      const v = Number(settings.gainBoost) || 1
      this.boost.gain.setTargetAtTime(Math.max(0.5, Math.min(3, v)), this.ctx.currentTime, 0.05)
    },
    // 左右声道平衡（-1 全左 ~ 1 全右，0 居中）
    applyPan() {
      if (!this.ctx || !this.panner) return
      const v = Math.max(-1, Math.min(1, Number(settings.pan) || 0))
      this.panner.pan.setTargetAtTime(v, this.ctx.currentTime, 0.03)
    },
    // 播放倍速（0.5–2）
    applyPlaybackRate() {
      const audio = getAudioEl()
      if (!audio) return
      const r = Number(settings.playbackRate) || 1
      audio.playbackRate = r
      audio.defaultPlaybackRate = r
    },
  }

  // ============ 通用小弹层（睡眠菜单）============
  // drag region（标题栏/迷你条）会吞掉区域内的鼠标事件（不产生 DOM click），
  // 因此弹层打开期间用 body.fp-menu-open 取消 drag region（见 style.css），
  // 保证菜单项可点击、点弹层外任意区域能关闭。
  function syncFpMenuOpen() {
    document.body.classList.toggle("fp-menu-open", !!document.querySelector(".fp-menu"))
  }
  function closeFpMenus() {
    document.querySelectorAll(".fp-menu").forEach((m) => m.remove())
    syncFpMenuOpen()
  }
  function popupAt(anchor, items) {
    closeFpMenus()
    const menu = document.createElement("div")
    menu.className = "fp-menu"
    const dismiss = () => {
      menu.remove()
      syncFpMenuOpen()
    }
    items.forEach((it) => {
      const b = document.createElement("button")
      b.className = "fp-menu-item" + (it.active ? " active" : "")
      b.textContent = it.label
      b.addEventListener("click", () => {
        dismiss()
        it.onClick && it.onClick()
      })
      menu.appendChild(b)
    })
    document.body.appendChild(menu)
    syncFpMenuOpen()
    const r = anchor.getBoundingClientRect()
    const mr = menu.getBoundingClientRect()
    let left = r.left + r.width / 2 - mr.width / 2
    left = Math.max(8, Math.min(window.innerWidth - mr.width - 8, left))
    menu.style.left = left + "px"
    let top = r.top - mr.height - 8
    // 弹层须完整落在窗口内（迷你模式窗口很小）
    top = Math.max(4, Math.min(top, window.innerHeight - mr.height - 4))
    menu.style.top = top + "px"
    setTimeout(() => {
      const detach = () => {
        document.removeEventListener("click", close)
        document.removeEventListener("keydown", onKey)
      }
      const close = (e) => {
        // 菜单已被其他路径移除（二次点击/新弹层）：清掉监听即可
        if (!menu.isConnected) {
          detach()
          return
        }
        if (!menu.contains(e.target)) {
          dismiss()
          detach()
        }
      }
      const onKey = (e) => {
        if (e.key !== "Escape" || !menu.isConnected) return
        dismiss()
        detach()
      }
      document.addEventListener("click", close)
      document.addEventListener("keydown", onKey)
    }, 0)
    return menu
  }

  // 通用小输入弹窗（用于睡眠自定义分钟等）
  function popupInput(anchor, title, onOk, placeholder) {
    closeFpMenus()
    const menu = document.createElement("div")
    menu.className = "fp-menu fp-form"
    const head = document.createElement("div")
    head.className = "fp-form-title"
    head.textContent = title
    const input = document.createElement("input")
    input.type = "number"; input.min = "1"; input.max = "600"
    input.className = "fp-input"; input.placeholder = placeholder || ""
    const row = document.createElement("div")
    row.className = "fp-form-actions"
    const cancel = document.createElement("button")
    cancel.className = "btn btn-mini"; cancel.textContent = "取消"
    const ok = document.createElement("button")
    ok.className = "btn btn-mini btn-primary"; ok.textContent = "确定"
    row.appendChild(cancel); row.appendChild(ok)
    menu.appendChild(head); menu.appendChild(input); menu.appendChild(row)
    document.body.appendChild(menu)
    syncFpMenuOpen()
    const r = anchor.getBoundingClientRect(), mr = menu.getBoundingClientRect()
    let left = r.left + r.width / 2 - mr.width / 2
    left = Math.max(8, Math.min(window.innerWidth - mr.width - 8, left))
    menu.style.left = left + "px"
    menu.style.top = r.top - mr.height - 8 + "px"
    setTimeout(() => input.focus(), 60)
    const dismissForm = () => {
      menu.remove()
      syncFpMenuOpen()
    }
    const done = () => {
      const v = parseInt(input.value, 10)
      if (!isFinite(v) || v < 1) { input.focus(); return }
      dismissForm(); onOk(v)
    }
    cancel.addEventListener("click", dismissForm)
    ok.addEventListener("click", done)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done() }
      if (e.key === "Escape") dismissForm()
    })
    return menu
  }

  // ============ 媒体键 + MediaSession ============
  function initMediaKeys() {
    if (API.onMediaControl) {
      API.onMediaControl((action) => {
        if (action === "toggle") Player.toggle()
        else if (action === "next") Player.next()
        else if (action === "prev") Player.prev()
        else if (action === "pause") Player.pause()
      })
    }
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", () => Player.play())
        navigator.mediaSession.setActionHandler("pause", () => Player.pause())
        navigator.mediaSession.setActionHandler("nexttrack", () => Player.next())
        navigator.mediaSession.setActionHandler("previoustrack", () => Player.prev())
      } catch (e) {}
    }
  }

  function updateMediaSession(song) {
    if (!("mediaSession" in navigator) || !song) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name || "未知曲目",
        artist: song.artist || "未知歌手",
        album: song.album || "",
        artwork: song.coverUrl ? [{ src: song.coverUrl, sizes: "300x300" }] : [],
      })
      navigator.mediaSession.playbackState = Player.isPlaying() ? "playing" : "paused"
    } catch (e) {}
  }

  // ============ 切歌通知 ============
  function notifySong(song) {
    if (!settings.notifySong || !song || !API.notifySong) return
    // 仅在实际播放时通知：启动恢复上次会话（未自动播放）不应弹系统通知
    if (!Player.isPlaying()) return
    API.notifySong({ title: song.name, artist: song.artist, cover: song.coverUrl })
  }

  // ============ 记忆播放 ============
  function initSession() {
    const vol = localStorage.getItem(VOLUME_KEY)
    const audio = getAudioEl()
    const volSlider = $("npVolume")
    if (vol !== null && audio) {
      audio.volume = parseFloat(vol)
      if (volSlider) volSlider.value = vol
    }
    if (volSlider) {
      // 拖动滑块高频触发 input，防抖后再写 localStorage
      let volSaveTimer = 0
      volSlider.addEventListener("input", () => {
        clearTimeout(volSaveTimer)
        volSaveTimer = setTimeout(() => {
          localStorage.setItem(VOLUME_KEY, volSlider.value)
        }, 300)
      })
    }
    const mode = localStorage.getItem(MODE_KEY)
    if (mode) {
      try {
        Player.setMode(mode)
      } catch (e) {}
    }
    Player.on("songchange", () => {
      const i = Player.getCurrentIndex()
      const s = Player.getCurrentSong()
      // 恢复会话期间的 songchange 不覆盖待恢复的 session（time/playing）
      if (s && !restoringSession)
        localStorage.setItem(SESSION_KEY, JSON.stringify({ index: i, id: s.id, time: 0, playing: true }))
      AudioEngine.applyPlaybackRate()
      resetAB()
    })
    let tSaveTimer = 0
    audio.addEventListener("timeupdate", () => {
      if (!isFinite(audio.duration)) return
      if (Date.now() - tSaveTimer > 3000) {
        tSaveTimer = Date.now()
        const s = Player.getCurrentSong()
        if (s && !audio.paused) {
          localStorage.setItem(
            SESSION_KEY,
            JSON.stringify({
              index: Player.getCurrentIndex(),
              id: s.id,
              time: audio.currentTime,
              playing: true,
            })
          )
        }
      }
    })
    // 播放/暂停即时记录：保证退出前的真实播放状态被记住
    const saveSessionPlaying = (playing) => {
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (!raw) return
        const sess = JSON.parse(raw)
        if (sess && typeof sess === "object") {
          sess.playing = !!playing
          localStorage.setItem(SESSION_KEY, JSON.stringify(sess))
        }
      } catch (e) {}
    }
    audio.addEventListener("play", () => saveSessionPlaying(true))
    audio.addEventListener("pause", () => saveSessionPlaying(false))
    Player.on("app-ready", () => {
      restoreSession()
    })
  }
  let restoringSession = false
  async function restoreSession() {
    // 确保队列已加载
    let queue = Player.getQueue()
    for (let i = 0; i < 20 && queue.length === 0; i++) {
      await sleep(100)
      queue = Player.getQueue()
    }
    const mode = localStorage.getItem(MODE_KEY)
    if (mode) Player.setMode(mode)
    let sess = null
    try {
      sess = JSON.parse(localStorage.getItem(SESSION_KEY) || "null")
    } catch {
      sess = null
    }
    if (!sess) return
    let idx = queue.findIndex((s) => s.id === sess.id)
    if (idx === -1 && sess.index >= 0 && sess.index < queue.length) idx = sess.index
    if (idx >= 0) {
      restoringSession = true
      try {
        await Player.playAt(idx, { autoplay: false, startTime: sess.time || 0 })
      } finally {
        restoringSession = false
      }
      // 上次退出时正在播放 → 继续播放
      if (sess.playing) {
        try {
          await getAudioEl().play()
        } catch (e) {}
      }
    }
  }

  // ============ 音量增强：静音切换 / 滚轮 / 统一 setVolume ============
  const ICON_MUTE = "M4 9v6h4l5 4V5L8 9H4zM16.5 9.5l5 5M21.5 9.5l-5 5"
  const ICON_LOW = "M4 9v6h4l5 4V5L8 9H4zM16 9.5a4 4 0 010 5"
  const ICON_HIGH = "M15.5 8.5a5 5 0 010 7M18.6 5.4a9 9 0 010 13.2M4 9v6h4l5 4V5L8 9H4z"
  let volumeBeforeMute = 0.8
  function syncVolumeIcon(v) {
    const icon = $("volumeIcon")
    if (!icon) return
    icon.setAttribute("d", v <= 0.001 ? ICON_MUTE : v < 0.5 ? ICON_LOW : ICON_HIGH)
  }
  function setVolume(v) {
    const audio = getAudioEl(), slider = $("npVolume")
    v = Math.max(0, Math.min(1, v))
    if (audio) audio.volume = v
    if (slider) slider.value = v
    const miniSlider = $("miniVolume")
    if (miniSlider) miniSlider.value = v
    const miniIcon = $("miniVolIcon")
    if (miniIcon)
      miniIcon
        .querySelector("path")
        .setAttribute("d", v <= 0.001 ? ICON_MUTE : v < 0.5 ? ICON_LOW : ICON_HIGH)
    localStorage.setItem(VOLUME_KEY, v)
    syncVolumeIcon(v)
  }
  function toggleMute() {
    const audio = getAudioEl()
    if (!audio) return
    if (audio.volume > 0.001) {
      volumeBeforeMute = audio.volume
      setVolume(0)
    } else {
      setVolume(volumeBeforeMute > 0.001 ? volumeBeforeMute : 0.8)
    }
  }
  function adjustVolume(delta) {
    const audio = getAudioEl()
    if (audio) setVolume(audio.volume + delta)
  }
  function initVolumeEx() {
    const slider = $("npVolume"), btn = $("volumeBtn")
    const wrap = document.querySelector(".np-volume")
    if (btn) btn.addEventListener("click", toggleMute)
    if (slider) {
      slider.addEventListener("input", () => syncVolumeIcon(parseFloat(slider.value)))
      syncVolumeIcon(parseFloat(slider.value))
    }
    if (wrap)
      wrap.addEventListener("wheel", (e) => {
        e.preventDefault()
        adjustVolume(e.deltaY < 0 ? 0.05 : -0.05)
      }, { passive: false })
  }

  // ============ 歌词字号 ============
  function applyLyricSize(size) {
    const s = ["small", "medium", "large"].includes(size) ? size : "medium"
    settings.lyricSize = s
    saveSettings()
    document.documentElement.dataset.lyricSize = s
  }
  function initLyricSize() {
    applyLyricSize(settings.lyricSize)
  }

  // ============ 歌词时间轴校正 ============
  function initLyricOffset() {
    const up = $("lyricOffsetUp"),
      down = $("lyricOffsetDown"),
      val = $("lyricOffsetVal")
    const sync = () => {
      if (!val) return
      const o = Player.getLyricOffset()
      val.textContent = (o > 0 ? "+" : "") + o.toFixed(1) + "s"
      val.classList.toggle("offset-active", Math.abs(o) > 0.01)
    }
    if (up)
      up.addEventListener("click", () => {
        Player.adjustLyricOffset(0.2)
        sync()
      })
    if (down)
      down.addEventListener("click", () => {
        Player.adjustLyricOffset(-0.2)
        sync()
      })
    sync()
  }

  // ============ 侧边栏折叠 / 展开 ============
  function initSidebarToggle() {
    const btn = $("sidebarToggle"), sb = $("sidebar")
    if (!btn || !sb) return
    const SIDEBAR_KEY = "sidebar-collapsed"
    if (localStorage.getItem(SIDEBAR_KEY) === "1") sb.classList.add("collapsed")
    btn.addEventListener("click", () => {
      const collapsed = sb.classList.toggle("collapsed")
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0")
    })
  }

  // ============ 拖放本地文件到窗口 ============
  function initFileDrop() {
    const overlay = document.createElement("div")
    overlay.className = "drop-overlay"
    overlay.innerHTML =
      '<div class="drop-card">' +
      '<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>' +
      '<div class="drop-title">松开以添加到播放队列</div>' +
      '<div class="drop-sub">支持 mp3 / flac / wav / m4a / ogg</div>' +
      "</div>"
    document.body.appendChild(overlay)
    let depth = 0
    const isFile = (e) => {
      const t = e.dataTransfer && e.dataTransfer.types
      if (!t) return false
      try {
        return Array.from(t).includes("Files")
      } catch {
        return false
      }
    }
    window.addEventListener("dragenter", (e) => {
      if (!isFile(e)) return
      e.preventDefault()
      depth++
      overlay.classList.add("show")
    })
    window.addEventListener("dragover", (e) => {
      if (isFile(e)) e.preventDefault()
    })
    window.addEventListener("dragleave", (e) => {
      if (!isFile(e)) return
      depth--
      if (depth <= 0) {
        depth = 0
        overlay.classList.remove("show")
      }
    })
    window.addEventListener("drop", async (e) => {
      if (!isFile(e)) return
      e.preventDefault()
      depth = 0
      overlay.classList.remove("show")
      const files = Array.from(e.dataTransfer.files || [])
      const paths = files.map((f) => f.path).filter(Boolean)
      if (!paths.length) {
        if (files.length) Player.toast("无法读取拖入文件的路径", "error")
        return
      }
      let res
      try {
        res = await window.ElectronAPI.importLocalSongs(paths)
      } catch (err) {
        Player.toast("导入失败：" + err.message, "error")
        return
      }
      const songs = (res && res.songs) || []
      if (!songs.length) {
        Player.toast("未发现可导入的音频文件", "error")
        return
      }
      let firstIdx = -1
      let added = 0
      songs.forEach((s) => {
        const cur = Player.getQueue()
        let idx = cur.findIndex((x) => x.id === s.id)
        if (idx < 0) {
          idx = cur.length
          Player.appendRaw(s)
          added++
        }
        if (firstIdx < 0) firstIdx = idx
      })
      if (firstIdx >= 0) Player.playAt(firstIdx)
      Player.toast(
        added ? "已添加 " + added + " 首本地歌曲" : "歌曲已在队列中",
        added ? "success" : "info"
      )
    })
  }

  // ============ 迷你模式 ============
  let miniBar = null
  function initMiniMode() {
    miniBar = document.createElement("div")
    miniBar.id = "miniBar"
    miniBar.className = "hidden"
    miniBar.innerHTML = `
      <img id="miniCover" class="mini-cover" src="" alt="">
      <div class="mini-meta">
        <div id="miniTitle" class="mini-title">未播放歌曲</div>
        <div id="miniArtist" class="mini-artist">--</div>
        <div class="mini-vol">
          <svg id="miniVolIcon" viewBox="0 0 24 24"><path d="${ICON_HIGH}"/></svg>
          <input type="range" id="miniVolume" min="0" max="1" step="0.01" value="0.8">
        </div>
      </div>
      <div class="mini-ctl">
        <button id="miniPrev" class="mini-btn" title="上一首"><svg viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7"/></svg></button>
        <button id="miniPlay" class="mini-btn mini-play" title="播放/暂停"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
        <button id="miniNext" class="mini-btn" title="下一首"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="mini-side">
        <button id="miniMenu" class="mini-btn" title="菜单"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
        <button id="miniRestore" class="mini-btn" title="还原"><svg viewBox="0 0 24 24"><path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7"/></svg></button>
      </div>
    `
    document.body.appendChild(miniBar)
    $("miniPrev").addEventListener("click", () => Player.prev())
    $("miniNext").addEventListener("click", () => Player.next())
    $("miniPlay").addEventListener("click", () => Player.toggle())
    $("miniRestore").addEventListener("click", () => setMini(false))

    // 迷你模式音量条：与主界面音量逻辑互通
    const miniVol = $("miniVolume")
    if (miniVol) {
      const savedVol = parseFloat(localStorage.getItem(VOLUME_KEY) || "0.8")
      const audio = getAudioEl()
      miniVol.value = isFinite(savedVol) ? savedVol : audio ? audio.volume : 0.8
      miniVol.addEventListener("input", () => setVolume(parseFloat(miniVol.value)))
      const icon = $("miniVolIcon")
      if (icon) icon.addEventListener("click", toggleMute)
      const volWrap = miniBar.querySelector(".mini-vol")
      if (volWrap)
        volWrap.addEventListener("wheel", (e) => {
          e.preventDefault()
          adjustVolume(e.deltaY < 0 ? 0.05 : -0.05)
        }, { passive: false })
    }

    // 迷你模式 ☰ 菜单
    let dlOpen = false
    if (API.onDesktopLyricsState) API.onDesktopLyricsState((open) => (dlOpen = !!open))
    $("miniMenu").addEventListener("click", (e) => {
      e.stopPropagation()
      // 二次点击收起菜单
      if (document.body.classList.contains("fp-menu-open")) {
        closeFpMenus()
        return
      }
      popupAt($("miniMenu"), [
        {
          label: dlOpen ? "隐藏桌面歌词" : "显示桌面歌词",
          onClick: () => API.toggleDesktopLyrics && API.toggleDesktopLyrics(),
        },
        {
          label: "打开设置",
          onClick: () => {
            setMini(false)
            setTimeout(() => {
              const b = $("settingsBtn")
              if (b) b.click()
            }, 150)
          },
        },
        { label: "退出迷你模式", onClick: () => setMini(false) },
      ])
    })

    const btn = $("miniBtn")
    if (btn) btn.addEventListener("click", () => setMini(!document.body.classList.contains("mini-mode")))

    const syncMini = () => {
      const s = Player.getCurrentSong()
      $("miniTitle").textContent = s ? s.name : "未播放歌曲"
      $("miniArtist").textContent = s ? s.artist : "--"
      const cover = s && s.coverUrl ? s.coverUrl : $("coverImg") ? $("coverImg").src : ""
      $("miniCover").src = cover
      const playing = Player.isPlaying()
      const path = $("miniPlay").querySelector("path")
      if (path)
        path.setAttribute("d", playing ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z")
    }
    Player.on("songchange", syncMini)
    Player.on("play", syncMini)
    Player.on("pause", syncMini)
  }
  function setMini(enter) {
    if (enter) {
      document.body.classList.add("mini-mode")
      miniBar.classList.remove("hidden")
    } else {
      // 退出迷你：先隐藏迷你条、主界面暂不恢复，等主进程扩展窗口完成
      //（window resize 事件）后再移除 mini-mode，让整页重排发生在最终
      // 窗口尺寸上，避免小窗口内整页布局 + resize 后二次布局的卡顿
      miniBar.classList.add("hidden")
      let guardTimer = 0
      const restore = () => {
        window.removeEventListener("resize", restore)
        clearTimeout(guardTimer)
        document.body.classList.remove("mini-mode")
      }
      window.addEventListener("resize", restore)
      guardTimer = setTimeout(restore, 350)
    }
    if (API.setMiniMode) API.setMiniMode(enter)
  }

  // ============ 睡眠定时 ============
  let sleepTimer = null
  let sleepDeadline = 0
  let sleepMode = null // 'minutes' | 'end' | null
  let sleepTick = 0
  function initSleep() {
    const btn = $("sleepBtn")
    if (!btn) return
    const render = () => {
      btn.classList.toggle("feature-on", sleepMode !== null)
      if (sleepMode === "minutes") {
        const s = Math.max(0, Math.round((sleepDeadline - Date.now()) / 1000))
        const mm = Math.floor(s / 60),
          ss = (s % 60).toString().padStart(2, "0")
        btn.title = `睡眠定时：${mm}:${ss} 后停止`
        if (s <= 0) triggerSleep()
      } else if (sleepMode === "end") {
        btn.title = "睡眠定时：当前歌曲播放完后停止"
      } else {
        btn.title = "睡眠定时"
      }
    }
    const open = () => {
      const opts = [
        { label: "关闭定时", active: sleepMode === null, onClick: clearSleep },
        { label: "15 分钟后", onClick: () => setMinutes(15) },
        { label: "30 分钟后", onClick: () => setMinutes(30) },
        { label: "45 分钟后", onClick: () => setMinutes(45) },
        { label: "60 分钟后", onClick: () => setMinutes(60) },
        { label: "自定义分钟…", onClick: askCustom },
        { label: "播完当前歌曲", active: sleepMode === "end", onClick: setEndMode },
      ]
      popupAt(btn, opts)
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      open()
    })
    function setMinutes(m) {
      clearSleep()
      sleepMode = "minutes"
      sleepDeadline = Date.now() + m * 60000
      sleepTick = setInterval(render, 1000)
      render()
      Player.toast(`已设置 ${m} 分钟后停止播放`, "info")
    }
    function askCustom() {
      popupInput(btn, "自定义睡眠（分钟）", (m) => setMinutes(m), "例如 20")
    }
    function setEndMode() {
      clearSleep()
      sleepMode = "end"
      render()
      Player.toast("将在当前歌曲播放完后停止", "info")
    }
    function triggerSleep() {
      Player.pause()
      clearSleep()
      Player.toast("睡眠定时已触发，播放已停止", "info")
    }
    function clearSleep() {
      if (sleepTick) clearInterval(sleepTick)
      sleepTick = 0
      sleepMode = null
      sleepDeadline = 0
      render()
    }
    // 播完当前：在歌曲末尾前暂停，避免进入下一首
    getAudioEl().addEventListener("timeupdate", () => {
      if (sleepMode !== "end") return
      const a = getAudioEl()
      if (isFinite(a.duration) && a.duration - a.currentTime < 0.6) {
        triggerSleep()
      }
    })
    window.__mpClearSleep = clearSleep
  }

  // ============ 桌面歌词 ============
  function initDesktopLyrics() {
    const btn = $("desktopLyricsBtn")
    if (!btn) return
    btn.addEventListener("click", () => {
      if (API.toggleDesktopLyrics) API.toggleDesktopLyrics()
    })
    if (API.onDesktopLyricsState) {
      API.onDesktopLyricsState((open) => {
        btn.classList.toggle("feature-on", !!open)
        // 桌面歌词打开时同步一次播放状态（控制条图标）
        if (open) sendDesktopLyricsPlayingState()
      })
    }
    // 播放/暂停状态同步到桌面歌词
    function sendDesktopLyricsPlayingState() {
      if (API.desktopLyricsPlayerState)
        API.desktopLyricsPlayerState(Player.isPlaying())
    }
    Player.on("play", sendDesktopLyricsPlayingState)
    Player.on("pause", sendDesktopLyricsPlayingState)
    // 桌面歌词窗口就绪后请求推送主题色
    if (API.onDesktopLyricsAccentRequest) {
      API.onDesktopLyricsAccentRequest(() => {
        if (API.desktopLyricsAccent)
          API.desktopLyricsAccent(settings.accent || "#1db954")
      })
    }
    Player.on("songchange", () => {
      // 切歌无歌词时清空
      if (API.desktopLyricsLine) API.desktopLyricsLine({ text: "", prev: "", next: "" })
    })
    Player.on("lyricchange", ({ lines, index }) => {
      if (!API.desktopLyricsLine) return
      const cur = lines[index]
      const text = cur ? cur.text || "" : ""
      const prev = lines[index - 1] ? lines[index - 1].text || "" : ""
      const next = lines[index + 1] ? lines[index + 1].text || "" : ""
      if (text) API.desktopLyricsLine({ text, prev, next, size: settings.lyricSize })
    })
  }

  // ============ 频谱可视化 ============
  function initSpectrum() {
    const lyrics = $("lyricsInterface")
    if (!lyrics) return
    const canvas = document.createElement("canvas")
    canvas.id = "spectrumCanvas"
    canvas.className = "spectrum-canvas"
    lyrics.appendChild(canvas)
    const ctx = canvas.getContext("2d")
    let raf = 0
    function hexRgba(hex, a) {
      let h = (hex || "").replace("#", "")
      if (h.length === 3) h = h.split("").map((c) => c + c).join("")
      const n = parseInt(h, 16)
      if (h.length !== 6 || isNaN(n)) return "rgba(29,185,84," + a + ")"
      return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"
    }
    function resize() {
      const dpr = window.devicePixelRatio || 1
      // 以 CSS 实际盒子为准同步内部分辨率（位置/高度由样式控制，避开底部播放栏）
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
      }
    }
    window.addEventListener("resize", resize)
    function clearCanvas() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    function ensureLoop() {
      if (raf) return
      raf = requestAnimationFrame(step)
    }
    // 歌词页从隐藏切换为可见时，重算画布尺寸并恢复绘制循环
    new MutationObserver(() => {
      if (!lyrics.classList.contains("hidden")) {
        resize()
        ensureLoop()
      }
    }).observe(lyrics, { attributes: true, attributeFilter: ["class"] })
    function step() {
      raf = 0
      // 不可见 / 未在播放时停止循环，避免空转 rAF 常驻占 CPU
      if (lyrics.classList.contains("hidden") || !AudioEngine.analyser) {
        clearCanvas()
        return
      }
      const audio = getAudioEl()
      if (!audio || audio.paused) {
        clearCanvas()
        return
      }
      if (canvas.width === 0) resize()
      if (canvas.width === 0) return
      AudioEngine.analyser.getByteFrequencyData(AudioEngine.freq)
      const w = canvas.width,
        h = canvas.height
      ctx.clearRect(0, 0, w, h)
      const dpr = window.devicePixelRatio || 1
      const bars = 64
      const gap = 2 * dpr
      const padX = 20 * dpr
      const usableW = w - padX * 2
      const bw = usableW / bars - gap
      const accent =
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1db954"
      for (let i = 0; i < bars; i++) {
        // 两侧能量轻微衰减，形成对称的“声波束”
        const edge = 1 - Math.abs(i / (bars - 1) - 0.5) * 0.5
        const v = AudioEngine.freq[Math.floor((i / bars) * AudioEngine.freq.length * 0.7)] / 255
        const bh = Math.max(1.5 * dpr, v * h * edge * 0.92)
        const x = padX + i * (bw + gap)
        const y = h - bh
        const grad = ctx.createLinearGradient(0, y, 0, h)
        grad.addColorStop(0, hexRgba(accent, 0.55))
        grad.addColorStop(1, hexRgba(accent, 0.04))
        ctx.fillStyle = grad
        const radius = Math.min(bw / 2, 2 * dpr)
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, radius)
        else ctx.rect(x, y, bw, bh)
        ctx.fill()
      }
      // 继续下一帧
      raf = requestAnimationFrame(step)
    }
    // 开始/恢复播放时确保绘制循环在跑（隐藏或暂停时循环会自行停下）
    Player.on("play", ensureLoop)
    resize()
    ensureLoop()
  }

  // ============ 淡入淡出（监听播放/时间更新）============
  function initFade() {
    const audio = getAudioEl()
    Player.on("play", () => {
      AudioEngine.resume()
      AudioEngine.ensure()
      if (settings.crossfade && AudioEngine.master) {
        AudioEngine.master.gain.setValueAtTime(0, AudioEngine.ctx.currentTime)
        AudioEngine.applyFade()
      }
    })
    audio.addEventListener("timeupdate", () => AudioEngine.applyFade())
  }

  // ============ A-B 片段循环（练习外语/乐器）============
  let abA = null, abB = null
  function fmtT(s) {
    if (!isFinite(s)) return "0:00"
    return Math.floor(s / 60) + ":" + Math.floor(s % 60).toString().padStart(2, "0")
  }
  function syncABButton() {
    const btn = $("abLoopBtn")
    if (!btn) return
    btn.classList.toggle("feature-on", abA !== null)
    if (abA === null) btn.title = "A-B 片段循环"
    else if (abB === null) btn.title = "已设 A 点，点击设置 B 点"
    else btn.title = "A-B 循环中（点击取消）"
  }
  function setABPoint() {
    const audio = getAudioEl()
    if (!audio || !isFinite(audio.currentTime)) return
    if (abA === null) {
      abA = audio.currentTime
      abB = null
      Player.toast("A 点：" + fmtT(abA), "info")
    } else if (abB === null) {
      const b = audio.currentTime
      if (b <= abA + 0.5) { Player.toast("B 点需在 A 点之后", "error"); return }
      abB = b
      Player.toast("A-B 循环：" + fmtT(abA) + " – " + fmtT(abB), "info")
    } else {
      abA = null; abB = null
      Player.toast("已取消 A-B 循环", "info")
    }
    syncABButton()
  }
  function resetAB() {
    abA = null; abB = null
    syncABButton()
  }
  function initABLoop() {
    const audio = getAudioEl()
    audio.addEventListener("timeupdate", () => {
      if (abA !== null && abB !== null && audio.currentTime >= abB) {
        audio.currentTime = abA
      }
    })
    const btn = $("abLoopBtn")
    if (btn) btn.addEventListener("click", setABPoint)
  }

  // ============ 队列拖拽排序 ============
  function initQueueDrag() {
    const list = $("playlistList")
    if (!list) return
    let fromIdx = -1
    let dragOverIdx = -1

    function makeDraggable() {
      list.querySelectorAll("li.song-item").forEach((li) => {
        li.draggable = true
        li.classList.add("queue-draggable")
      })
    }
    makeDraggable()
    // renderPlaylist 每次重建列表都会触发 childList 变更，
    // 仅用 MutationObserver 一条通道绑定，避免与 queuechange 重复执行
    new MutationObserver(makeDraggable).observe(list, { childList: true })

    list.addEventListener("dragstart", (e) => {
      const li = e.target.closest("li.song-item")
      if (!li) return
      fromIdx = parseInt(li.dataset.index, 10)
      li.classList.add("dragging")
      e.dataTransfer.effectAllowed = "move"
      try {
        e.dataTransfer.setData("text/plain", String(fromIdx))
      } catch (err) {}
    })
    list.addEventListener("dragend", (e) => {
      const li = e.target.closest("li.song-item")
      if (li) li.classList.remove("dragging")
      list.querySelectorAll(".drop-before").forEach((n) => n.classList.remove("drop-before"))
      fromIdx = -1
      dragOverIdx = -1
    })
    list.addEventListener("dragover", (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      const li = e.target.closest("li.song-item")
      list.querySelectorAll(".drop-before").forEach((n) => n.classList.remove("drop-before"))
      if (!li) return
      const idx = parseInt(li.dataset.index, 10)
      if (idx === fromIdx) return
      dragOverIdx = idx
      li.classList.add("drop-before")
    })
    list.addEventListener("drop", (e) => {
      e.preventDefault()
      const li = e.target.closest("li.song-item")
      if (!li || fromIdx < 0) return
      let to = parseInt(li.dataset.index, 10)
      if (to !== fromIdx) Player.reorder(fromIdx, to)
    })
    const dedupeBtn = $("dedupeQueueBtn")
    if (dedupeBtn) dedupeBtn.addEventListener("click", dedupeQueue)
    const clearBtn = $("clearQueueBtn")
    if (clearBtn)
      clearBtn.addEventListener("click", () => {
        confirmDialog(
          "清空播放列表",
          "确定要清空全部播放列表并停止播放吗？此操作不可撤销。",
          "清空",
          () => {
            Player.clearQueue()
            Player.toast("已清空播放列表", "success")
          }
        )
      })
  }

  // 播放队列按 id 去重（保留第一次出现）
  function dedupeQueue() {
    const q = Player.getQueue()
    const seen = new Set()
    const dupIdx = []
    q.forEach((s, i) => {
      if (seen.has(s.id)) dupIdx.push(i)
      else seen.add(s.id)
    })
    if (dupIdx.length === 0) { Player.toast("播放列表中没有重复歌曲", "info"); return }
    dupIdx.sort((a, b) => b - a).forEach((i) => Player.removeAt(i))
    Player.toast("已移除 " + dupIdx.length + " 首重复歌曲", "success")
  }

  // ============ 听歌统计 ============
  let stats = loadStats()
  let lastCountedId = null
  const songChangeLog = []
  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STATS_KEY) || "null")
      return s || { songs: {}, totalSeconds: 0, playCount: 0 }
    } catch {
      return { songs: {}, totalSeconds: 0, playCount: 0 }
    }
  }
  // 统计条目上限：超出时保留最常听的前若干条，防止 localStorage 无限膨胀
  const MAX_STAT_SONGS = 400
  function pruneStats() {
    const entries = Object.values(stats.songs || {})
    if (entries.length <= MAX_STAT_SONGS) return
    entries.sort((a, b) => b.count - a.count || b.seconds - a.seconds)
    const keep = new Set(
      entries.slice(0, MAX_STAT_SONGS).map((e) => String(e.id))
    )
    Object.keys(stats.songs).forEach((k) => {
      if (!keep.has(String(k))) delete stats.songs[k]
    })
  }
  function saveStatsDebounced() {
    clearTimeout(saveStatsDebounced.t)
    saveStatsDebounced.t = setTimeout(() => {
      pruneStats()
      localStorage.setItem(STATS_KEY, JSON.stringify(stats))
    }, 800)
  }
  function initStats() {
    Player.on("songchange", (song) => {
      songChangeLog.push({
        id: song && song.id,
        name: song && song.name,
        counted: !(song && lastCountedId === song.id),
        t: Date.now(),
      })
      if (!song || !song.id) return
      if (lastCountedId === song.id) return
      lastCountedId = song.id
      const key = song.id
      if (!stats.songs[key]) {
        stats.songs[key] = { id: song.id, name: song.name, artist: song.artist, count: 0, seconds: 0 }
      }
      stats.songs[key].count++
      stats.playCount++
      saveStatsDebounced()
    })
    // 播放时长累计
    setInterval(() => {
      if (!Player.isPlaying()) return
      const s = Player.getCurrentSong()
      if (!s || !s.id) return
      if (!stats.songs[s.id]) {
        stats.songs[s.id] = { id: s.id, name: s.name, artist: s.artist, count: 0, seconds: 0 }
      }
      stats.songs[s.id].seconds++
      stats.totalSeconds++
      saveStatsDebounced()
    }, 1000)

    const btn = $("statsBtn")
    if (btn) btn.addEventListener("click", openStats)
  }
  function fmtDur(sec) {
    sec = Math.floor(sec)
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h > 0) return h + "小时" + m + "分"
    if (m > 0) return m + "分" + s + "秒"
    return s + "秒"
  }
  function openStats() {
    const content = $("contentScroll")
    let sec = $("statsSection")
    if (!sec) {
      sec = document.createElement("section")
      sec.id = "statsSection"
      sec.className = "content-section"
      content.appendChild(sec)
      // 其他视图显示时自动隐藏统计（显隐通过 class，而非 hidden 属性）
      const hideIfOther = () => {
        if (
          !$("searchResultsSection").classList.contains("hidden") ||
          !$("playlistDetailSection").classList.contains("hidden")
        ) {
          sec.classList.add("hidden")
        }
      }
      new MutationObserver(hideIfOther).observe($("searchResultsSection"), {
        attributes: true,
        attributeFilter: ["class"],
      })
      new MutationObserver(hideIfOther).observe($("playlistDetailSection"), {
        attributes: true,
        attributeFilter: ["class"],
      })
    }
    $("searchResultsSection").classList.add("hidden")
    $("playlistDetailSection").classList.add("hidden")
    const home = $("homeSection")
    if (home) home.classList.add("hidden")
    const mineSec = $("mineSection")
    if (mineSec) mineSec.classList.add("hidden")
    const dmSec = $("downloadManagerSection")
    if (dmSec) dmSec.classList.add("hidden")
    sec.classList.remove("hidden")
    if (typeof Player.navRecord === "function")
      Player.navRecord("听歌统计", () => openStats())

    const entries = Object.values(stats.songs).sort((a, b) => b.count - a.count || b.seconds - a.seconds)
    const totalSongs = entries.length
    const top = entries.slice(0, 10)
    const artistMap = {}
    entries.forEach((s) => {
      const a = s.artist || "未知"
      artistMap[a] = (artistMap[a] || 0) + s.count
    })
    const topArtists = Object.entries(artistMap).sort((a, b) => b[1] - a[1]).slice(0, 5)

    sec.innerHTML = `
      <div class="stats-head">
        <h2>听歌统计</h2>
        <button class="btn btn-ghost" id="statsClearBtn">清空统计</button>
      </div>
      <div class="stats-cards">
        <div class="stat-card"><div class="stat-num">${stats.playCount}</div><div class="stat-label">总播放次数</div></div>
        <div class="stat-card"><div class="stat-num">${fmtDur(stats.totalSeconds)}</div><div class="stat-label">累计播放时长</div></div>
        <div class="stat-card"><div class="stat-num">${totalSongs}</div><div class="stat-label">听过的歌曲</div></div>
      </div>
      <div class="stats-cols">
        <div class="stats-col">
          <h3>最常听 Top 10</h3>
          <ul class="stats-list">
            ${
              top.length
                ? top
                    .map(
                      (s, i) => `
              <li class="stats-row"><span class="stats-rank">${i + 1}</span>
                <div class="stats-info"><div class="stats-name">${escapeHtml(s.name)}</div><div class="stats-artist">${escapeHtml(s.artist || "")}</div></div>
                <div class="stats-val">${s.count} 次 · ${fmtDur(s.seconds)}</div>
              </li>`
                    )
                    .join("")
                : '<li class="stats-empty">暂无记录，去播放歌曲吧</li>'
            }
          </ul>
        </div>
        <div class="stats-col">
          <h3>常听歌手</h3>
          <ul class="stats-list">
            ${
              topArtists.length
                ? topArtists
                    .map(
                      ([a, c]) =>
                        `<li class="stats-row"><div class="stats-info"><div class="stats-name">${escapeHtml(a)}</div></div><div class="stats-val">${c} 次</div></li>`
                    )
                    .join("")
                : '<li class="stats-empty">暂无数据</li>'
            }
          </ul>
        </div>
      </div>`
    $("statsClearBtn").addEventListener("click", () => {
      stats = { songs: {}, totalSeconds: 0, playCount: 0 }
      localStorage.setItem(STATS_KEY, JSON.stringify(stats))
      openStats()
    })
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }

  // ============ 发现 / 推荐首页 ============
  const homeSongMap = new Map()
  function playSongFromHome(song) {
    if (!song) return
    const q = Player.getQueue()
    let idx = q.findIndex((s) => String(s.id) === String(song.id))
    if (idx < 0) {
      Player.appendRaw(song)
      idx = Player.getQueue().length - 1
    }
    Player.playAt(idx)
  }
  let homeData = { recent: [], liked: [] }
  // ===== 热门榜单（go-music-dl toplist 能力）=====
  // 音源 Tab 会由 initSourceCaps() 按 /api/sources 能力表过滤，故用 let
  let TL_SOURCES = [
    ["netease", "网易"],
    ["qq", "QQ"],
    ["kugou", "酷狗"],
    ["kuwo", "酷我"],
    ["migu", "咪咕"],
    ["soda", "汽水"],
    ["apple", "Apple"],
  ]
  const toplistState = { source: "netease", lists: {}, loading: false }
  async function loadToplists(source) {
    if (toplistState.loading) return
    toplistState.loading = true
    try {
      const res = await window.ElectronAPI.musicDlToplists(source)
      if (res && Array.isArray(res.toplists)) {
        toplistState.lists[source] = res.toplists
      } else {
        toplistState.lists[source] = []
      }
    } catch (e) {
      toplistState.lists[source] = []
    } finally {
      toplistState.loading = false
      if (toplistState.source === source) renderHome()
    }
  }
  function switchToplistSource(source) {
    if (toplistState.source === source) return
    toplistState.source = source
    renderHome()
    if (!toplistState.lists[source]) loadToplists(source)
  }
  async function openToplist(t) {
    if (!t || !t.id) return
    Player.toast("正在加载榜单《" + t.name + "》", "info")
    let res
    try {
      res = await window.ElectronAPI.musicDlToplistSongs(
        t.source,
        String(t.id),
        t.name
      )
    } catch (e) {
      res = null
    }
    if (!res || res.error || !Array.isArray(res.songs)) {
      Player.toast("榜单加载失败：" + (res && res.error ? res.error : "未知错误"), "info")
      return
    }
    const songs = res.songs
      .map((s) => Player.enrichDlSong(Object.assign({}, s, { source: s.source || t.source })))
      .filter(Boolean)
    if (!songs.length) {
      Player.toast("该榜单暂无可用歌曲", "info")
      return
    }
    Player.openPlaylist(
      "toplist-" + t.source + "-" + t.id,
      t.name,
      songs,
      t.update_frequency || t.description || ""
    )
  }
  // ===== 为你推荐歌单（go-music-dl recommend 能力）=====
  let REC_SOURCES = [
    ["netease", "网易"],
    ["qq", "QQ"],
    ["kugou", "酷狗"],
    ["kuwo", "酷我"],
  ]
  const recState = { source: "netease", lists: {}, loading: false }
  async function loadRecommend(source) {
    if (recState.loading) return
    recState.loading = true
    try {
      const res = await window.ElectronAPI.musicDlRecommend(source)
      if (res && Array.isArray(res.playlists)) {
        recState.lists[source] = res.playlists
      } else {
        recState.lists[source] = []
      }
    } catch (e) {
      recState.lists[source] = []
    } finally {
      recState.loading = false
      if (recState.source === source) renderHome()
    }
  }
  function switchRecommendSource(source) {
    if (recState.source === source) return
    recState.source = source
    renderHome()
    if (!recState.lists[source]) loadRecommend(source)
  }
  async function openRecommendPlaylist(p) {
    if (!p || !p.id) return
    Player.toast("正在加载歌单《" + p.name + "》", "info")
    let res
    try {
      res = await window.ElectronAPI.musicDlPlaylistDetail(
        p.source || recState.source,
        String(p.id),
        p.name
      )
    } catch (e) {
      res = null
    }
    if (!res || res.error || !Array.isArray(res.songs)) {
      Player.toast("歌单加载失败：" + (res && res.error ? res.error : "未知错误"), "info")
      return
    }
    const songs = res.songs
      .map((s) => Player.enrichDlSong(Object.assign({}, s, { source: s.source || p.source })))
      .filter(Boolean)
    if (!songs.length) {
      Player.toast("该歌单暂无可用歌曲", "info")
      return
    }
    Player.openPlaylist(
      "rec-" + (p.source || recState.source) + "-" + p.id,
      p.name,
      songs,
      p.description || ""
    )
  }
  // ===== 歌单广场（go-music-dl 分类浏览能力）=====
  let SQ_SOURCES = [
    ["netease", "网易"],
    ["qq", "QQ"],
    ["kugou", "酷狗"],
    ["kuwo", "酷我"],
    ["migu", "咪咕"],
    ["qianqian", "千千"],
    ["joox", "JOOX"],
    ["soda", "汽水"],
    ["apple", "Apple"],
  ]
  const sqState = {
    source: "netease",
    cats: {},
    catId: {},
    lists: {},
    loadingCats: false,
    loadingList: false,
  }
  function sqCatKey(source, catId) {
    return source + "|" + (catId || "")
  }
  function sqDefaultCatId(cats) {
    if (!Array.isArray(cats) || !cats.length) return ""
    const all = cats.find((c) => !c.id && c.name)
    if (all) return ""
    const hot = cats.find((c) => c.id && c.hot)
    if (hot) return hot.id
    const first = cats.find((c) => c.id)
    return first ? first.id : ""
  }
  async function loadSquareCategories(source) {
    if (sqState.loadingCats) return
    sqState.loadingCats = true
    try {
      const res = await window.ElectronAPI.musicDlPlaylistCategories(source)
      if (res && Array.isArray(res.categories)) {
        sqState.cats[source] = res.categories
        if (sqState.catId[source] === undefined) {
          sqState.catId[source] = sqDefaultCatId(res.categories)
        }
      } else {
        sqState.cats[source] = []
      }
    } catch (e) {
      sqState.cats[source] = []
    } finally {
      sqState.loadingCats = false
      if (sqState.source === source) {
        renderHome()
        loadSquarePlaylists(source, sqState.catId[source])
      }
    }
  }
  async function loadSquarePlaylists(source, catId) {
    if (sqState.loadingList) return
    sqState.loadingList = true
    const key = sqCatKey(source, catId)
    try {
      const res = await window.ElectronAPI.musicDlCategoryPlaylists(
        source,
        catId,
        1,
        60
      )
      if (res && Array.isArray(res.playlists)) {
        sqState.lists[key] = res.playlists
      } else {
        sqState.lists[key] = []
      }
    } catch (e) {
      sqState.lists[key] = []
    } finally {
      sqState.loadingList = false
      if (sqState.source === source && sqState.catId[source] === catId) {
        renderHome()
      }
    }
  }
  function switchSquareSource(source) {
    if (sqState.source === source) return
    sqState.source = source
    renderHome()
    if (!sqState.cats[source]) {
      loadSquareCategories(source)
      return
    }
    const catId = sqState.catId[source]
    const key = sqCatKey(source, catId)
    if (!sqState.lists[key]) loadSquarePlaylists(source, catId)
  }
  function switchSquareCategory(catId) {
    const source = sqState.source
    if (sqState.catId[source] === catId) return
    sqState.catId[source] = catId
    renderHome()
    const key = sqCatKey(source, catId)
    if (!sqState.lists[key]) loadSquarePlaylists(source, catId)
  }
  async function openSquarePlaylist(p) {
    if (!p || !p.id) return
    Player.toast("正在加载歌单《" + p.name + "》", "info")
    let res
    try {
      res = await window.ElectronAPI.musicDlPlaylistDetail(
        p.source || sqState.source,
        String(p.id),
        p.name
      )
    } catch (e) {
      res = null
    }
    if (!res || res.error || !Array.isArray(res.songs)) {
      Player.toast("歌单加载失败：" + (res && res.error ? res.error : "未知错误"), "info")
      return
    }
    const songs = res.songs
      .map((s) => Player.enrichDlSong(Object.assign({}, s, { source: s.source || p.source })))
      .filter(Boolean)
    if (!songs.length) {
      Player.toast("该歌单暂无可用歌曲", "info")
      return
    }
    Player.openPlaylist(
      "sq-" + (p.source || sqState.source) + "-" + p.id,
      p.name,
      songs,
      p.description || ""
    )
  }
  function squareBlockHtml() {
    const tabs = SQ_SOURCES.map(
      ([id, label]) =>
        '<button class="tl-tab' +
        (id === sqState.source ? " active" : "") +
        '" data-sq-src="' + id + '">' + label + "</button>"
    ).join("")
    const cats = sqState.cats[sqState.source]
    let catHtml = ""
    if (!cats) {
      catHtml = '<div class="tl-empty">' + (sqState.loadingCats ? "分类加载中..." : " ") + "</div>"
    } else if (cats.length) {
      const cur = sqState.catId[sqState.source] || ""
      const sorted = cats.slice().sort((a, b) => {
        const av = a.id ? 1 : 0
        const bv = b.id ? 1 : 0
        if (av !== bv) return av - bv
        if (!!a.hot !== !!b.hot) return a.hot ? -1 : 1
        return 0
      })
      catHtml =
        '<div class="sq-cats">' +
        sorted.slice(0, 30).map((c) => {
          const active = (c.id || "") === cur && (cur === "" || !!c.id)
          return (
            '<button class="sq-cat' + (active ? " active" : "") + (c.hot ? " hot" : "") +
            '" data-sq-cat="' + escapeHtml(c.id || "") + '" title="' + escapeHtml(c.name) + '">' +
            escapeHtml(c.name) + "</button>"
          )
        }).join("") +
        "</div>"
    } else {
      catHtml = '<div class="tl-empty">该源暂无歌单分类</div>'
    }
    const catId = sqState.catId[sqState.source] || ""
    const key = sqCatKey(sqState.source, catId)
    const lists = sqState.lists[key]
    let body
    if (!lists) {
      body = '<div class="tl-empty">' + (sqState.loadingList ? "歌单加载中..." : " ") + "</div>"
    } else if (!lists.length) {
      body = '<div class="tl-empty">该分类暂无歌单（搜索服务未启动或该分类不可用）</div>'
    } else {
      body = lists.slice(0, 12).map((p, i) => {
        const cov = p.cover || ""
        const sub = p.play_count
          ? p.play_count >= 10000
            ? (p.play_count / 10000).toFixed(1) + "万播放"
            : p.play_count + "播放"
          : p.track_count
            ? p.track_count + "首"
            : ""
        return (
          '<div class="rec-card" data-sq-idx="' + i + '" title="' + escapeHtml(p.name) + '">' +
          '<div class="rec-card-cover">' +
          (cov
            ? '<img src="' + escapeHtml(cov) + '" alt="" loading="lazy">'
            : '<div class="home-card-note">' + NOTE_SVG + "</div>") +
          "</div>" +
          '<div class="rec-card-name">' + escapeHtml(p.name) + "</div>" +
          '<div class="rec-card-sub">' + escapeHtml(sub) + "</div>" +
          "</div>"
        )
      }).join("")
    }
    return (
      '<div class="home-block"><div class="home-block-head"><h3>歌单广场</h3>' +
      '<div class="tl-tabs">' + tabs + "</div></div>" +
      catHtml +
      '<div class="rec-grid">' + body + "</div></div>"
    )
  }
  function recommendBlockHtml() {
    const tabs = REC_SOURCES.map(
      ([id, label]) =>
        '<button class="tl-tab' +
        (id === recState.source ? " active" : "") +
        '" data-rec-src="' + id + '">' +
        label +
        "</button>"
    ).join("")
    const lists = recState.lists[recState.source]
    let body
    if (!lists) {
      body = '<div class="tl-empty">' + (recState.loading ? "推荐加载中..." : " ") + "</div>"
    } else if (!lists.length) {
      body = '<div class="tl-empty">暂无推荐（搜索服务未启动或该源不可用）</div>'
    } else {
      body = lists.slice(0, 12).map((p, i) => {
        const cov = p.cover || ""
        const sub = p.play_count
          ? p.play_count >= 10000
            ? (p.play_count / 10000).toFixed(1) + "万播放"
            : p.play_count + "播放"
          : p.track_count
            ? p.track_count + "首"
            : ""
        return (
          '<div class="rec-card" data-rec-idx="' + i + '" title="' + escapeHtml(p.name) + '">' +
          '<div class="rec-card-cover">' +
          (cov
            ? '<img src="' + escapeHtml(cov) + '" alt="" loading="lazy">'
            : '<div class="home-card-note">' + NOTE_SVG + "</div>") +
          "</div>" +
          '<div class="rec-card-name">' + escapeHtml(p.name) + "</div>" +
          '<div class="rec-card-sub">' + escapeHtml(sub) + "</div>" +
          "</div>"
        )
      }).join("")
    }
    return (
      '<div class="home-block"><div class="home-block-head"><h3>为你推荐</h3>' +
      '<div class="tl-tabs">' + tabs + "</div></div>" +
      '<div class="rec-grid">' + body + "</div></div>"
    )
  }
  function toplistBlockHtml() {
    const tabs = TL_SOURCES.map(
      ([id, label]) =>
        '<button class="tl-tab' +
        (id === toplistState.source ? " active" : "") +
        '" data-tl-src="' + id + '">' +
        label +
        "</button>"
    ).join("")
    const lists = toplistState.lists[toplistState.source]
    let body
    if (!lists) {
      body = '<div class="tl-empty">' + (toplistState.loading ? "榜单加载中..." : " ") + "</div>"
    } else if (!lists.length) {
      body = '<div class="tl-empty">暂无榜单（搜索服务未启动或该源不可用）</div>'
    } else {
      body = lists.slice(0, 10).map((t, i) => {
        const cov = t.cover || ""
        return (
          '<div class="tl-card" data-tl-idx="' + i + '" title="' + escapeHtml(t.name) + '">' +
          (cov
            ? '<img src="' + escapeHtml(cov) + '" alt="" loading="lazy">'
            : '<div class="tl-card-note">' + NOTE_SVG + "</div>") +
          '<div class="tl-card-veil"></div>' +
          '<div class="tl-card-meta"><div class="tl-card-name">' + escapeHtml(t.name) + "</div>" +
          '<div class="tl-card-freq">' + escapeHtml(t.update_frequency || (t.track_count ? t.track_count + "首" : "")) + "</div></div>" +
          "</div>"
        )
      }).join("")
    }
    return (
      '<div class="home-block"><div class="home-block-head"><h3>热门榜单</h3>' +
      '<div class="tl-tabs">' + tabs + "</div></div>" +
      '<div class="tl-grid">' + body + "</div></div>"
    )
  }
  async function loadHomeData() {
    try {
      const [recent, liked] = await Promise.all([
        window.ElectronAPI.readLatestPlayed(),
        window.ElectronAPI.readLikedSongs(),
      ])
      homeData.recent = Array.isArray(recent) ? recent.slice(0, 12) : []
      homeData.liked = Array.isArray(liked) ? liked.slice(0, 12) : []
    } catch (e) {}
  }
  function homeGreeting() {
    const h = new Date().getHours()
    if (h < 6) return "夜深了"
    if (h < 12) return "早上好"
    if (h < 14) return "中午好"
    if (h < 18) return "下午好"
    return "晚上好"
  }
  const NOTE_SVG =
    '<svg viewBox="0 0 24 24"><path d="M9 19V6l12-3v13M9 19c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 .895 3 3zm12-3c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 .895 3 3z"/></svg>'
  const PLAY_SVG =
    '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
  function homeCard(s) {
    const key = "h" + s.id
    homeSongMap.set(key, s)
    const cov = s.coverUrl || s.cover || ""
    return (
      '<div class="home-card" data-song-key="' + escapeHtml(key) + '">' +
      '<div class="home-card-cover">' +
      (cov
        ? '<img src="' + escapeHtml(cov) + '" alt="" loading="lazy">'
        : '<div class="home-card-note">' + NOTE_SVG + "</div>") +
      '<button class="home-card-play" data-home-play="' + key + '" title="播放">' +
      PLAY_SVG +
      "</button>" +
      "</div>" +
      '<div class="home-card-name">' + escapeHtml(s.name) + "</div>" +
      '<div class="home-card-artist">' + escapeHtml(s.artist || "") + "</div>" +
      "</div>"
    )
  }
  function renderHome() {
    const home = $("homeSection")
    if (!home) return
    homeSongMap.clear()
    const { recent, liked } = homeData
    const today = new Date()
    const dateStr =
      today.getFullYear() +
      "年" +
      (today.getMonth() + 1) +
      "月" +
      today.getDate() +
      "日"
    const quick = [
      ["likeSongsBtn", "我喜欢", liked.length + " 首", "M12 21s-7.5-4.6-9.5-8.5C1 9 2.5 5.5 6 5.5c2 0 3.5 1 4.5 2.5C11.5 6.5 13 5.5 15 5.5c3.5 0 5 3.5 3.5 7-2 3.9-9.5 8.5-9.5 8.5z"],
      ["recentPlayBtn", "最近播放", recent.length + " 首", "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"],
      ["localSongsBtn", "本地和下载", "本地音乐", "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"],
      ["followedSongsBtn", "关注歌手", "我的关注", "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"],
    ]
    const quickHtml = quick
      .map(
        ([id, label, sub, path]) =>
          '<button class="home-quick" data-quick="' + id + '">' +
          '<span class="home-quick-ic"><svg viewBox="0 0 24 24"><path d="' + path + '"/></svg></span>' +
          '<span class="home-quick-meta"><span class="home-quick-label">' +
          label +
          '</span><span class="home-quick-sub">' +
          sub +
          "</span></span></button>"
      )
      .join("")
    const block = (title, moreId, songs) =>
      songs.length
        ? '<div class="home-block"><div class="home-block-head"><h3>' +
          title +
          '</h3>' +
          (moreId
            ? '<button class="home-block-more" data-quick="' + moreId + '">查看全部</button>'
            : "") +
          '</div><div class="home-grid">' +
          songs.map(homeCard).join("") +
          "</div></div>"
        : ""
    const emptyHint =
      !recent.length && !liked.length
        ? '<div class="home-empty">还没有播放记录，去上方搜索喜欢的音乐吧</div>'
        : ""
    home.innerHTML =
      '<div class="home-hero"><div class="home-hero-text"><h2>' +
      homeGreeting() +
      '，欢迎回来</h2><p>' +
      dateStr +
      " · 今天也要好好听歌</p></div></div>" +
      '<div class="home-quick-grid">' +
      quickHtml +
      "</div>" +
      toplistBlockHtml() +
      recommendBlockHtml() +
      squareBlockHtml() +
      block("最近播放", "recentPlayBtn", recent.slice(0, 6)) +
      block("我喜欢的音乐", "likeSongsBtn", liked.slice(0, 6)) +
      emptyHint
  }
  function initHomePage() {
    const home = $("homeSection")
    if (!home) return
    home.addEventListener("click", (e) => {
      const recTab = e.target.closest("[data-rec-src]")
      if (recTab) {
        e.stopPropagation()
        switchRecommendSource(recTab.dataset.recSrc)
        return
      }
      const recCard = e.target.closest("[data-rec-idx]")
      if (recCard) {
        e.stopPropagation()
        const lists = recState.lists[recState.source] || []
        const p = lists[Number(recCard.dataset.recIdx)]
        if (p) {
          p.source = p.source || recState.source
          openRecommendPlaylist(p)
        }
        return
      }
      const tlTab = e.target.closest("[data-tl-src]")
      if (tlTab) {
        e.stopPropagation()
        switchToplistSource(tlTab.dataset.tlSrc)
        return
      }
      const tlCard = e.target.closest("[data-tl-idx]")
      if (tlCard) {
        e.stopPropagation()
        const lists = toplistState.lists[toplistState.source] || []
        const t = lists[Number(tlCard.dataset.tlIdx)]
        if (t) {
          t.source = t.source || toplistState.source
          openToplist(t)
        }
        return
      }
      const sqTab = e.target.closest("[data-sq-src]")
      if (sqTab) {
        e.stopPropagation()
        switchSquareSource(sqTab.dataset.sqSrc)
        return
      }
      const sqCat = e.target.closest("[data-sq-cat]")
      if (sqCat) {
        e.stopPropagation()
        switchSquareCategory(sqCat.dataset.sqCat)
        return
      }
      const sqCard = e.target.closest("[data-sq-idx]")
      if (sqCard) {
        e.stopPropagation()
        const catId = sqState.catId[sqState.source] || ""
        const lists = sqState.lists[sqCatKey(sqState.source, catId)] || []
        const p = lists[Number(sqCard.dataset.sqIdx)]
        if (p) {
          p.source = p.source || sqState.source
          openSquarePlaylist(p)
        }
        return
      }
      const play = e.target.closest("[data-home-play]")
      if (play) {
        e.stopPropagation()
        playSongFromHome(homeSongMap.get(play.dataset.homePlay))
        return
      }
      const quick = e.target.closest("[data-quick]")
      if (quick) {
        const btn = $(quick.dataset.quick)
        if (btn) btn.click()
        return
      }
      const card = e.target.closest("[data-song-key]")
      if (card) playSongFromHome(homeSongMap.get(card.dataset.songKey))
    })
    // 首页榜单/推荐/广场卡片右键：打开 / 播放 / 导入为自定义歌单
    home.addEventListener("contextmenu", (e) => {
      if (typeof Player.showOnlinePlaylistMenu !== "function") return
      const plLoadSongs = (p) => async () => {
        const res = await window.ElectronAPI.musicDlPlaylistDetail(
          p.source,
          String(p.id),
          p.name
        )
        if (!res || res.error || !Array.isArray(res.songs)) return null
        return res.songs
          .map((s) => Player.enrichDlSong(Object.assign({}, s, { source: s.source || p.source })))
          .filter(Boolean)
      }
      const tlCard = e.target.closest("[data-tl-idx]")
      if (tlCard) {
        const lists = toplistState.lists[toplistState.source] || []
        const t = lists[Number(tlCard.dataset.tlIdx)]
        if (t) {
          e.preventDefault()
          t.source = t.source || toplistState.source
          Player.showOnlinePlaylistMenu(e, {
            id: "toplist-" + t.source + "-" + t.id,
            name: t.name,
            description: t.update_frequency || t.description || "",
            loadSongs: async () => {
              const res = await window.ElectronAPI.musicDlToplistSongs(
                t.source,
                String(t.id),
                t.name
              )
              if (!res || res.error || !Array.isArray(res.songs)) return null
              return res.songs
                .map((s) =>
                  Player.enrichDlSong(Object.assign({}, s, { source: s.source || t.source }))
                )
                .filter(Boolean)
            },
          })
        }
        return
      }
      const recCard = e.target.closest("[data-rec-idx]")
      if (recCard) {
        const lists = recState.lists[recState.source] || []
        const p = lists[Number(recCard.dataset.recIdx)]
        if (p) {
          e.preventDefault()
          p.source = p.source || recState.source
          Player.showOnlinePlaylistMenu(e, {
            id: "rec-" + p.source + "-" + p.id,
            name: p.name,
            description: p.description || "",
            loadSongs: plLoadSongs(p),
          })
        }
        return
      }
      const sqCard = e.target.closest("[data-sq-idx]")
      if (sqCard) {
        const catId = sqState.catId[sqState.source] || ""
        const lists = sqState.lists[sqCatKey(sqState.source, catId)] || []
        const p = lists[Number(sqCard.dataset.sqIdx)]
        if (p) {
          e.preventDefault()
          p.source = p.source || sqState.source
          Player.showOnlinePlaylistMenu(e, {
            id: "sq-" + p.source + "-" + p.id,
            name: p.name,
            description: p.description || "",
            loadSongs: plLoadSongs(p),
          })
        }
      }
    })
    // 自动显隐：其他视图显示时隐藏首页
    const sync = () => {
      const other =
        !$("searchResultsSection").classList.contains("hidden") ||
        !$("playlistDetailSection").classList.contains("hidden") ||
        ($("statsSection") && !$("statsSection").classList.contains("hidden")) ||
        ($("mineSection") && !$("mineSection").classList.contains("hidden")) ||
        ($("downloadManagerSection") && !$("downloadManagerSection").classList.contains("hidden"))
      home.classList.toggle("hidden", other)
    }
    ;["searchResultsSection", "playlistDetailSection"].forEach((id) => {
      new MutationObserver(sync).observe($(id), {
        attributes: true,
        attributeFilter: ["class"],
      })
    })
    const refreshHome = async () => {
      await loadHomeData()
      renderHome()
    }
    Player.on("app-ready", () => {
      refreshHome()
      if (!toplistState.lists[toplistState.source]) {
        loadToplists(toplistState.source)
      }
      if (!recState.lists[recState.source]) {
        loadRecommend(recState.source)
      }
      if (!sqState.cats[sqState.source]) {
        loadSquareCategories(sqState.source)
      }
    })
    Player.on("songchange", () => refreshHome())
    // 点击品牌卡片回到首页（并计入导航历史）
    const sbUser = document.querySelector(".sb-user")
    if (sbUser) {
      sbUser.addEventListener("click", (e) => {
        if (e.target.closest(".icon-btn, button")) return
        if (typeof Player.navShowHome === "function") {
          Player.navShowHome()
          Player.navRecord("首页", () => Player.navShowHome())
        } else {
          $("searchResultsSection").classList.add("hidden")
          $("playlistDetailSection").classList.add("hidden")
          if ($("statsSection")) $("statsSection").classList.add("hidden")
          if ($("mineSection")) $("mineSection").classList.add("hidden")
          if ($("downloadManagerSection")) $("downloadManagerSection").classList.add("hidden")
        }
        refreshHome()
      })
    }
  }

  // ============ 智能歌单（按规则自动生成）============
  async function buildSmartPlaylist(kind) {
    const s = loadStats()
    const [latest, local, liked, queue] = await Promise.all([
      window.ElectronAPI.readLatestPlayed(),
      window.ElectronAPI.readLocalSongs(),
      window.ElectronAPI.readLikedSongs(),
      Promise.resolve(Player.getQueue()),
    ])
    const map = new Map()
    const addAll = (arr) =>
      (arr || []).forEach((x) => {
        if (x && x.id && x.url && !map.has(String(x.id))) map.set(String(x.id), x)
      })
    addAll(queue)
    addAll(latest)
    addAll(local)
    addAll(liked)
    if (kind === "topPlayed") {
      return Object.values(s.songs || {})
        .sort((a, b) => b.count - a.count || b.seconds - a.seconds)
        .map((r) => map.get(String(r.id)))
        .filter((x) => x)
        .slice(0, 30)
    }
    // recentAdded：按出现顺序去重（最近播放在前，队列/本地补充）
    const merged = [...(latest || []), ...(queue || []), ...(local || [])]
    const out = []
    const seen = new Set()
    merged.forEach((x) => {
      if (x && x.id && x.url && !seen.has(String(x.id))) {
        seen.add(String(x.id))
        out.push(x)
      }
    })
    return out.slice(0, 30)
  }
  function initSmartPlaylists() {
    const list = $("smartPlaylistList")
    if (!list) return
    list.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-smart]")
      if (!btn) return
      const kind = btn.dataset.smart
      const songs = await buildSmartPlaylist(kind)
      if (!songs.length) {
        Player.toast("暂无可生成的歌曲，先多听几首吧")
        return
      }
      const id = kind === "topPlayed" ? "smart-top" : "smart-added"
      const name = kind === "topPlayed" ? "最常播放" : "最近添加"
      Player.openSmartPlaylist(id, name, songs)
    })
  }

  // ============ 设置面板（含 EQ）============
  const ACCENTS = ["#1db954", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#ef4444"]

  // ===== 数据备份与恢复（设置 / 统计 / 收藏 / 歌单 / 历史）=====
  const BACKUP_LOCAL_KEYS = [
    "mp-settings", "mp-stats", "mp-volume", "mp-playmode",
    "mp-session", "selected-search-sources", "theme-mode",
    "searchHistory", "mp-lyric-offset", "dlSizeIdx", "mp-detail-view",
  ]
  function collectLocalData() {
    const out = {}
    BACKUP_LOCAL_KEYS.forEach((k) => {
      const v = localStorage.getItem(k)
      if (v !== null) out[k] = v
    })
    return out
  }
  function applyLocalData(local) {
    if (!local || typeof local !== "object") return
    BACKUP_LOCAL_KEYS.forEach((k) => {
      if (typeof local[k] === "string") localStorage.setItem(k, local[k])
    })
  }
  async function exportBackup() {
    const local = collectLocalData()
    const res = await window.ElectronAPI.exportUserInfo(local)
    if (res && res.success) Player.toast("备份已导出", "success")
    else if (res && res.error && !res.error.includes("取消")) Player.toast("导出失败：" + res.error, "error")
  }
  async function importBackup() {
    const res = await window.ElectronAPI.importUserInfo()
    if (!res || !res.success) {
      if (res && res.error && !res.error.includes("取消")) Player.toast("导入失败：" + res.error, "error")
      return
    }
    applyLocalData(res.local)
    Player.toast("备份已恢复，正在重启应用…", "success")
    setTimeout(() => window.location.reload(), 900)
  }

  function initSettings() {
    const btn = $("settingsBtn")
    if (!btn) return
    // 二次点击关闭：已打开时点击按钮 → 收起弹窗
    btn.addEventListener("click", () => {
      const layer = $("settingsModal")
      if (layer && !layer.classList.contains("hidden")) {
        layer.classList.add("hidden")
        return
      }
      openSettings()
    })
    applyAccent(settings.accent)
  }
  // 通用确认弹窗
  function confirmDialog(title, message, okLabel, onOk) {
    const layer = document.createElement("div")
    layer.className = "dialog-layer hidden"
    layer.innerHTML =
      '<div class="dialog dialog-sm">' +
      '<div class="dialog-head"><h3 class="dialog-title">' + title + '</h3></div>' +
      '<div class="dialog-body"><p class="confirm-msg">' + message + '</p></div>' +
      '<div class="dialog-foot-right">' +
      '<button class="btn btn-ghost" data-c>取消</button>' +
      '<button class="btn btn-danger" data-o>' + okLabel + '</button>' +
      '</div></div>'
    document.body.appendChild(layer)
    requestAnimationFrame(() => layer.classList.remove("hidden"))
    let fired = false
    const close = (fire) => {
      layer.classList.add("hidden")
      setTimeout(() => layer.remove(), 200)
      if (fire && !fired) { fired = true; onOk() }
    }
    layer.querySelector("[data-c]").addEventListener("click", () => close(false))
    layer.querySelector("[data-o]").addEventListener("click", () => close(true))
    layer.addEventListener("click", (e) => { if (e.target === layer) close(false) })
  }

  function openSettings() {
    document.querySelectorAll(".dialog-layer").forEach((d) => d.classList.add("hidden"))
    let layer = $("settingsModal")
    if (!layer) {
      layer = document.createElement("div")
      layer.id = "settingsModal"
      layer.className = "dialog-layer hidden"
      document.body.appendChild(layer)
      layer.addEventListener("click", (e) => {
        if (e.target === layer) layer.classList.add("hidden")
      })
    }
    layer.innerHTML = `
      <div class="dialog dialog-wide">
        <div class="dialog-head"><h3 class="dialog-title">音效与设置</h3>
          <button class="icon-btn" id="settingsClose"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>
        <div class="dialog-body">
          <section class="set-block">
            <h4>均衡器</h4>
            <div class="set-row">
              <label class="switch"><input type="checkbox" id="eqOn" ${settings.eqOn ? "checked" : ""}><span class="switch-track"></span>启用均衡器</label>
            </div>
            <div class="set-row">
              <label class="set-label">预设</label>
              <select id="eqPreset" class="set-select">
                <option value="flat">关闭 / 平直</option>
                <option value="pop">流行</option>
                <option value="rock">摇滚</option>
                <option value="vocal">人声增强</option>
                <option value="bass">重低音</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div class="eq-grid" id="eqGrid"></div>
          </section>
          <section class="set-block">
            <h4>播放效果</h4>
            <div class="set-row">
              <label class="switch"><input type="checkbox" id="xfOn" ${settings.crossfade ? "checked" : ""}><span class="switch-track"></span>淡入淡出（歌曲开头淡入、结尾淡出）</label>
            </div>
            <div class="set-row">
              <label class="set-label">时长 ${settings.fadeDur.toFixed(1)}s</label>
              <input type="range" id="xfDur" min="1" max="6" step="0.5" value="${settings.fadeDur}" class="set-range">
            </div>
            <div class="set-row set-col">
              <label class="set-label">播放速度 <span id="rateVal" class="set-value">${settings.playbackRate.toFixed(1)}×</span></label>
              <div class="seg-row" id="rateSeg">
                ${[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => `<button type="button" class="seg-btn ${Math.abs(settings.playbackRate - r) < 0.01 ? "on" : ""}" data-rate="${r}">${r}×</button>`).join("")}
              </div>
            </div>
            <div class="set-row">
              <label class="set-label">音量增益 <span id="gainVal" class="set-value">${Math.round(settings.gainBoost * 100)}%</span></label>
              <input type="range" id="gainRange" min="0.5" max="3" step="0.1" value="${settings.gainBoost}" class="set-range">
            </div>
            <div class="set-row">
              <label class="set-label">声道平衡 <span id="panVal" class="set-value">${settings.pan === 0 ? "居中" : settings.pan < 0 ? "偏左" : "偏右"}</span></label>
              <input type="range" id="panRange" min="-1" max="1" step="0.05" value="${settings.pan}" class="set-range">
            </div>
            <div class="set-row set-col">
              <label class="set-label">歌词字号</label>
              <div class="seg-row" id="lyricSizeSeg">
                ${[["small","小"],["medium","中"],["large","大"]].map(([v,l]) => `<button type="button" class="seg-btn ${settings.lyricSize===v?"on":""}" data-lyricsize="${v}">${l}</button>`).join("")}
              </div>
            </div>
          </section>
          <section class="set-block">
            <h4>通用</h4>
            <div class="set-row">
              <label class="switch"><input type="checkbox" id="notifyOn" ${settings.notifySong ? "checked" : ""}><span class="switch-track"></span>切歌时显示系统通知</label>
            </div>
            <div class="set-row">
              <button class="btn btn-ghost" id="openDlBtn">打开桌面歌词</button>
            </div>
            <div class="set-row set-col">
              <label class="set-label">数据备份（设置、统计、收藏、歌单、历史）</label>
              <div class="backup-row">
                <button class="btn btn-ghost" id="exportBackupBtn">导出备份</button>
                <button class="btn btn-ghost" id="importBackupBtn">导入恢复</button>
              </div>
            </div>
          </section>
          <section class="set-block">
            <h4>外观强调色</h4>
            <div class="accent-row">
              ${ACCENTS.map((c) => `<button class="accent-dot ${c === settings.accent ? "on" : ""}" data-c="${c}" style="background:${c}"></button>`).join("")}
            </div>
          </section>
          <section class="set-block">
            <h4>快捷键</h4>
            <ul class="hotkey-list">
              <li><span>播放 / 暂停</span><kbd>空格</kbd> / 媒体播放键</li>
              <li><span>上一首 / 下一首</span><kbd>媒体上一曲/下一曲键</kbd></li>
              <li><span>快进 / 快退</span><kbd>← / →</kbd>（Shift 为 15 秒）</li>
              <li><span>音量增 / 减</span><kbd>↑ / ↓</kbd></li>
              <li><span>静音 / 滚轮调音量</span><kbd>点击喇叭</kbd></li>
              <li><span>聚焦搜索</span><kbd>Ctrl / ⌘ + F</kbd></li>
              <li><span>关闭弹窗 / 抽屉 / 歌词</span><kbd>Esc</kbd></li>
            </ul>
          </section>
        </div>
        <div class="dialog-foot-right">
          <button class="btn btn-primary" id="settingsDone">完成</button>
        </div>
      </div>`
    document.body.appendChild(layer)

    // EQ 滑块
    const eqGrid = $("eqGrid")
    settings.eqGains.forEach((g, i) => {
      const band = document.createElement("div")
      band.className = "eq-band"
      band.innerHTML = `
        <span class="eq-db">${g > 0 ? "+" : ""}${g}</span>
        <input type="range" min="-12" max="12" step="1" value="${g}" data-band="${i}" orient="vertical">
        <span class="eq-freq">${EQ_FREQS[i] >= 1000 ? EQ_FREQS[i] / 1000 + "k" : EQ_FREQS[i]}</span>`
      eqGrid.appendChild(band)
    })
    const eqPreset = $("eqPreset")
    eqPreset.value = settings.eqPreset
    const refreshEqUI = () => {
      eqGrid.querySelectorAll("input").forEach((input, i) => {
        input.value = settings.eqGains[i]
        input.parentElement.querySelector(".eq-db").textContent =
          (settings.eqGains[i] > 0 ? "+" : "") + settings.eqGains[i]
      })
    }
    const syncEQ = () => {
      if (AudioEngine.ensure()) AudioEngine.applyEQ()
    }
    eqGrid.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        const i = parseInt(input.dataset.band, 10)
        settings.eqGains[i] = parseInt(input.value, 10)
        settings.eqPreset = "custom"
        eqPreset.value = "custom"
        input.parentElement.querySelector(".eq-db").textContent =
          (settings.eqGains[i] > 0 ? "+" : "") + settings.eqGains[i]
        saveSettings()
        syncEQ()
      })
    })
    $("eqOn").addEventListener("change", (e) => {
      settings.eqOn = e.target.checked
      if (settings.eqOn) AudioEngine.ensure()
      AudioEngine.applyEQ()
      saveSettings()
    })
    eqPreset.addEventListener("change", (e) => {
      const p = e.target.value
      settings.eqPreset = p
      if (p !== "custom") {
        settings.eqGains = EQ_PRESETS[p].slice()
        settings.eqOn = p !== "flat"
        $("eqOn").checked = settings.eqOn
        refreshEqUI()
      }
      saveSettings()
      syncEQ()
    })
    $("xfOn").addEventListener("change", (e) => {
      settings.crossfade = e.target.checked
      saveSettings()
      if (!settings.crossfade && AudioEngine.master)
        AudioEngine.master.gain.setTargetAtTime(1, AudioEngine.ctx.currentTime, 0.1)
    })
    $("xfDur").addEventListener("input", (e) => {
      settings.fadeDur = parseFloat(e.target.value)
      e.target.previousElementSibling.textContent = `时长 ${settings.fadeDur.toFixed(1)}s`
      saveSettings()
    })
    // 播放速度（分段按钮）
    layer.querySelectorAll("#rateSeg .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        settings.playbackRate = parseFloat(b.dataset.rate)
        layer.querySelectorAll("#rateSeg .seg-btn").forEach((x) => x.classList.toggle("on", x === b))
        $("rateVal").textContent = settings.playbackRate.toFixed(1) + "×"
        AudioEngine.ensure(); AudioEngine.applyPlaybackRate()
        saveSettings()
      })
    })
    // 歌词字号（分段按钮）
    layer.querySelectorAll("#lyricSizeSeg .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        applyLyricSize(b.dataset.lyricsize)
        layer.querySelectorAll("#lyricSizeSeg .seg-btn").forEach((x) =>
          x.classList.toggle("on", x === b)
        )
      })
    })
    // 音量增益
    $("gainRange").addEventListener("input", (e) => {
      settings.gainBoost = parseFloat(e.target.value)
      $("gainVal").textContent = Math.round(settings.gainBoost * 100) + "%"
      AudioEngine.ensure(); AudioEngine.applyBoost()
      saveSettings()
    })
    // 声道平衡
    $("panRange").addEventListener("input", (e) => {
      settings.pan = parseFloat(e.target.value)
      const v = settings.pan
      $("panVal").textContent = Math.abs(v) < 0.05 ? "居中" : v < 0 ? "偏左 " + Math.round(-v * 100) + "%" : "偏右 " + Math.round(v * 100) + "%"
      AudioEngine.ensure(); AudioEngine.applyPan()
      saveSettings()
    })
    $("notifyOn").addEventListener("change", (e) => {
      settings.notifySong = e.target.checked
      saveSettings()
    })
    $("openDlBtn").addEventListener("click", () => {
      if (API.toggleDesktopLyrics) API.toggleDesktopLyrics()
    })
    const eb = $("exportBackupBtn"), ib = $("importBackupBtn")
    if (eb) eb.addEventListener("click", () => exportBackup())
    if (ib) ib.addEventListener("click", () => importBackup())
    layer.querySelectorAll(".accent-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        settings.accent = dot.dataset.c
        applyAccent(settings.accent)
        saveSettings()
        layer.querySelectorAll(".accent-dot").forEach((d) => d.classList.toggle("on", d === dot))
      })
    })
    const close = () => layer.classList.add("hidden")
    $("settingsClose").addEventListener("click", close)
    $("settingsDone").addEventListener("click", close)
    layer.classList.remove("hidden")
    if (settings.eqOn) AudioEngine.ensure()
    AudioEngine.applyEQ()
  }

  // ============ 在线歌单（扫码登录 + 我的云歌单）============
  const MINE_SOURCES = [
    ["netease", "网易"],
    ["qq", "QQ"],
    ["kugou", "酷狗"],
  ]
  const mineState = {
    source: "netease",
    checked: {},
    logged: {},
    qr: null,
    qrStatus: "",
    polling: false,
    playlists: {},
    loadingLists: false,
  }
  function mineLabel(source) {
    const hit = MINE_SOURCES.find(([id]) => id === source)
    return hit ? hit[1] : source
  }
  function mineSectionEl() {
    return $("mineSection")
  }
  function openMineSection() {
    const content = $("contentScroll")
    let sec = mineSectionEl()
    if (!sec) {
      sec = document.createElement("section")
      sec.id = "mineSection"
      sec.className = "content-section"
      content.appendChild(sec)
      const hideIfOther = () => {
        if (
          !$("searchResultsSection").classList.contains("hidden") ||
          !$("playlistDetailSection").classList.contains("hidden")
        ) {
          sec.classList.add("hidden")
        }
      }
      new MutationObserver(hideIfOther).observe($("searchResultsSection"), {
        attributes: true,
        attributeFilter: ["class"],
      })
      new MutationObserver(hideIfOther).observe($("playlistDetailSection"), {
        attributes: true,
        attributeFilter: ["class"],
      })
      sec.addEventListener("click", (e) => {
        const tab = e.target.closest("[data-mine-src]")
        if (tab) {
          mineState.source = tab.dataset.mineSrc
          renderMineSection()
          afterMineSourceSwitch()
          return
        }
        const refresh = e.target.closest("[data-mine-qrrefresh]")
        if (refresh) {
          startQrLogin(mineState.source)
          return
        }
        const out = e.target.closest("[data-mine-logout]")
        if (out) {
          mineLogout(mineState.source)
          return
        }
        const card = e.target.closest("[data-mine-idx]")
        if (card) {
          const lists = mineState.playlists[mineState.source] || []
          const p = lists[Number(card.dataset.mineIdx)]
          if (p) {
            p.source = p.source || mineState.source
            openMinePlaylist(p)
          }
        }
      })
      // 云歌单卡片右键：打开 / 播放 / 导入为自定义歌单
      sec.addEventListener("contextmenu", (e) => {
        const card = e.target.closest("[data-mine-idx]")
        if (!card) return
        const lists = mineState.playlists[mineState.source] || []
        const p = lists[Number(card.dataset.mineIdx)]
        if (!p) return
        e.preventDefault()
        p.source = p.source || mineState.source
        if (typeof Player.showOnlinePlaylistMenu !== "function") return
        Player.showOnlinePlaylistMenu(e, {
          id: "mine-" + p.source + "-" + p.id,
          name: p.name,
          description: p.description || "",
          loadSongs: async () => {
            const res = await window.ElectronAPI.musicDlPlaylistDetail(
              p.source,
              String(p.id),
              p.name
            )
            if (!res || res.error || !Array.isArray(res.songs)) return null
            return res.songs
              .map((s) =>
                Player.enrichDlSong(Object.assign({}, s, { source: s.source || p.source }))
              )
              .filter(Boolean)
          },
        })
      })
    }
    $("searchResultsSection").classList.add("hidden")
    $("playlistDetailSection").classList.add("hidden")
    const home = $("homeSection")
    if (home) home.classList.add("hidden")
    const statsSec = $("statsSection")
    if (statsSec) statsSec.classList.add("hidden")
    const dmSec = $("downloadManagerSection")
    if (dmSec) dmSec.classList.add("hidden")
    sec.classList.remove("hidden")
    if (typeof Player.navRecord === "function")
      Player.navRecord("我的云歌单", () => openMineSection())
    renderMineSection()
    refreshMineStatuses()
  }
  function afterMineSourceSwitch() {
    const src = mineState.source
    if (!mineState.checked[src]) return
    if (mineState.logged[src]) {
      if (!mineState.playlists[src]) loadMinePlaylists(src)
      return
    }
    // 未登录：当前无会话或会话属于其他源时，自动生成新二维码
    if (!mineState.qr || mineState.qr.source !== src) {
      startQrLogin(src)
    }
  }
  async function refreshMineStatuses() {
    await Promise.all(
      MINE_SOURCES.map(async ([id]) => {
        let logged = false
        try {
          const res = await window.ElectronAPI.musicDlLoginStatus(id)
          logged = !!(res && res.logged_in)
        } catch (e) {
          logged = false
        }
        if (!logged) delete mineState.playlists[id]
        if (mineState.logged[id] && !logged) mineState.qr = null
        mineState.checked[id] = true
        mineState.logged[id] = logged
      })
    )
    const sec = mineSectionEl()
    if (!sec || sec.classList.contains("hidden")) return
    renderMineSection()
    const src = mineState.source
    if (mineState.logged[src]) {
      if (!mineState.playlists[src]) loadMinePlaylists(src)
    } else if (!mineState.qr || mineState.qr.source !== src) {
      startQrLogin(src)
    }
  }
  async function loadMinePlaylists(source) {
    if (mineState.loadingLists) return
    mineState.loadingLists = true
    renderMineSection()
    try {
      const res = await window.ElectronAPI.musicDlUserPlaylists(source, 1, 100)
      mineState.playlists[source] =
        res && Array.isArray(res.playlists) ? res.playlists : []
    } catch (e) {
      mineState.playlists[source] = []
    } finally {
      mineState.loadingLists = false
      const sec = mineSectionEl()
      if (sec && !sec.classList.contains("hidden")) renderMineSection()
    }
  }
  async function startQrLogin(source) {
    let res
    try {
      res = await window.ElectronAPI.musicDlQrCreate(source)
    } catch (e) {
      res = null
    }
    if (!res || res.error || !res.key || (!res.url && !res.image_url)) {
      mineState.qrStatus =
        "二维码创建失败：" + (res && res.error ? res.error : "未知错误")
      renderMineSection()
      return
    }
    let imgUrl = ""
    if (res.image_url) {
      // 部分源（如 QQ）直接返回 base64 二维码图
      imgUrl = res.image_url
    } else {
      try {
        imgUrl = await window.ElectronAPI.musicDlQrImageUrl(res.url, 240)
      } catch (e) {
        imgUrl = ""
      }
    }
    if (!imgUrl) {
      mineState.qrStatus = "二维码图片生成失败"
      renderMineSection()
      return
    }
    mineState.qr = { source, key: res.key, url: res.url || "", imgUrl }
    mineState.qrStatus = "等待扫码"
    renderMineSection()
    if (!mineState.polling) pollQrLogin()
  }
  async function pollQrLogin() {
    mineState.polling = true
    const tick = async () => {
      const qr = mineState.qr
      const sec = mineSectionEl()
      if (!qr || !sec || sec.classList.contains("hidden")) {
        mineState.polling = false
        return
      }
      let res
      try {
        res = await window.ElectronAPI.musicDlQrCheck(qr.source, qr.key)
      } catch (e) {
        res = null
      }
      if (!mineState.qr || mineState.qr.key !== qr.key) {
        mineState.polling = false
        return
      }
      const status = res && res.status ? String(res.status) : "failed"
      if (status === "success") {
        mineState.qr = null
        mineState.qrStatus = ""
        mineState.logged[qr.source] = true
        delete mineState.playlists[qr.source]
        Player.toast(mineLabel(qr.source) + "登录成功", "info")
        renderMineSection()
        loadMinePlaylists(qr.source)
        mineState.polling = false
        return
      }
      if (status === "expired" || status === "failed") {
        mineState.qrStatus = "二维码已过期，正在刷新..."
        renderMineSection()
        startQrLogin(qr.source)
        return
      }
      if (status === "scanned") mineState.qrStatus = "已扫码，请在手机上确认"
      const statusEl = document.getElementById("mineQrStatus")
      if (statusEl && mineState.qr) {
        statusEl.textContent = mineState.qrStatus
      }
      setTimeout(tick, 2500)
    }
    setTimeout(tick, 2500)
  }
  async function mineLogout(source) {
    let res
    try {
      res = await window.ElectronAPI.musicDlLogout(source)
    } catch (e) {
      res = null
    }
    if (res && res.ok) {
      mineState.logged[source] = false
      mineState.qr = null
      delete mineState.playlists[source]
      Player.toast("已退出" + mineLabel(source) + "登录", "info")
      renderMineSection()
      startQrLogin(source)
    } else {
      Player.toast("退出登录失败", "info")
    }
  }
  async function openMinePlaylist(p) {
    if (!p || !p.id) return
    Player.toast("正在加载歌单《" + p.name + "》", "info")
    let res
    try {
      res = await window.ElectronAPI.musicDlPlaylistDetail(
        p.source,
        String(p.id),
        p.name
      )
    } catch (e) {
      res = null
    }
    if (!res || res.error || !Array.isArray(res.songs)) {
      Player.toast("歌单加载失败：" + (res && res.error ? res.error : "未知错误"), "info")
      return
    }
    const songs = res.songs
      .map((s) =>
        Player.enrichDlSong(Object.assign({}, s, { source: s.source || p.source }))
      )
      .filter(Boolean)
    if (!songs.length) {
      Player.toast("该歌单暂无可用歌曲", "info")
      return
    }
    Player.openPlaylist(
      "mine-" + p.source + "-" + p.id,
      p.name,
      songs,
      p.description || ""
    )
  }
  function renderMineSection() {
    const sec = mineSectionEl()
    if (!sec) return
    const tabs = MINE_SOURCES.map(
      ([id, label]) =>
        '<button class="tl-tab' +
        (id === mineState.source ? " active" : "") +
        '" data-mine-src="' + id + '">' + label + "</button>"
    ).join("")
    const src = mineState.source
    const logged = !!mineState.logged[src]
    let body = ""
    if (!mineState.checked[src]) {
      body = '<div class="tl-empty">正在检查登录状态...</div>'
    } else if (logged) {
      const lists = mineState.playlists[src]
      if (!lists) {
        body =
          '<div class="tl-empty">' +
          (mineState.loadingLists ? "歌单加载中..." : " ") +
          "</div>"
      } else if (!lists.length) {
        body = '<div class="tl-empty">该账号暂无歌单</div>'
      } else {
        body =
          '<div class="rec-grid">' +
          lists
            .slice(0, 18)
            .map((p, i) => {
              const cov = p.cover || ""
              return (
                '<div class="rec-card" data-mine-idx="' + i + '" title="' + escapeHtml(p.name) + '">' +
                '<div class="rec-card-cover">' +
                (cov
                  ? '<img src="' + escapeHtml(cov) + '" alt="" loading="lazy">'
                  : '<div class="home-card-note">' + NOTE_SVG + "</div>") +
                "</div>" +
                '<div class="rec-card-name">' + escapeHtml(p.name) + "</div>" +
                '<div class="rec-card-sub">' + escapeHtml(p.track_count ? p.track_count + "首" : "") + "</div>" +
                "</div>"
              )
            })
            .join("") +
          "</div>"
      }
    } else {
      const qr = mineState.qr && mineState.qr.source === src ? mineState.qr : null
      body =
        '<div class="mine-qr-panel">' +
        (qr && qr.imgUrl
          ? '<img id="mineQrImg" class="mine-qr-img" alt="扫码登录二维码" src="' + escapeHtml(qr.imgUrl) + '">'
          : '<div class="mine-qr-img mine-qr-placeholder">' + NOTE_SVG + "</div>") +
        '<div class="mine-qr-side">' +
        '<div class="mine-qr-title">扫码登录' + mineLabel(src) + "账号</div>" +
        '<div id="mineQrStatus" class="mine-qr-status">' +
        escapeHtml(qr ? mineState.qrStatus : "点击下方按钮生成二维码") +
        "</div>" +
        '<div class="mine-qr-tip">打开' + mineLabel(src) + '音乐 App，使用扫一扫扫描二维码，登录后可查看你的云歌单</div>' +
        '<button class="btn btn-ghost" data-mine-qrrefresh="1">' +
        (qr ? "刷新二维码" : "生成二维码") +
        "</button></div></div>"
    }
    sec.innerHTML =
      '<div class="stats-head"><h2>在线歌单</h2>' +
      (logged
        ? '<button class="btn btn-ghost" data-mine-logout="1">退出' + mineLabel(src) + "登录</button>"
        : "") +
      "</div>" +
      '<div class="home-block-head"><h3>我的云歌单</h3><div class="tl-tabs">' + tabs + "</div></div>" +
      body
  }
  function initMinePlaylists() {
    const btn = $("minePlaylistsBtn")
    if (btn) btn.addEventListener("click", openMineSection)
  }

  // ============ 歌词导出（.lrc 文件）============
  function initExportLyric() {
    const btn = $("exportLyricBtn")
    if (!btn) return
    btn.addEventListener("click", async () => {
      const song = Player.getCurrentSong()
      if (!song || !song.id || !song.source) {
        Player.toast("当前歌曲不支持导出歌词", "info")
        return
      }
      btn.disabled = true
      try {
        const res = await window.ElectronAPI.musicDlDownloadLyric({
          id: String(song.id),
          source: song.source,
          name: song.name || "",
          artist: song.artist || "",
          album: song.album || "",
        })
        if (res && res.ok) {
          Player.toast("歌词已导出：" + res.path, "info")
        } else if (res && res.canceled) {
          // 用户取消
        } else {
          Player.toast("导出失败：" + (res && res.error ? res.error : "未知错误"), "info")
        }
      } catch (e) {
        Player.toast("导出失败：未知错误", "info")
      } finally {
        btn.disabled = false
      }
    })
  }

  // ============ 播放/切歌统一副作用 ============
  function initReactions() {
    Player.on("songchange", (song) => {
      updateMediaSession(song)
      notifySong(song)
    })
    Player.on("play", () => {
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"
    })
    Player.on("pause", () => {
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"
    })
  }

  // ============ 台架/调试钩子（只读内部状态，不改变外部 API）============
  window.__mpFeatures = {
    AudioEngine,
    getSettings: () => settings,
    getStats: () => stats,
    collectLocalData,
    applyLocalData,
    dedupeQueue,
    setVolume,
    adjustVolume,
    toggleMute,
    getSongChangeLog: () => songChangeLog.slice(),
    resetStats: () => {
      stats = { songs: {}, totalSeconds: 0, playCount: 0 }
      songChangeLog.length = 0
      lastCountedId = null
      localStorage.setItem(STATS_KEY, JSON.stringify(stats))
    },
  }

  // ============ 音源能力表（go-music-dl GET /api/sources）============
  // 按后端声明的能力过滤各版块的音源 Tab；过滤后为空则保留原数组兜底
  async function initSourceCaps(attempt) {
    const n = attempt || 1
    let res = null
    try {
      res = await window.ElectronAPI.musicDlSources()
    } catch (e) {
      res = null
    }
    if (!res || res.error || !Array.isArray(res.caps)) {
      // 搜索服务可能尚未启动：稍后重试（最多 3 次），期间沿用全量 Tab
      if (n < 3) setTimeout(() => initSourceCaps(n + 1), 8000)
      return
    }
    const capOf = (id) => res.caps.find((c) => c && c.name === id)
    const filterBy = (arr, field) => {
      const kept = arr.filter(([id]) => {
        const cap = capOf(id)
        return !!cap && !!cap[field]
      })
      return kept.length ? kept : arr.slice()
    }
    TL_SOURCES = filterBy(TL_SOURCES, "toplist")
    REC_SOURCES = filterBy(REC_SOURCES, "recommend")
    SQ_SOURCES = filterBy(SQ_SOURCES, "playlist")
    // 首页正在展示时刷新 Tab
    const home = $("homeSection")
    if (home && !home.classList.contains("hidden")) renderHome()
  }

  // ============ 启动 ============
  function start() {
    initMediaKeys()
    initSession()
    initLyricSize()
    initLyricOffset()
    initVolumeEx()
    initSidebarToggle()
    initFileDrop()
    initMiniMode()
    initSleep()
    initDesktopLyrics()
    initFade()
    initABLoop()
    initQueueDrag()
    initStats()
    initSettings()
    initHomePage()
    initMinePlaylists()
    initExportLyric()
    initSmartPlaylists()
    initReactions()
    initSourceCaps()
    // 频谱依赖歌词页 DOM，延迟初始化
    initSpectrum()
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start)
  } else {
    start()
  }
})()
