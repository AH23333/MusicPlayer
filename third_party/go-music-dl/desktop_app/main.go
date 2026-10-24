package main

import (
	"context"
	"log"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"

	"gioui.org/app"
	"gioui.org/f32"
	"gioui.org/io/key"
	"gioui.org/layout"
	"gioui.org/op"

	"github.com/gioui-plugins/gio-plugins/hyperlink/giohyperlink"
	"github.com/gioui-plugins/gio-plugins/plugin/gioplugins"
	"github.com/gioui-plugins/gio-plugins/webviewer/giowebview"
	"github.com/guohuiyuan/go-music-dl/internal/appshell"

	_ "gioui.org/app/permission/storage"
	_ "gioui.org/app/permission/wakelock"
)

type webTag struct{}

type desktopApp struct {
	window *app.Window
	ops    op.Ops
	tag    webTag

	// 这些状态用于在多个 frame 之间协调 WebView 初始化流程，
	// 因为 Gio 插件命令是在 frame 处理中下发的。
	bridgeInstalled         bool
	callbackRegistered      bool
	storagePermissionOnce   bool
	androidWebViewFocusOnce bool
	bundledFFmpegOnce       bool
	pendingInitialNav       bool
	pendingHistoryBack      bool
	pendingExternalOpenTo   *url.URL
	initialNav              <-chan initialNavigationResult
	initialNavURL           string
	initialNavReady         bool
	initialNavSentAt        time.Time
	initialNavAcked         bool
	navigationAttempts      int
	navigationFailed        bool
	lastWebViewState        string
	currentWebURL           string
	reloadPending           bool
	reloadDeferred          bool
	playbackActive          bool
	playbackMetadata        playbackMetadata
	lastFrameAt             time.Time
	pendingTVNavigation     []string
}

const (
	downloadCallback         = "musicDlOpenDownload"
	playbackCallback         = "musicDlPlaybackState"
	playbackMetadataCallback = "musicDlPlaybackMetadata"
	appStateCallback         = "musicDlAppState"
	preferredBrowserPK       = ""
	initialNavRetryInterval  = 3 * time.Second
	initialNavMaxAttempts    = 5
	resumeReloadThreshold    = 2 * time.Second
)

// resumeReloadEnabled 只在 iOS 上启用"长帧间隔 = 从后台恢复"的重载恢复逻辑。
// WKWebView 在 iOS 上回到前台可能出现空白原生层，长帧间隔是 Gio 唯一可用的
// 生命周期信号。安卓端 Gio 在画面静止时本来就不持续出帧——用户停留在搜索
// 结果页时几秒无帧是正常空闲，不是后台恢复信号；用它触发整页重载会把用户
// 刚搜出的结果冲掉（表现为"搜索为空"），因此安卓端必须关闭。
var resumeReloadEnabled = runtime.GOOS == "ios"

type initialNavigationResult struct {
	URL string
	Err error
}

// 注入的桥接脚本把桌面端行为放在壳层处理：
// 返回操作继续走原生外壳，普通链接下载模式下的下载则回传给 Go 处理。
const bridgeScript = `(function () {
  if (window.__musicDlDesktopBridgeInstalled) {
    return;
  }
  window.__musicDlDesktopBridgeInstalled = true;

  document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }
    if (event.key === "BrowserBack") {
      if (typeof window.__musicDlHandleBack === "function" && window.__musicDlHandleBack()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      window.history.back();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === "ArrowLeft") {
      event.preventDefault();
      window.history.back();
    }
  }, true);

  function notifyPlaybackState(state) {
    if (globalThis.callback && typeof globalThis.callback.musicDlPlaybackState === "function") {
      globalThis.callback.musicDlPlaybackState("playback:" + state);
    }
    notifyPlaybackMetadata(true);
  }

  var lastPlaybackMetadata = "";
  var lastNativePlaybackAt = 0;
  function currentPlaybackMetadataPayload() {
    var player = window.ap;
    if (!player || !player.audio || !player.list || !Array.isArray(player.list.audios)) {
      return null;
    }
    var index = player.list.index;
    var audio = typeof index === "number" ? player.list.audios[index] : null;
    if (!audio) {
      return null;
    }
    var duration = Number(player.audio.duration);
    var position = Number(player.audio.currentTime);
    return {
      title: String(audio.name || ""),
      artist: String(audio.artist || ""),
      album: String(audio.album || ""),
      positionMs: Number.isFinite(position) ? Math.max(0, Math.round(position * 1000)) : 0,
      durationMs: Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1000)) : 0,
      playing: !player.audio.paused && !player.audio.ended
    };
  }

  function notifyNativePlayback(force) {
    var bridge = window.MusicDLNativePlayback;
    if (!bridge || typeof bridge.updatePlayback !== "function") {
      return;
    }
    var now = Date.now();
    if (!force && now - lastNativePlaybackAt < 750) {
      return;
    }
    var payload = currentPlaybackMetadataPayload();
    if (!payload) {
      return;
    }
    lastNativePlaybackAt = now;
    try {
      bridge.updatePlayback(
        payload.title,
        payload.artist,
        payload.album,
        payload.positionMs,
        payload.durationMs,
        payload.playing
      );
    } catch (e) {}
  }

  function notifyPlaybackMetadata(force) {
    var payload = currentPlaybackMetadataPayload();
    if (!payload) {
      return;
    }
    var encoded = JSON.stringify(payload);
    if (!force && encoded === lastPlaybackMetadata) {
      return;
    }
    lastPlaybackMetadata = encoded;
    notifyNativePlayback(force);
    if (globalThis.callback && typeof globalThis.callback.musicDlPlaybackMetadata === "function") {
      globalThis.callback.musicDlPlaybackMetadata("playback_metadata:" + encoded);
    }
  }

  function notifyAppState(state) {
    if (globalThis.callback && typeof globalThis.callback.musicDlAppState === "function") {
      globalThis.callback.musicDlAppState("state:" + state);
    }
  }

  function notifyShellURL(url) {
    if (globalThis.callback && typeof globalThis.callback.musicDlAppState === "function") {
      globalThis.callback.musicDlAppState("url:" + url);
    }
  }

  // 桥接脚本可能在 DOMContentLoaded 之后才注入（安卓端原生 WebView 是异步
  // 创建的，安装命令可能晚到甚至丢失）。只挂监听器就永远等不到事件，Go 侧
  // 收不到加载确认，会每隔几秒重试导航，把用户刚搜出的结果冲掉。
  // 文档已就绪时直接补发一次确认。
  // The bridge can be injected after DOMContentLoaded. Acknowledge as soon as
  // it runs so the native shell does not reload a page that is merely slow.
  console.log("[musicdl-bridge] run readyState=" + document.readyState + " callback=" + (typeof globalThis.callback));
  notifyAppState("bridge");
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      console.log("[musicdl-bridge] ack via DOMContentLoaded");
      notifyAppState("loaded");
    });
  } else {
    console.log("[musicdl-bridge] ack immediately");
    notifyAppState("loaded");
  }

  // SPA 导航（fetch + history.pushState）不产生原生 NavigationEvent，壳层的
  // currentWebURL 会一直停留在首页；一旦发生重载（从后台恢复、启动重试），
  // 用户就会被送回首页、搜索结果丢失。这里把新地址同步给壳层。
  var nativePushState = history.pushState;
  history.pushState = function () {
    nativePushState.apply(history, arguments);
    notifyShellURL(String(window.location.href));
  };
  var nativeReplaceState = history.replaceState;
  history.replaceState = function () {
    nativeReplaceState.apply(history, arguments);
    notifyShellURL(String(window.location.href));
  };

  document.addEventListener("play", function (event) {
    if (event.target && event.target.tagName === "AUDIO") {
      notifyPlaybackState("playing");
    }
  }, true);

  document.addEventListener("pause", function (event) {
    if (event.target && event.target.tagName === "AUDIO") {
      notifyPlaybackState("paused");
    }
  }, true);

  document.addEventListener("ended", function (event) {
    if (event.target && event.target.tagName === "AUDIO") {
      notifyPlaybackState("ended");
    }
  }, true);

  function bindAPlayerPlayback() {
    var player = window.ap;
    if (!player || !player.audio || player.audio.__musicDlPlaybackBound) {
      return;
    }
    var audio = player.audio;
    audio.__musicDlPlaybackBound = true;
    function notifyCurrentPlaybackState(state) {
      if (window.ap && window.ap.audio === audio) {
        notifyPlaybackState(state);
      }
    }
    audio.addEventListener("playing", function () {
      notifyCurrentPlaybackState("playing");
    });
    audio.addEventListener("pause", function () {
      notifyCurrentPlaybackState("paused");
    });
    audio.addEventListener("timeupdate", function () {
      notifyNativePlayback(false);
    });
    audio.addEventListener("ended", function () {
      notifyCurrentPlaybackState("ended");
    });
  }

  function bindAPlayerWhenReady() {
    bindAPlayerPlayback();
    if (!window.ap || !window.ap.audio) {
      setTimeout(bindAPlayerWhenReady, 250);
    }
  }
  bindAPlayerWhenReady();
  setInterval(bindAPlayerPlayback, 500);
  setInterval(notifyPlaybackMetadata, 1000);

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) {
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    var link = event.target && event.target.closest ? event.target.closest(".btn-download, .btn-browser-download") : null;
    if (!link) {
      return;
    }

    if (link.classList.contains("btn-download")) {
      return;
    }

    var href = String(link.href || "").trim();
    if (!href) {
      return;
    }
    try {
      var url = new URL(href, window.location.href);
      url.searchParams.delete("save_local");
      href = url.toString();
    } catch (_) {}

    event.preventDefault();
    event.stopPropagation();

    if (globalThis.callback && typeof globalThis.callback.musicDlOpenDownload === "function") {
      globalThis.callback.musicDlOpenDownload(href);
    } else {
      window.location.href = href;
    }
  }, true);
})();`

const historyBackScript = `(function () {
  if (typeof window.__musicDlHandleBack === "function" && window.__musicDlHandleBack()) {
    return;
  }
  if (window.history.length > 1) {
    window.history.back();
  }
})();`

func main() {
	path, err := app.DataDir()
	if err != nil {
		log.Fatal(err)
	}
	os.Setenv("MUSIC_DL_CONFIG_DB", path+"/settings.db")
	os.Setenv("MUSIC_DL_COOKIE_FILE", path+"/cookies.json")

	initialNav := startInitialNavigation(appshell.DefaultPort)

	go func() {
		window := new(app.Window)
		window.Option(app.Title("music-dl"))
		if err := newDesktopApp(window, initialNav).run(); err != nil {
			log.Fatal(err)
		}
		os.Exit(0)
	}()
	app.Main()
}

func newDesktopApp(window *app.Window, initialNav <-chan initialNavigationResult) *desktopApp {
	return &desktopApp{
		window:     window,
		initialNav: initialNav,
	}
}

func (a *desktopApp) run() error {
	for {
		switch evt := gioplugins.Hijack(a.window).(type) {
		case app.DestroyEvent:
			a.stopPlaybackPlatform()
			return evt.Err
		case app.ViewEvent:
			a.configureBundledFFmpeg(evt)
			a.requestStoragePermission(evt)
			a.requestAndroidWebViewFocus(evt)
		case app.FrameEvent:
			a.handleFrame(evt)
		}
	}
}

func (a *desktopApp) handleFrame(evt app.FrameEvent) {
	gtx := app.NewContext(&a.ops, evt)

	now := time.Now()
	if resumeReloadEnabled && a.initialNavAcked && !a.lastFrameAt.IsZero() && now.Sub(a.lastFrameAt) > resumeReloadThreshold {
		// iOS WKWebView can come back from background with a blank native layer.
		// A long frame gap is the only lifecycle signal available through Gio here.
		log.Printf("frame gap %v detected, scheduling reload (playback=%v)", now.Sub(a.lastFrameAt), a.playbackActive)
		if a.playbackActive {
			a.reloadDeferred = true
		} else {
			a.reloadPending = true
		}
	}
	a.lastFrameAt = now

	a.pendingHistoryBack = a.pendingHistoryBack || consumeBackShortcuts(gtx)
	a.pendingTVNavigation = append(a.pendingTVNavigation, consumeTVNavigationShortcuts(gtx)...)
	if len(a.pendingTVNavigation) > 12 {
		a.pendingTVNavigation = a.pendingTVNavigation[len(a.pendingTVNavigation)-12:]
	}
	a.consumeWebViewEvents(gtx)
	a.consumeInitialNavigationResult()
	a.layoutWebView(gtx)
	evt.Frame(gtx.Ops)
	if a.playbackActive {
		// Android can stop producing Gio frames while the app is in the
		// background. Keep a low-frequency frame alive so WebView playback
		// events still reach the foreground service and MediaSession.
		gtx.Execute(op.InvalidateCmd{At: now.Add(time.Second)})
	}

	a.ensureBridge(gtx)
	a.handlePendingNavigation(gtx)
	a.handlePendingReload(gtx)
	a.handleInitialNavigationRecovery(gtx)
	a.handlePendingHistoryBack(gtx)
	a.handlePendingTVNavigation(gtx)
	a.handlePendingExternalOpen(gtx)
}

func (a *desktopApp) layoutWebView(gtx layout.Context) {
	size := gtx.Constraints.Max
	stack := giowebview.WebViewOp{Tag: &a.tag}.Push(gtx.Ops)
	giowebview.RectOp{Size: f32.Point{X: float32(size.X), Y: float32(size.Y)}}.Add(gtx.Ops)
	stack.Pop(gtx.Ops)
}

// installBridge 注入 WebView 桥接脚本。可以重复调用：脚本自身带
// __musicDlDesktopBridgeInstalled 幂等保护，重复注入不会重复绑定事件。
func (a *desktopApp) installBridge(gtx layout.Context) {
	gioplugins.Execute(gtx, giowebview.InstallJavascriptCmd{
		View:   &a.tag,
		Script: bridgeScript,
	})
}

// registerCallbacks 注册 JS→Go 回调名。可以重复调用：插件侧对同名回调返回
// duplicate 错误并保留原注册，重复下发无副作用。
func (a *desktopApp) registerCallbacks(gtx layout.Context) {
	gioplugins.Execute(gtx, giowebview.MessageReceiverCmd{
		View: &a.tag,
		Tag:  &a.tag,
		Name: downloadCallback,
	})
	gioplugins.Execute(gtx, giowebview.MessageReceiverCmd{
		View: &a.tag,
		Tag:  &a.tag,
		Name: playbackCallback,
	})
	gioplugins.Execute(gtx, giowebview.MessageReceiverCmd{
		View: &a.tag,
		Tag:  &a.tag,
		Name: playbackMetadataCallback,
	})
	gioplugins.Execute(gtx, giowebview.MessageReceiverCmd{
		View: &a.tag,
		Tag:  &a.tag,
		Name: appStateCallback,
	})
}

func (a *desktopApp) ensureBridge(gtx layout.Context) {
	if !a.bridgeInstalled {
		a.installBridge(gtx)
		a.bridgeInstalled = true
	}

	if a.bridgeInstalled && !a.callbackRegistered {
		// 只注册一次 JS 回调，这样下载链接会交回桌面壳层处理，
		// 而不是在内嵌 WebView 里继续跳转。
		a.registerCallbacks(gtx)
		a.callbackRegistered = true
		a.pendingInitialNav = true
		a.window.Invalidate()
	}
}

func (a *desktopApp) handlePendingNavigation(gtx layout.Context) {
	if !a.pendingInitialNav || !a.initialNavReady {
		return
	}

	// 首次跳转延后到桥接回调准备完成之后，避免页面过早加载。
	a.startNavigation(gtx, a.navigationTarget())
	a.pendingInitialNav = false
}

func (a *desktopApp) handlePendingReload(gtx layout.Context) {
	if !a.reloadPending || !a.initialNavReady || !a.callbackRegistered {
		return
	}

	log.Printf("pending reload navigating to %s", a.navigationTarget())
	a.startNavigation(gtx, a.navigationTarget())
}

func (a *desktopApp) handleInitialNavigationRecovery(gtx layout.Context) {
	switch a.navigationRecoveryAction(time.Now()) {
	case navigationRecoveryWait:
		return
	case navigationRecoveryShowDiagnostic:
		a.navigationFailed = true
		log.Printf(
			"webview did not acknowledge after %d attempts; showing in-app diagnostics (last state=%q url=%s)",
			a.navigationAttempts,
			a.lastWebViewState,
			a.navigationTarget(),
		)
		a.navigateTo(gtx, navigationDiagnosticDataURL(
			a.navigationTarget(),
			a.navigationAttempts,
			a.lastWebViewState,
			runtime.GOOS,
			runtime.GOARCH,
			runtime.Version(),
		))
		return
	}

	// NavigateCmd can be dropped before the native WebView exists, so keep
	// retrying for a bounded number of attempts until the bridge runs.
	// InstallJavascriptCmd and MessageReceiverCmd can be dropped the same way:
	// without the bridge script the page cannot acknowledge, and without the
	// callback registration the acknowledgement is silently discarded by the
	// plugin, so re-issue both alongside the navigation.
	log.Printf("webview load not acknowledged yet, retrying bridge + navigation (%d/%d)", a.navigationAttempts+1, initialNavMaxAttempts)
	a.installBridge(gtx)
	a.registerCallbacks(gtx)
	a.startNavigation(gtx, a.navigationTarget())
}

type navigationRecoveryResult uint8

const (
	navigationRecoveryWait navigationRecoveryResult = iota
	navigationRecoveryRetry
	navigationRecoveryShowDiagnostic
)

func (a *desktopApp) navigationRecoveryAction(now time.Time) navigationRecoveryResult {
	if !a.initialNavReady || !a.callbackRegistered || a.pendingInitialNav || a.initialNavAcked || a.navigationFailed {
		return navigationRecoveryWait
	}
	if a.initialNavSentAt.IsZero() || now.Sub(a.initialNavSentAt) < initialNavRetryInterval {
		return navigationRecoveryWait
	}
	if a.navigationAttempts >= initialNavMaxAttempts {
		return navigationRecoveryShowDiagnostic
	}
	return navigationRecoveryRetry
}

func (a *desktopApp) startNavigation(gtx layout.Context, rawURL string) {
	if rawURL == "" {
		return
	}
	a.navigationAttempts++
	a.navigationFailed = false
	a.navigateTo(gtx, rawURL)
}

func (a *desktopApp) navigateTo(gtx layout.Context, rawURL string) {
	if rawURL == "" {
		return
	}

	gioplugins.Execute(gtx, giowebview.NavigateCmd{
		URL:  rawURL,
		View: &a.tag,
	})
	a.initialNavSentAt = time.Now()
	a.initialNavAcked = false
	a.reloadPending = false
}

func (a *desktopApp) navigationTarget() string {
	if a.currentWebURL != "" {
		return a.currentWebURL
	}
	return a.initialNavURL
}

func (a *desktopApp) consumeInitialNavigationResult() {
	if a.initialNavReady {
		return
	}
	if a.initialNav == nil {
		a.initialNavURL = appshell.AppURL(appshell.DefaultPort)
		a.initialNavReady = true
		return
	}

	select {
	case result := <-a.initialNav:
		if result.URL == "" {
			result.URL = appshell.AppURL(appshell.DefaultPort)
		}
		if result.Err != nil {
			log.Printf("desktop server startup probe failed: %v", result.Err)
		}
		a.initialNavURL = result.URL
		a.initialNavReady = true
		if a.callbackRegistered {
			a.pendingInitialNav = true
		}
		if a.window != nil {
			a.window.Invalidate()
		}
	default:
	}
}

func (a *desktopApp) handlePendingHistoryBack(gtx layout.Context) {
	if !a.pendingHistoryBack || !a.bridgeInstalled || a.pendingInitialNav {
		return
	}

	gioplugins.Execute(gtx, giowebview.ExecuteJavascriptCmd{
		View:   &a.tag,
		Script: historyBackScript,
	})
	a.pendingHistoryBack = false
}

var tvNavigationScripts = map[string]string{
	"up": `(function () {
  if (typeof window.__musicDlTVHandleKey === "function") {
    window.__musicDlTVHandleKey("up");
  }
})();`,
	"down": `(function () {
  if (typeof window.__musicDlTVHandleKey === "function") {
    window.__musicDlTVHandleKey("down");
  }
})();`,
	"left": `(function () {
  if (typeof window.__musicDlTVHandleKey === "function") {
    window.__musicDlTVHandleKey("left");
  }
})();`,
	"right": `(function () {
  if (typeof window.__musicDlTVHandleKey === "function") {
    window.__musicDlTVHandleKey("right");
  }
})();`,
	"enter": `(function () {
  if (typeof window.__musicDlTVHandleKey === "function") {
    window.__musicDlTVHandleKey("enter");
  }
})();`,
}

func (a *desktopApp) handlePendingTVNavigation(gtx layout.Context) {
	if len(a.pendingTVNavigation) == 0 || !a.bridgeInstalled || a.pendingInitialNav {
		return
	}

	for _, action := range a.pendingTVNavigation {
		script := tvNavigationScripts[action]
		if script == "" {
			continue
		}
		gioplugins.Execute(gtx, giowebview.ExecuteJavascriptCmd{
			View:   &a.tag,
			Script: script,
		})
	}
	a.pendingTVNavigation = a.pendingTVNavigation[:0]
}

func (a *desktopApp) handlePendingExternalOpen(gtx layout.Context) {
	if a.pendingExternalOpenTo == nil {
		return
	}

	// 通过系统浏览器打开链接，可以直接复用服务端现有的 /download 行为，
	// 不需要继续扩展 WebView 插件本身。
	gioplugins.Execute(gtx, giohyperlink.OpenCmd{
		Tag:              &a.tag,
		URI:              a.pendingExternalOpenTo,
		PreferredPackage: preferredBrowserPK,
	})
	log.Printf("opened download in external browser: %s", a.pendingExternalOpenTo.String())
	a.pendingExternalOpenTo = nil
}

func (a *desktopApp) consumeWebViewEvents(gtx layout.Context) {
	for {
		evt, ok := gioplugins.Event(gtx, giowebview.Filter{Target: &a.tag})
		if !ok {
			return
		}

		switch evt := evt.(type) {
		case giowebview.MessageEvent:
			a.handleWebViewMessage(evt.Message)
		case giowebview.NavigationEvent:
			a.handleNavigationEvent(evt.URL)
		}
	}
}

func (a *desktopApp) handleWebViewMessage(raw string) {
	if strings.HasPrefix(raw, "playback_metadata:") {
		a.handlePlaybackMetadata(strings.TrimPrefix(raw, "playback_metadata:"))
		return
	}
	if strings.HasPrefix(raw, "playback:") {
		a.handlePlaybackState(strings.TrimPrefix(raw, "playback:"))
		return
	}
	if strings.HasPrefix(raw, "state:") {
		a.handleWebViewState(strings.TrimPrefix(raw, "state:"))
		return
	}
	if strings.HasPrefix(raw, "url:") {
		a.handleSPAURLChange(strings.TrimPrefix(raw, "url:"))
		return
	}

	u, err := url.Parse(raw)
	if err != nil {
		log.Printf("invalid download url from webview: %q (%v)", raw, err)
		return
	}

	a.pendingExternalOpenTo = u
	log.Printf("received download url from webview: %s", u.String())
}

func (a *desktopApp) handleNavigationEvent(rawURL string) {
	if rawURL != "" {
		a.currentWebURL = rawURL
	}
	if strings.HasPrefix(rawURL, "data:") {
		// Data URLs are not injected with the JS bridge, so the URL change is
		// the only load acknowledgement available for the startup error page.
		a.initialNavAcked = true
		a.reloadPending = false
		a.navigationAttempts = 0
		return
	}
	if a.navigationFailed {
		// The retry link in the diagnostic page starts a fresh recovery cycle.
		log.Printf("navigation resumed from in-app diagnostics: %s", rawURL)
		a.navigationFailed = false
		a.navigationAttempts = 1
		a.initialNavSentAt = time.Now()
		a.initialNavAcked = false
	}
}

// handleSPAURLChange 同步 SPA 导航后的地址。fetch + pushState 不产生原生
// NavigationEvent，不同步的话 currentWebURL 会停留在首页，一旦重载（从后台
// 恢复、启动重试）就会把用户送回首页、丢失搜索结果。
func (a *desktopApp) handleSPAURLChange(rawURL string) {
	if rawURL != "" {
		a.currentWebURL = rawURL
	}
}

func (a *desktopApp) handleWebViewState(state string) {
	state = strings.TrimSpace(state)
	a.lastWebViewState = state
	log.Printf("webview state: %s", state)
	switch state {
	case "bridge", "loaded":
		a.initialNavAcked = true
		a.navigationAttempts = 0
		a.navigationFailed = false
		a.reloadPending = false
	}
}

func (a *desktopApp) handlePlaybackState(state string) {
	switch strings.TrimSpace(state) {
	case "playing":
		a.playbackActive = true
		a.reloadPending = false
		a.reloadDeferred = false
		a.updatePlaybackPlatform("playing")
	case "paused", "ended", "released":
		a.playbackActive = false
		if a.reloadDeferred {
			a.reloadDeferred = false
			a.reloadPending = true
		}
		state = strings.TrimSpace(state)
		if state == "released" {
			a.updatePlaybackPlatform("released")
		} else {
			// "ended" can fire before APlayer changes to the next track. Keep
			// the media service alive through that transition so background
			// playback is not torn down at the queue boundary.
			a.updatePlaybackPlatform("paused")
		}
	}
}

func (a *desktopApp) handlePlaybackMetadata(raw string) {
	metadata, err := parsePlaybackMetadata(raw)
	if err != nil {
		log.Printf("invalid playback metadata from webview: %v", err)
		return
	}
	a.playbackMetadata = metadata
	switch {
	case metadata.Playing && !a.playbackActive:
		// The periodic metadata bridge is also a fallback for a missed play
		// event. Without this, audio can start while no foreground service is
		// holding the process alive.
		a.playbackActive = true
		a.updatePlaybackPlatform("playing")
	case !metadata.Playing && a.playbackActive:
		a.playbackActive = false
		a.updatePlaybackPlatform("paused")
	default:
		a.updatePlaybackMetadataPlatform()
	}
}

func consumeBackShortcuts(gtx layout.Context) bool {
	handled := false
	for {
		evt, ok := gtx.Event(
			key.Filter{Name: key.NameBack},
			key.Filter{Name: key.NameLeftArrow, Required: key.ModAlt},
		)
		if !ok {
			return handled
		}

		ke, ok := evt.(key.Event)
		if !ok || ke.State != key.Press {
			continue
		}
		handled = true
	}
}

func consumeTVNavigationShortcuts(gtx layout.Context) []string {
	if runtime.GOOS != "android" {
		return nil
	}

	var actions []string
	for {
		evt, ok := gtx.Event(
			key.Filter{Name: key.NameUpArrow},
			key.Filter{Name: key.NameDownArrow},
			key.Filter{Name: key.NameLeftArrow},
			key.Filter{Name: key.NameRightArrow},
			key.Filter{Name: key.NameEnter},
			key.Filter{Name: key.NameReturn},
		)
		if !ok {
			return actions
		}
		ke, ok := evt.(key.Event)
		if !ok || ke.State != key.Press {
			continue
		}

		switch ke.Name {
		case key.NameUpArrow:
			actions = append(actions, "up")
		case key.NameDownArrow:
			actions = append(actions, "down")
		case key.NameLeftArrow:
			actions = append(actions, "left")
		case key.NameRightArrow:
			actions = append(actions, "right")
		case key.NameEnter, key.NameReturn:
			actions = append(actions, "enter")
		}
	}
}

func startInitialNavigation(port string) <-chan initialNavigationResult {
	ch := make(chan initialNavigationResult, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), appshell.ReadyTimeout)
		defer cancel()

		target, err := appshell.StartDesktopServerAndWait(ctx, port)
		if err != nil {
			ch <- initialNavigationResult{
				URL: appshell.StartupErrorDataURL(err.Error(), target),
				Err: err,
			}
			return
		}
		ch <- initialNavigationResult{URL: target}
	}()
	return ch
}
