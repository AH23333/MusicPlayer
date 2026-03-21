import initialState from './state.js'
import actions from './actions.js'

class Store {
  constructor() {
    this.state = { ...initialState }
    this.listeners = []
  }

  // 获取状态
  getState() {
    return { ...this.state }
  }

  // 订阅状态变化
  subscribe(listener) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  // 执行动作
  dispatch(actionName, ...args) {
    if (actions[actionName]) {
      actions[actionName](this.state, ...args)
      this.notifyListeners()
    }
  }

  // 通知所有监听器
  notifyListeners() {
    this.listeners.forEach(listener => listener(this.getState()))
  }
}

// 导出单例
const store = new Store()
export default store