import store from '../store/index.js'
import api from '../services/api.js'

class Search {
  constructor() {
    this.pageSize = 20
  }

  // 搜索音乐
  async search(keyword, offset = 0) {
    if (!keyword) return []

    try {
      store.dispatch('setLoadingMore', true)
      const results = await api.searchMusic(keyword, offset)
      
      if (offset === 0) {
        // 新搜索，替换结果
        store.dispatch('setSearchResults', results)
      } else {
        // 加载更多，追加结果
        store.dispatch('addSearchResults', results)
      }

      // 更新偏移量
      store.dispatch('setSearchOffset', offset + this.pageSize)
      
      // 检查是否有更多结果
      store.dispatch('setHasMore', results.length === this.pageSize)
      
      // 添加到搜索历史
      store.dispatch('addSearchHistory', keyword)
      await api.saveSearchHistory(store.getState().searchHistory)
      
      return results
    } catch (error) {
      console.error('搜索失败:', error)
      return []
    } finally {
      store.dispatch('setLoadingMore', false)
    }
  }

  // 加载更多搜索结果
  async loadMore(keyword) {
    const state = store.getState()
    const { searchOffset, loadingMore, hasMore } = state
    
    if (loadingMore || !hasMore) return
    
    await this.search(keyword, searchOffset)
  }

  // 清空搜索结果
  clearResults() {
    store.dispatch('setSearchResults', [])
    store.dispatch('setSearchOffset', 0)
    store.dispatch('setHasMore', true)
  }

  // 获取搜索结果
  getResults() {
    const state = store.getState()
    return state.searchResults
  }

  // 获取搜索历史
  async getSearchHistory() {
    try {
      const history = await api.readSearchHistory()
      store.dispatch('setSearchHistory', history)
      return history
    } catch (error) {
      console.error('获取搜索历史失败:', error)
      return []
    }
  }

  // 清空搜索历史
  async clearSearchHistory() {
    store.dispatch('clearSearchHistory')
    await api.saveSearchHistory([])
  }

  // 删除单个搜索历史
  async removeSearchHistoryItem(keyword) {
    const state = store.getState()
    const newHistory = state.searchHistory.filter(item => item !== keyword)
    store.dispatch('setSearchHistory', newHistory)
    await api.saveSearchHistory(newHistory)
  }

  // 从搜索历史中搜索
  async searchFromHistory(keyword) {
    this.clearResults()
    return await this.search(keyword)
  }
}

export default new Search()