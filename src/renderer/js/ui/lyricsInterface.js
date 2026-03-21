// 歌词浮窗 UI 模块
class LyricsInterfaceModule {
  constructor() {
    this.store = null;
    this.lyrics = null;
    this.interfaceElement = null;
    this.isVisible = false;
  }

  init(store, lyrics) {
    this.store = store;
    this.lyrics = lyrics;
    this.interfaceElement = document.querySelector('.lyrics-interface');
    this.bindEvents();
  }

  // 切换歌词浮窗显示状态
  toggle() {
    if (!this.interfaceElement) return;

    this.isVisible = !this.isVisible;
    if (this.isVisible) {
      this.interfaceElement.classList.remove('hidden');
      this.render();
    } else {
      this.interfaceElement.classList.add('hidden');
    }
  }

  // 渲染歌词浮窗
  render() {
    if (!this.interfaceElement || !this.isVisible) return;

    const state = this.store.getState();
    const currentSong = state.playQueue[state.currentSongIndex];
    const lyricsData = this.lyrics.getCurrentLyrics();

    this.interfaceElement.innerHTML = `
      <div class="lyrics-header flex items-center justify-between p-4 border-b">
        <div class="lyrics-song-info">
          <div class="lyrics-song-name font-medium">${currentSong ? currentSong.name : '未播放歌曲'}</div>
          <div class="lyrics-song-artist text-sm text-gray-500">${currentSong ? currentSong.artist : ''}</div>
        </div>
        <button class="lyrics-close-btn">
          <i class="bi bi-x"></i>
        </button>
      </div>
      <div class="lyrics-content p-4">
        <div class="lyrics-container h-64 overflow-y-auto">
          ${lyricsData.length > 0 ? 
            lyricsData.map((item, index) => `
              <div class="lyric-line py-1 text-center ${index === this.lyrics.getCurrentIndex() ? 'text-primary font-bold' : ''}">
                ${item.text}
              </div>
            `).join('') : 
            '<div class="text-center text-gray-500 py-10">暂无歌词</div>'
          }
        </div>
      </div>
    `;

    // 绑定关闭按钮事件
    const closeBtn = this.interfaceElement.querySelector('.lyrics-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.toggle();
      });
    }

    // 滚动到当前歌词
    this.scrollToCurrentLyric();
  }

  // 滚动到当前歌词
  scrollToCurrentLyric() {
    if (!this.interfaceElement) return;

    const container = this.interfaceElement.querySelector('.lyrics-container');
    const currentLine = container?.children[this.lyrics.getCurrentIndex()];
    if (currentLine) {
      container.scrollTop = currentLine.offsetTop - container.clientHeight / 2;
    }
  }

  // 更新歌词高亮
  updateLyricHighlight() {
    if (this.isVisible) {
      this.render();
    }
  }

  // 绑定事件
  bindEvents() {
    // 可以添加其他事件绑定
  }
}

const lyricsInterface = new LyricsInterfaceModule();
export default lyricsInterface;