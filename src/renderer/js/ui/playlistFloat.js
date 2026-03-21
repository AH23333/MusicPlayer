// 播放列表浮窗 UI 模块
class PlaylistFloatModule {
  constructor() {
    this.store = null;
    this.player = null;
    this.liked = null;
    this.playlist = null;
    this.floatElement = null;
    this.isVisible = false;
  }

  init(store, player, liked, playlist) {
    this.store = store;
    this.player = player;
    this.liked = liked;
    this.playlist = playlist;
    this.floatElement = document.querySelector('.playlist-float');
    this.bindEvents();
    this.subscribeToStore();
  }

  // 切换播放列表浮窗显示状态
  toggle() {
    if (!this.floatElement) return;

    this.isVisible = !this.isVisible;
    if (this.isVisible) {
      this.floatElement.classList.remove('hidden');
      this.render();
    } else {
      this.floatElement.classList.add('hidden');
    }
  }

  // 渲染播放列表浮窗
  render() {
    if (!this.floatElement || !this.isVisible) return;

    const state = this.store.getState();
    const playQueue = state.playQueue;
    const currentIndex = state.currentSongIndex;

    this.floatElement.innerHTML = `
      <div class="playlist-float-header flex items-center justify-between p-4 border-b">
        <h3 class="playlist-float-title font-medium">播放列表</h3>
        <div class="playlist-float-actions">
          <button class="action-btn clear-btn">
            <i class="bi bi-trash"></i>
          </button>
          <button class="action-btn close-btn ml-2">
            <i class="bi bi-x"></i>
          </button>
        </div>
      </div>
      <div class="playlist-float-content">
        ${playQueue.length > 0 ? `
          <div class="playqueue-list">
            ${playQueue.map((song, index) => {
              const isCurrent = index === currentIndex;
              const isLiked = state.likedSongs.some(s => s.id === song.id);
              return `
                <div class="playqueue-item ${isCurrent ? 'current' : ''}" data-index="${index}" data-id="${song.id}">
                  <div class="playqueue-index w-8 text-center">
                    ${isCurrent ? '<i class="bi bi-play-fill text-primary"></i>' : index + 1}
                  </div>
                  <div class="playqueue-info flex-1">
                    <div class="playqueue-name">${song.name}</div>
                    <div class="playqueue-artist text-sm text-gray-500">${song.artist}</div>
                  </div>
                  <div class="playqueue-actions">
                    <button class="action-btn like-btn ${isLiked ? 'liked' : ''}">
                      <i class="bi ${isLiked ? 'bi-heart-fill text-red-500' : 'bi-heart'}"></i>
                    </button>
                    <button class="action-btn remove-btn ml-2">
                      <i class="bi bi-x"></i>
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="empty-state text-center py-10">
            <i class="bi bi-music-note-beamed text-4xl text-gray-300"></i>
            <p class="mt-2 text-gray-500">播放列表为空</p>
          </div>
        `}
      </div>
    `;

    // 绑定事件
    this.bindFloatEvents();
  }

  // 绑定浮窗事件
  bindFloatEvents() {
    // 关闭按钮
    const closeBtn = this.floatElement.querySelector('.close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.toggle();
      });
    }

    // 清空按钮
    const clearBtn = this.floatElement.querySelector('.clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.playlist.clearPlaylist();
      });
    }

    // 播放队列项事件
    const playqueueItems = this.floatElement.querySelectorAll('.playqueue-item');
    playqueueItems.forEach(item => {
      // 点击播放
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        this.player.playSong(index);
      });

      // 点击喜欢按钮
      const likeBtn = item.querySelector('.like-btn');
      if (likeBtn) {
        likeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const songId = item.dataset.id;
          const song = this.store.getState().playQueue.find(s => s.id === songId);
          if (song) {
            this.liked.toggleLike(song);
          }
        });
      }

      // 点击移除按钮
      const removeBtn = item.querySelector('.remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = parseInt(item.dataset.index);
          this.playlist.removeFromPlaylist(index);
        });
      }
    });
  }

  // 绑定事件
  bindEvents() {
    // 可以添加其他事件绑定
  }

  // 订阅 store 变化
  subscribeToStore() {
    this.store.subscribe(() => {
      if (this.isVisible) {
        this.render();
      }
    });
  }
}

const playlistFloat = new PlaylistFloatModule();
export default playlistFloat;