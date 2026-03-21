// 歌单详情页 UI 模块
class PlaylistDetailModule {
  constructor() {
    this.store = null;
    this.player = null;
    this.liked = null;
    this.playlist = null;
    this.detailElement = null;
    this.currentPlaylist = null;
  }

  init(store, player, liked, playlist) {
    this.store = store;
    this.player = player;
    this.liked = liked;
    this.playlist = playlist;
    this.detailElement = document.querySelector('.playlist-detail');
    this.bindEvents();
  }

  // 显示歌单详情
  show(playlist) {
    this.currentPlaylist = playlist;
    this.render();
  }

  // 渲染歌单详情
  render() {
    if (!this.detailElement || !this.currentPlaylist) return;

    // 渲染歌单信息
    this.renderPlaylistInfo();
    
    // 渲染歌曲列表
    this.renderSongList();
  }

  // 渲染歌单信息
  renderPlaylistInfo() {
    const infoSection = this.detailElement.querySelector('.playlist-info');
    if (infoSection) {
      infoSection.innerHTML = `
        <div class="playlist-cover w-32 h-32 bg-gray-200 rounded-md overflow-hidden">
          ${this.currentPlaylist.cover ? 
            `<img src="${this.currentPlaylist.cover}" alt="${this.currentPlaylist.name}" class="w-full h-full object-cover">` : 
            '<i class="bi bi-music-note text-4xl text-gray-400 flex items-center justify-center h-full"></i>'
          }
        </div>
        <div class="playlist-info-details">
          <h2 class="playlist-name text-2xl font-bold">${this.currentPlaylist.name}</h2>
          <p class="playlist-desc text-gray-500 mt-1">${this.currentPlaylist.description || '暂无描述'}</p>
          <div class="playlist-stats mt-2 text-sm text-gray-500">
            <span>${this.currentPlaylist.songs.length} 首歌曲</span>
          </div>
          <div class="playlist-actions mt-4">
            <button class="btn btn-primary play-all-btn">
              <i class="bi bi-play"></i> 播放全部
            </button>
            ${this.currentPlaylist.id !== 'liked' && this.currentPlaylist.id !== 'recent' && this.currentPlaylist.id !== 'local' && this.currentPlaylist.id !== 'followed' ? 
              `<button class="btn btn-outline edit-playlist-btn ml-2">
                <i class="bi bi-pencil"></i> 编辑
              </button>` : ''
            }
          </div>
        </div>
      `;

      // 绑定播放全部按钮事件
      const playAllBtn = infoSection.querySelector('.play-all-btn');
      if (playAllBtn) {
        playAllBtn.addEventListener('click', () => {
          this.playAll();
        });
      }

      // 绑定编辑按钮事件
      const editBtn = infoSection.querySelector('.edit-playlist-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          // 这里可以打开编辑歌单模态框
          console.log('编辑歌单:', this.currentPlaylist.id);
        });
      }
    }
  }

  // 渲染歌曲列表
  renderSongList() {
    const songList = this.detailElement.querySelector('.song-list');
    if (songList) {
      if (this.currentPlaylist.songs.length === 0) {
        songList.innerHTML = `
          <div class="empty-state text-center py-10">
            <i class="bi bi-music-note-beamed text-4xl text-gray-300"></i>
            <p class="mt-2 text-gray-500">暂无歌曲</p>
          </div>
        `;
        return;
      }

      songList.innerHTML = this.currentPlaylist.songs.map((song, index) => {
        const isLiked = this.store.getState().likedSongs.some(s => s.id === song.id);
        return `
          <div class="song-item" data-index="${index}" data-id="${song.id}">
            <div class="song-index w-8 text-center">${index + 1}</div>
            <div class="song-info flex-1">
              <div class="song-name">${song.name}</div>
              <div class="song-artist text-sm text-gray-500">${song.artist}</div>
            </div>
            <div class="song-duration w-16 text-right text-sm text-gray-500">
              ${song.duration || ''}
            </div>
            <div class="song-actions">
              <button class="action-btn like-btn ${isLiked ? 'liked' : ''}">
                <i class="bi ${isLiked ? 'bi-heart-fill text-red-500' : 'bi-heart'}"></i>
              </button>
              <button class="action-btn add-btn">
                <i class="bi bi-plus"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');

      // 绑定歌曲项事件
      this.bindSongItemEvents();
    }
  }

  // 绑定歌曲项事件
  bindSongItemEvents() {
    const songItems = this.detailElement.querySelectorAll('.song-item');
    songItems.forEach(item => {
      // 双击播放
      item.addEventListener('dblclick', () => {
        const index = parseInt(item.dataset.index);
        this.playSong(index);
      });

      // 点击喜欢按钮
      const likeBtn = item.querySelector('.like-btn');
      if (likeBtn) {
        likeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const songId = item.dataset.id;
          const song = this.currentPlaylist.songs.find(s => s.id === songId);
          if (song) {
            this.liked.toggleLike(song);
          }
        });
      }

      // 点击添加按钮
      const addBtn = item.querySelector('.add-btn');
      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const songId = item.dataset.id;
          const song = this.currentPlaylist.songs.find(s => s.id === songId);
          if (song) {
            this.playlist.addToPlaylist(song);
          }
        });
      }
    });
  }

  // 播放全部歌曲
  playAll() {
    if (this.currentPlaylist.songs.length > 0) {
      // 清空当前播放列表
      this.playlist.clearPlaylist();
      // 添加所有歌曲
      this.currentPlaylist.songs.forEach(song => {
        this.playlist.addToPlaylist(song);
      });
      // 播放第一首
      this.player.playSong(0);
    }
  }

  // 播放指定歌曲
  playSong(index) {
    if (index >= 0 && index < this.currentPlaylist.songs.length) {
      const song = this.currentPlaylist.songs[index];
      // 清空当前播放列表
      this.playlist.clearPlaylist();
      // 添加当前歌曲
      this.playlist.addToPlaylist(song);
      // 播放
      this.player.playSong(0);
    }
  }

  // 绑定事件
  bindEvents() {
    // 可以添加其他事件绑定
  }
}

const playlistDetail = new PlaylistDetailModule();
export default playlistDetail;