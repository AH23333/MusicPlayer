const axios = require("axios")

class MusicDlApi {
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
    })
  }

  // 搜索歌曲
  async search(keyword, sources = "netease", page = 1, limit = 10) {
    try {
      const response = await this.client.get("/search", {
        params: {
          q: keyword,
          sources,
          page,
          limit,
        },
      })
      return response.data
    } catch (error) {
      console.error("搜索歌曲失败:", error)
      throw error
    }
  }

  // 获取歌词
  async getLyric(id, source) {
    try {
      const response = await this.client.get("/lyric", {
        params: {
          id,
          source,
        },
      })
      return response.data
    } catch (error) {
      console.error("获取歌词失败:", error)
      throw error
    }
  }

  // 切换歌曲源
  async switchSource(name, artist, currentSource, targetSource, duration) {
    try {
      const response = await this.client.get("/switch_source", {
        params: {
          name,
          artist,
          current: currentSource,
          target: targetSource,
          duration,
        },
      })
      return response.data
    } catch (error) {
      console.error("切换歌曲源失败:", error)
      throw error
    }
  }

  // 检查歌曲可播放性
  async inspect(id, source, duration, extra) {
    try {
      const response = await this.client.get("/inspect", {
        params: {
          id,
          source,
          duration,
          extra,
        },
      })
      return response.data
    } catch (error) {
      console.error("检查歌曲可播放性失败:", error)
      throw error
    }
  }

  // 获取推荐歌单
  async getRecommend(sources = ["netease", "qq", "kugou", "kuwo"]) {
    try {
      const response = await this.client.get("/recommend", {
        params: {
          sources: sources.join(","),
        },
      })
      return response.data
    } catch (error) {
      console.error("获取推荐歌单失败:", error)
      throw error
    }
  }

  // 获取歌单详情
  async getPlaylistDetail(id, source) {
    try {
      const response = await this.client.get("/playlist", {
        params: {
          id,
          source,
        },
      })
      return response.data
    } catch (error) {
      console.error("获取歌单详情失败:", error)
      throw error
    }
  }
}

module.exports = MusicDlApi
