// 全局提示组件模块
class ToastModule {
  constructor() {
    this.toastElement = null;
  }

  init() {
    // 创建 toast 容器
    this.createToastContainer();
  }

  // 创建 toast 容器
  createToastContainer() {
    this.toastElement = document.createElement('div');
    this.toastElement.className = 'toast-container fixed top-4 right-4 z-50';
    document.body.appendChild(this.toastElement);
  }

  // 显示 toast
  show(message, type = 'info', duration = 3000) {
    if (!this.toastElement) return;

    // 创建 toast 元素
    const toast = document.createElement('div');
    toast.className = `toast ${type} px-4 py-2 rounded-md shadow-lg flex items-center mb-2`;
    toast.innerHTML = `
      <i class="bi ${this.getTypeIcon(type)} mr-2"></i>
      <span>${message}</span>
    `;

    // 添加到容器
    this.toastElement.appendChild(toast);

    // 添加入场动画
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    // 自动关闭
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode === this.toastElement) {
          this.toastElement.removeChild(toast);
        }
      }, 300);
    }, duration);
  }

  // 获取类型图标
  getTypeIcon(type) {
    switch (type) {
      case 'success':
        return 'bi-check-circle text-green-500';
      case 'error':
        return 'bi-exclamation-circle text-red-500';
      case 'warning':
        return 'bi-exclamation-triangle text-yellow-500';
      case 'info':
      default:
        return 'bi-info-circle text-blue-500';
    }
  }

  // 显示成功提示
  success(message, duration) {
    this.show(message, 'success', duration);
  }

  // 显示错误提示
  error(message, duration) {
    this.show(message, 'error', duration);
  }

  // 显示警告提示
  warning(message, duration) {
    this.show(message, 'warning', duration);
  }

  // 显示信息提示
  info(message, duration) {
    this.show(message, 'info', duration);
  }
}

const toast = new ToastModule();
export default toast;