// 歌词模块
class LyricsModule {
  constructor() {
    this.currentLyrics = [];
    this.currentIndex = -1;
    this.apiService = null;
    this.store = null;
  }

  init(store, apiService) {
    this.store = store;
    this.apiService = apiService;
  }

  // 获取歌词
  async fetchLyrics(songName, artist) {
    try {
      const lyrics = await this.apiService.fetchLyrics(songName, artist);
      if (lyrics) {
        this.currentLyrics = this.parseLyrics(lyrics);
        this.currentIndex = -1;
        return this.currentLyrics;
      }
      return [];
    } catch (error) {
      console.error('获取歌词失败:', error);
      return [];
    }
  }

  // 解析歌词
  parseLyrics(lyricsText) {
    const lyrics = [];
    const lines = lyricsText.split('\n');
    const timeRegex = /\[(\d{2}):(\d{2}\.\d{2,3})\]/g;

    lines.forEach(line => {
      const times = [];
      let match;
      while ((match = timeRegex.exec(line)) !== null) {
        const minutes = parseInt(match[1]);
        const seconds = parseFloat(match[2]);
        const totalSeconds = minutes * 60 + seconds;
        times.push(totalSeconds);
      }

      const text = line.replace(timeRegex, '').trim();
      if (text) {
        times.forEach(time => {
          lyrics.push({ time, text });
        });
      }
    });

    // 按时间排序
    lyrics.sort((a, b) => a.time - b.time);
    return lyrics;
  }

  // 更新歌词高亮
  updateLyricHighlight(currentTime) {
    if (!this.currentLyrics.length) return -1;

    let newIndex = -1;
    for (let i = this.currentLyrics.length - 1; i >= 0; i--) {
      if (this.currentLyrics[i].time <= currentTime) {
        newIndex = i;
        break;
      }
    }

    if (newIndex !== this.currentIndex) {
      this.currentIndex = newIndex;
    }

    return this.currentIndex;
  }

  // 渲染歌词到容器
  renderLyrics(container, lyrics = this.currentLyrics) {
    if (!container) return;

    container.innerHTML = '';
    
    lyrics.forEach((item, index) => {
      const line = document.createElement('div');
      line.className = 'lyric-line py-1 text-center';
      line.textContent = item.text;
      if (index === this.currentIndex) {
        line.classList.add('text-primary', 'font-bold');
      }
      container.appendChild(line);
    });

    // 滚动到当前歌词
    if (this.currentIndex >= 0) {
      const currentLine = container.children[this.currentIndex];
      if (currentLine) {
        container.scrollTop = currentLine.offsetTop - container.clientHeight / 2;
      }
    }
  }

  // 清除当前歌词
  clearLyrics() {
    this.currentLyrics = [];
    this.currentIndex = -1;
  }

  // 获取当前歌词
  getCurrentLyrics() {
    return this.currentLyrics;
  }

  // 获取当前歌词索引
  getCurrentIndex() {
    return this.currentIndex;
  }
}

const lyrics = new LyricsModule();
export default lyrics;