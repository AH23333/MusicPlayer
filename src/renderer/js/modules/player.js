import store from "../store/index.js"
import api from "../services/api.js"

class Player {
  constructor() {
    this.audioElement = document.getElementById("audioPlayer")
    this.currentLyrics = []
    this.init()
  }

  init() {
    // 绑定音频事件
    this.audioElement.addEventListener("ended", this.handleEnded.bind(this))
    this.audioElement.addEventListener(
      "timeupdate",
      this.handleTimeUpdate.bind(this)
    )
    this.audioElement.addEventListener("error", this.handleError.bind(this))
  }

  // 播放歌曲
  playSong(index) {
    const state = store.getState()
    const { playQueue, shuffledPlayQueue, playMode } = state

    if (playQueue.length === 0) {
      return
    }

    let song
    if (playMode === "shuffle") {
      // 确保shuffledPlayQueue已初始化
      if (shuffledPlayQueue.length === 0) {
        const shuffled = this.shuffleArray(playQueue)
        store.dispatch("setShuffledPlayQueue", shuffled)
      }

      if (index < 0 || index >= shuffledPlayQueue.length) {
        return
      }

      song = shuffledPlayQueue[index]
    } else {
      if (index < 0 || index >= playQueue.length) {
        return
      }

      song = playQueue[index]
    }

    this.audioElement.src = song.url
    this.audioElement.play()
    store.dispatch("setCurrentSongIndex", index)

    // 添加到最近播放
    store.dispatch("addToLatestPlayed", song)
    api.saveLatestPlayed(store.getState().latestPlayed)
  }

  // 播放/暂停
  togglePlayPause() {
    if (this.audioElement.paused) {
      this.audioElement.play()
    } else {
      this.audioElement.pause()
    }
  }

  // 随机打乱数组（Fisher-Yates 算法）
  shuffleArray(array) {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  // 上一首
  playPrevious() {
    const state = store.getState()
    const { playQueue, shuffledPlayQueue, currentSongIndex, playMode } = state

    if (playQueue.length === 0) return

    let newIndex
    switch (playMode) {
      case "order":
        newIndex = (currentSongIndex - 1 + playQueue.length) % playQueue.length
        break
      case "reverse":
        newIndex = (currentSongIndex + 1) % playQueue.length
        break
      case "shuffle":
        // 确保shuffledPlayQueue已初始化
        if (shuffledPlayQueue.length === 0) {
          const shuffled = this.shuffleArray(playQueue)
          store.dispatch("setShuffledPlayQueue", shuffled)
        }
        // 在打乱后的队列中按顺序播放
        newIndex =
          (currentSongIndex - 1 + shuffledPlayQueue.length) %
          shuffledPlayQueue.length
        break
      default:
        newIndex = (currentSongIndex - 1 + playQueue.length) % playQueue.length
    }

    this.playSong(newIndex)
  }

  // 下一首
  playNext() {
    const state = store.getState()
    const { playQueue, shuffledPlayQueue, currentSongIndex, playMode } = state

    if (playQueue.length === 0) return

    let newIndex
    switch (playMode) {
      case "order":
        newIndex = (currentSongIndex + 1) % playQueue.length
        break
      case "reverse":
        newIndex = (currentSongIndex - 1 + playQueue.length) % playQueue.length
        break
      case "shuffle":
        // 确保shuffledPlayQueue已初始化
        if (shuffledPlayQueue.length === 0) {
          const shuffled = this.shuffleArray(playQueue)
          store.dispatch("setShuffledPlayQueue", shuffled)
        }
        // 检查是否播放到了最后一首
        if (currentSongIndex >= shuffledPlayQueue.length - 1) {
          // 重新打乱并从头开始播放
          const shuffled = this.shuffleArray(playQueue)
          store.dispatch("setShuffledPlayQueue", shuffled)
          newIndex = 0
        } else {
          // 按顺序播放下一首
          newIndex = currentSongIndex + 1
        }
        break
      default:
        newIndex = (currentSongIndex + 1) % playQueue.length
    }

    this.playSong(newIndex)
  }

  // 处理歌曲结束
  handleEnded() {
    const state = store.getState()
    const { playMode } = state

    if (playMode === "singleLoop") {
      // 单曲循环
      this.audioElement.play()
    } else {
      // 其他模式播放下一首
      this.playNext()
    }
  }

  // 处理时间更新
  handleTimeUpdate() {
    // 触发歌词高亮更新
    if (typeof window.updateLyricHighlight === "function") {
      window.updateLyricHighlight(this.audioElement.currentTime)
    }
  }

  // 处理错误
  handleError() {
    console.error("音频播放错误:", this.audioElement.error)
  }

  // 设置音量
  setVolume(volume) {
    this.audioElement.volume = volume
  }

  // 设置播放进度
  setCurrentTime(time) {
    this.audioElement.currentTime = time
  }

  // 获取当前播放时间
  getCurrentTime() {
    return this.audioElement.currentTime
  }

  // 获取歌曲总时长
  getDuration() {
    return this.audioElement.duration
  }

  // 获取播放状态
  isPlaying() {
    return !this.audioElement.paused
  }

  // 加载歌词
  async loadLyrics(songId) {
    try {
      const lyrics = await api.fetchLyrics(songId)
      this.currentLyrics = lyrics
      return lyrics
    } catch (error) {
      console.error("加载歌词失败:", error)
      return { lrc: "", tlrc: "", metadata: [] }
    }
  }
}

export default new Player()
