// DOM 辅助函数

// 创建元素
export function createElement(tag, options = {}) {
  const element = document.createElement(tag)
  
  // 设置属性
  if (options.className) {
    element.className = options.className
  }
  
  if (options.id) {
    element.id = options.id
  }
  
  if (options.textContent) {
    element.textContent = options.textContent
  }
  
  if (options.innerHTML) {
    element.innerHTML = options.innerHTML
  }
  
  // 设置其他属性
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value)
    })
  }
  
  // 设置样式
  if (options.style) {
    Object.entries(options.style).forEach(([key, value]) => {
      element.style[key] = value
    })
  }
  
  // 添加子元素
  if (options.children) {
    options.children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child))
      } else if (child instanceof Node) {
        element.appendChild(child)
      }
    })
  }
  
  // 添加事件监听器
  if (options.events) {
    Object.entries(options.events).forEach(([event, handler]) => {
      element.addEventListener(event, handler)
    })
  }
  
  return element
}

// 添加类
export function addClass(element, className) {
  if (element && className) {
    element.classList.add(className)
  }
}

// 移除类
export function removeClass(element, className) {
  if (element && className) {
    element.classList.remove(className)
  }
}

// 切换类
export function toggleClass(element, className) {
  if (element && className) {
    element.classList.toggle(className)
  }
}

// 检查是否有类
export function hasClass(element, className) {
  if (element && className) {
    return element.classList.contains(className)
  }
  return false
}

// 设置样式
export function setStyle(element, style) {
  if (element && style) {
    Object.entries(style).forEach(([key, value]) => {
      element.style[key] = value
    })
  }
}

// 获取元素
export function getElement(selector) {
  return document.querySelector(selector)
}

// 获取多个元素
export function getElements(selector) {
  return document.querySelectorAll(selector)
}

// 绑定事件
export function on(element, event, handler) {
  if (element && event && handler) {
    element.addEventListener(event, handler)
  }
}

// 解绑事件
export function off(element, event, handler) {
  if (element && event && handler) {
    element.removeEventListener(event, handler)
  }
}

// 触发事件
export function trigger(element, event) {
  if (element && event) {
    element.dispatchEvent(new Event(event))
  }
}

// 显示元素
export function show(element) {
  if (element) {
    element.style.display = ''
  }
}

// 隐藏元素
export function hide(element) {
  if (element) {
    element.style.display = 'none'
  }
}

// 切换元素显示/隐藏
export function toggle(element) {
  if (element) {
    if (element.style.display === 'none') {
      element.style.display = ''
    } else {
      element.style.display = 'none'
    }
  }
}

// 获取元素位置
export function getElementPosition(element) {
  if (element) {
    return element.getBoundingClientRect()
  }
  return null
}

// 滚动到元素
export function scrollToElement(element, options = {}) {
  if (element) {
    element.scrollIntoView(options)
  }
}

// 清空元素内容
export function empty(element) {
  if (element) {
    element.innerHTML = ''
  }
}

// 插入元素到指定位置
export function insertBefore(element, newElement, referenceElement) {
  if (element && newElement && referenceElement) {
    element.insertBefore(newElement, referenceElement)
  }
}

// 替换元素
export function replaceElement(oldElement, newElement) {
  if (oldElement && newElement && oldElement.parentNode) {
    oldElement.parentNode.replaceChild(newElement, oldElement)
  }
}

// 移除元素
export function removeElement(element) {
  if (element && element.parentNode) {
    element.parentNode.removeChild(element)
  }
}