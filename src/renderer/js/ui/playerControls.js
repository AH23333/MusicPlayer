// 底部播放器控件 UI 模块
class PlayerControlsModule {
  constructor() {
    this.store = null;
    this.player = null;
    this.lyricsInterface = null;
    this.playlistFloat = null;
    this.controlsElement = null;
  }

  init(store, player, lyricsInterface, playlistFloat) {
    this.store = store;
    this.player = player;
    this.lyricsInterface = lyricsInterface;
    this.playlistFloat = playlistFloat;
    this.controlsElement = document.querySelector('.player-controls');
    this.bindEvents();
    this.subscribeToStore();
  }

  // 渲染播放器控件
  render() {
    if (!this.controlsElement) return;

    const state = this.store.getState();
    const currentSong = state.playQueue[state.currentSongIndex];
    const isPlaying = state.isPlaying;
    const playMode = state.playMode;

    this.controlsElement.innerHTML = `
      <div class="player-left">
        <div class="current-song-cover w-12 h-12 bg-gray-200 rounded overflow-hidden">
          ${currentSong ? 
            `<img src="${currentSong.cover || 'https://via.placeholder.com/64'}" alt="${currentSong.name}" class="w-full h-full object-cover">` : 
            '<i class="bi bi-music-note text-2xl text-gray-400 flex items-center justify-center h-full"></i>'
          }
        </div>
        <div class="current-song-info ml-3">
          <div class="current-song-name text-sm font-medium">${currentSong ? currentSong.name : '未播放歌曲'}</div>
          <div class="current-song-artist text-xs text-gray-500">${currentSong ? currentSong.artist : ''}</div>
        </div>
      </div>
      <div class="player-center">
        <div class="playback-controls flex items-center justify-center">
          <button class="control-btn play-mode-btn" data-mode="${playMode}">
            <i class="bi ${this.getPlayModeIcon(playMode)}"></i>
          </button>
          <button class="control-btn prev-btn ml-4">
            <i class="bi bi-skip-backward"></i>
          </button>
          <button class="control-btn play-pause-btn ${isPlaying ? 'playing' : ''}">
            <i class="bi ${isPlaying ? 'bi-pause' : 'bi-play'}"></i>
          </button>
          <button class="control-btn next-btn ml-4">
            <i class="bi bi-skip-forward"></i>
          </button>
          <button class="control-btn lyrics-btn ml-4">
            <i class="bi bi-music-note-beamed"></i>
          </button>
        </div>
        <div class="progress-container mt-2">
          <div class="progress-bar bg-gray-200 rounded-full h-1 w-full">
            <div class="progress-fill bg-primary rounded-full h-1" style="width: 0%"></div>
          </div>
          <div class="time-info flex justify-between mt-1 text-xs text-gray-500">
            <span class="current-time">0:00</span>
            <span class="total-time">0:00</span>
          </div>
        </div>
      </div>
      <div class="player-right">
        <button class="control-btn volume-btn">
          <i class="bi bi-volume-up"></i>
        </button>
        <button class="control-btn playlist-btn ml-4">
          <i class="bi bi-list"></i>
        </button>
      </div>
    `;

    // 绑定控件事件
    this.bindControlEvents();
  }

  // 获取播放模式图标
  getPlayModeIcon(mode) {
    switch (mode) {
      case 'loop':
        return 'bi-repeat';
      case 'shuffle':
        return 'bi-shuffle';
      case 'single':
        return 'bi-repeat-1';
      default:
        return 'bi-repeat';
    }
  }

  // 绑定控件事件
  bindControlEvents() {
    // 播放/暂停按钮
    const playPauseBtn = this.controlsElement.querySelector('.play-pause-btn');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        this.player.togglePlay();
      });
    }

    // 上一首按钮
    const prevBtn = this.controlsElement.querySelector('.prev-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.player.playPrevious();
      });
    }

    // 下一首按钮
    const nextBtn = this.controlsElement.querySelector('.next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.player.playNext();
      });
    }

    // 播放模式按钮
    const playModeBtn = this.controlsElement.querySelector('.play-mode-btn');
    if (playModeBtn) {
      playModeBtn.addEventListener('click', () => {
        this.player.togglePlayMode();
      });
    }

    // 歌词按钮
    const lyricsBtn = this.controlsElement.querySelector('.lyrics-btn');
    if (lyricsBtn) {
      lyricsBtn.addEventListener('click', () => {
        this.lyricsInterface.toggle();
      });
    }

    // 播放列表按钮
    const playlistBtn = this.controlsElement.querySelector('.playlist-btn');
    if (playlistBtn) {
      playlistBtn.addEventListener('click', () => {
        this.playlistFloat.toggle();
      });
    }

    // 音量按钮
    const volumeBtn = this.controlsElement.querySelector('.volume-btn');
    if (volumeBtn) {
      volumeBtn.addEventListener('click', () => {
        // 这里可以打开音量控制弹窗
        console.log('切换音量控制');
      });
    }

    // 进度条
    const progressBar = this.controlsElement.querySelector('.progress-bar');
    if (progressBar) {
      progressBar.addEventListener('click', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const position = (e.clientX - rect.left) / rect.width;
        this.player.seekTo(position);
      });
    }
  }

  // 更新进度条
  updateProgress(currentTime, duration) {
    const progressFill = this.controlsElement.querySelector('.progress-fill');
    const currentTimeEl = this.controlsElement.querySelector('.current-time');
    const totalTimeEl = this.controlsElement.querySelector('.total-time');

    if (progressFill) {
      const percentage = (currentTime / duration) * 100;
      progressFill.style.width = `${percentage}%`;
    }

    if (currentTimeEl) {
      currentTimeEl.textContent = this.formatTime(currentTime);
    }

    if (totalTimeEl) {
      totalTimeEl.textContent = this.formatTime(duration);
    }
  }

  // 格式化时间
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // 绑定事件
  bindEvents() {
    // 可以添加其他事件绑定
  }

  // 订阅 store 变化
  subscribeToStore() {
    this.store.subscribe(() => {
      this.render();
    });
  }
}

const playerControls = new PlayerControlsModule();
export default playerControls;