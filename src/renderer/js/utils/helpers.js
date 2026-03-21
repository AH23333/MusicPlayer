// 通用工具函数

// 时间格式化
export function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// 歌词时间戳解析
export function parseLyricTimestamp(timestamp) {
  const match = timestamp.match(/(\d+):(\d+)(?:\.(\d+))?/)
  if (!match) return 0
  const [, minutes, seconds, milliseconds] = match
  return parseInt(minutes) * 60 + parseInt(seconds) + (parseInt(milliseconds || 0) / 1000)
}

// 解析歌词
export function parseLyrics(lyricText) {
  if (!lyricText) return []
  const lines = lyricText.split('\n')
  const result = []
  
  lines.forEach(line => {
    const match = line.match(/\[(\d+:\d+\.\d+)\](.*)/)
    if (match) {
      const [, timestamp, text] = match
      if (text.trim()) {
        result.push({
          time: parseLyricTimestamp(timestamp),
          text: text.trim()
        })
      }
    }
  })
  
  return result
}

// 防抖函数
export function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// 节流函数
export function throttle(func, limit) {
  let inThrottle
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  }
}

// 深拷贝
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return new Date(obj.getTime())
  if (obj instanceof Array) return obj.map(item => deepClone(item))
  if (typeof obj === 'object') {
    const clonedObj = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key])
      }
    }
    return clonedObj
  }
}

// 生成唯一ID
export function generateId() {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 随机打乱数组
export function shuffleArray(array) {
  const newArray = [...array]
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[newArray[i], newArray[j]] = [newArray[j], newArray[i]]
  }
  return newArray
}

// 检查对象是否为空
export function isEmpty(obj) {
  return Object.keys(obj).length === 0
}

// 格式化歌曲标题
export function formatSongTitle(title) {
  if (!title) return "未知歌曲"
  // 移除括号内的内容（如 (Live)、(Remix) 等）
  return title.replace(/\s*\([^)]*\)\s*/g, '').trim()
}

// 格式化歌手名称
export function formatArtistName(artist) {
  if (!artist) return "未知歌手"
  return artist.trim()
}