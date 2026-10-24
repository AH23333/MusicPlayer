package main

import (
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestBridgeRoutesOnlyBrowserDownloadsExternally(t *testing.T) {
	if strings.Contains(bridgeScript, "setting-download-to-local") {
		t.Fatal("bridgeScript must not depend on removed download-to-local toggle")
	}
	if !strings.Contains(bridgeScript, `closest(".btn-download, .btn-browser-download")`) {
		t.Fatal("bridgeScript should inspect both local-save and browser-download buttons")
	}
	if !strings.Contains(bridgeScript, `if (link.classList.contains("btn-download"))`) {
		t.Fatal("bridgeScript should leave local-save downloads to app.js POST handling")
	}
	if !strings.Contains(bridgeScript, `url.searchParams.delete("save_local")`) {
		t.Fatal("bridgeScript should strip save_local before opening external browser downloads")
	}
}

func TestBridgeReportsPlaybackState(t *testing.T) {
	for _, want := range []string{
		"musicDlPlaybackState",
		"musicDlPlaybackMetadata",
		`notifyPlaybackState("playing")`,
		`notifyPlaybackState("paused")`,
		`notifyPlaybackState("ended")`,
		`bindAPlayerPlayback`,
		`window.ap.audio === audio`,
		`setInterval(notifyPlaybackMetadata, 1000)`,
	} {
		if !strings.Contains(bridgeScript, want) {
			t.Fatalf("bridgeScript missing playback token %q", want)
		}
	}
}

func TestBridgeDoesNotStopPlaybackOnPageHide(t *testing.T) {
	if strings.Contains(bridgeScript, `window.addEventListener("pagehide"`) {
		t.Fatal("pagehide is not a reliable Android stop signal and must not tear down background playback")
	}
}

func TestHandlePlaybackMetadataDoesNotOpenURL(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.handleWebViewMessage(`playback_metadata:{"title":"Song","artist":"Artist","album":"Album","positionMs":1200,"durationMs":180000,"playing":true}`)
	if app.pendingExternalOpenTo != nil {
		t.Fatalf("playback metadata should not be treated as URL: %s", app.pendingExternalOpenTo)
	}
	if app.playbackMetadata.Title != "Song" || app.playbackMetadata.PositionMS != 1200 {
		t.Fatalf("unexpected playback metadata: %+v", app.playbackMetadata)
	}
	if !app.playbackActive {
		t.Fatal("playing metadata should recover a missed play event")
	}
}

func TestBridgeReportsAppLoadState(t *testing.T) {
	for _, want := range []string{
		"musicDlAppState",
		`notifyAppState("bridge")`,
		`notifyAppState("loaded")`,
	} {
		if !strings.Contains(bridgeScript, want) {
			t.Fatalf("bridgeScript missing app state token %q", want)
		}
	}
}

func TestBridgeAcknowledgesBeforeDOMContentLoaded(t *testing.T) {
	bridgeIndex := strings.Index(bridgeScript, `notifyAppState("bridge")`)
	domReadyIndex := strings.Index(bridgeScript, `document.addEventListener("DOMContentLoaded"`)
	if bridgeIndex < 0 || domReadyIndex < 0 {
		t.Fatal("bridgeScript is missing bridge or DOMContentLoaded acknowledgement")
	}
	if bridgeIndex > domReadyIndex {
		t.Fatal("bridge acknowledgement should run immediately, before waiting for DOMContentLoaded")
	}
}

func TestHandleWebViewMessagePlaybackDoesNotOpenURL(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.handleWebViewMessage("playback:paused")
	if app.pendingExternalOpenTo != nil {
		t.Fatalf("playback message should not be treated as URL: %s", app.pendingExternalOpenTo)
	}
}

func TestPlaybackStateDefersResumeReloadUntilStopped(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.reloadDeferred = true
	app.reloadPending = true

	app.handlePlaybackState("playing")
	if !app.playbackActive {
		t.Fatal("playing should mark playback as active")
	}
	if app.reloadDeferred || app.reloadPending {
		t.Fatal("playing should cancel pending resume reloads")
	}

	app.handlePlaybackState("paused")
	if app.playbackActive {
		t.Fatal("paused should clear playback active state")
	}
	if app.reloadPending || app.reloadDeferred {
		t.Fatal("paused should not create a reload without a new frame gap")
	}
}

func TestPlaybackStopFlushesDeferredReload(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.handlePlaybackState("playing")
	app.reloadDeferred = true

	app.handlePlaybackState("ended")
	if !app.reloadPending || app.reloadDeferred {
		t.Fatal("stopping playback should flush a deferred resume reload")
	}
}

func TestHandleWebViewMessageAppStateDoesNotOpenURL(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.handleWebViewMessage("state:loaded")
	if app.pendingExternalOpenTo != nil {
		t.Fatalf("app state message should not be treated as URL: %s", app.pendingExternalOpenTo)
	}
	if !app.initialNavAcked {
		t.Fatal("state:loaded should acknowledge the initial navigation")
	}
}

func TestBridgeStateStopsAutomaticNavigationRetries(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.navigationAttempts = initialNavMaxAttempts
	app.navigationFailed = true
	app.initialNavSentAt = time.Now().Add(-initialNavRetryInterval)

	app.handleWebViewMessage("state:bridge")

	if !app.initialNavAcked {
		t.Fatal("state:bridge should acknowledge that the WebView bridge is alive")
	}
	if app.navigationAttempts != 0 || app.navigationFailed {
		t.Fatalf("bridge acknowledgement did not reset retries: attempts=%d failed=%v", app.navigationAttempts, app.navigationFailed)
	}
	if got := app.navigationRecoveryAction(time.Now()); got != navigationRecoveryWait {
		t.Fatalf("recovery action after bridge acknowledgement = %v, want wait", got)
	}
}

func TestNavigationRecoveryBecomesBoundedDiagnostic(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.initialNavReady = true
	app.callbackRegistered = true
	app.initialNavSentAt = time.Now().Add(-initialNavRetryInterval)
	app.navigationAttempts = initialNavMaxAttempts - 1

	if got := app.navigationRecoveryAction(time.Now()); got != navigationRecoveryRetry {
		t.Fatalf("recovery action before limit = %v, want retry", got)
	}
	app.navigationAttempts = initialNavMaxAttempts
	if got := app.navigationRecoveryAction(time.Now()); got != navigationRecoveryShowDiagnostic {
		t.Fatalf("recovery action at limit = %v, want diagnostic", got)
	}
	app.navigationFailed = true
	if got := app.navigationRecoveryAction(time.Now().Add(time.Hour)); got != navigationRecoveryWait {
		t.Fatalf("recovery action after diagnostic = %v, want wait", got)
	}
}

func TestNavigationDiagnosticContainsActionableState(t *testing.T) {
	target := "http://127.0.0.1:37777/music/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6"
	dataURL := navigationDiagnosticDataURL(target, initialNavMaxAttempts, "not received", "ios", "arm64", "go1.25.1")
	const prefix = "data:text/html;charset=utf-8;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		t.Fatalf("diagnostic URL has unexpected prefix: %.80s", dataURL)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
	if err != nil {
		t.Fatal(err)
	}
	body := string(decoded)
	for _, want := range []string{target, "5", "ios/arm64", "go1.25.1", "重新尝试"} {
		if !strings.Contains(body, want) {
			t.Fatalf("diagnostic page missing %q", want)
		}
	}
}

func TestRetryFromNavigationDiagnosticStartsNewRecoveryCycle(t *testing.T) {
	target := "http://127.0.0.1:37777/music/"
	app := newDesktopApp(nil, nil)
	app.initialNavReady = true
	app.navigationFailed = true
	app.initialNavAcked = true

	app.handleNavigationEvent(target)

	if app.navigationFailed {
		t.Fatal("navigation from the diagnostic retry link should leave the failed state")
	}
	if app.navigationAttempts != 1 {
		t.Fatalf("navigationAttempts = %d, want 1", app.navigationAttempts)
	}
	if app.initialNavAcked {
		t.Fatal("retry navigation should wait for a fresh bridge acknowledgement")
	}
	if app.currentWebURL != target {
		t.Fatalf("currentWebURL = %q, want %q", app.currentWebURL, target)
	}
}

func TestNavigationEventTracksCurrentURL(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.initialNavReady = true
	app.handleNavigationEvent("http://127.0.0.1:37777/music/settings")

	if app.currentWebURL != "http://127.0.0.1:37777/music/settings" {
		t.Fatalf("currentWebURL = %q", app.currentWebURL)
	}
	if app.initialNavAcked {
		t.Fatal("navigation event alone must not acknowledge an HTTP page; only DOMContentLoaded can")
	}
}

func TestNavigationEventAcknowledgesStartupErrorDataURL(t *testing.T) {
	app := newDesktopApp(nil, nil)
	app.initialNavReady = true
	app.initialNavURL = "data:text/html;charset=utf-8,startup-error"
	app.handleNavigationEvent(app.initialNavURL)

	if !app.initialNavAcked {
		t.Fatal("data URL navigation should acknowledge the startup error page")
	}
}

func TestHandleWebViewMessageDownloadURL(t *testing.T) {
	app := newDesktopApp(nil, nil)
	raw := "http://127.0.0.1:37777/music/download?id=1&source=qq"
	app.handleWebViewMessage(raw)
	if app.pendingExternalOpenTo == nil {
		t.Fatal("download URL was not queued for external open")
	}
	if got := app.pendingExternalOpenTo.String(); got != raw {
		t.Fatalf("pendingExternalOpenTo = %q, want %q", got, raw)
	}
	if _, err := url.Parse(gotURL(app)); err != nil {
		t.Fatalf("pending URL is not parseable: %v", err)
	}
}

func TestInitialNavigationWaitsForServerReady(t *testing.T) {
	ch := make(chan initialNavigationResult, 1)
	app := newDesktopApp(nil, ch)
	app.callbackRegistered = true
	app.pendingInitialNav = true

	app.consumeInitialNavigationResult()
	if app.initialNavReady {
		t.Fatal("initial navigation should not be ready before the probe result")
	}

	ch <- initialNavigationResult{URL: "http://127.0.0.1:37777/music/"}
	app.consumeInitialNavigationResult()
	if !app.initialNavReady {
		t.Fatal("initial navigation should be ready after the probe result")
	}
	if app.initialNavURL != "http://127.0.0.1:37777/music/" {
		t.Fatalf("initialNavURL = %q", app.initialNavURL)
	}
	if !app.pendingInitialNav {
		t.Fatal("pendingInitialNav should be restored after the server becomes ready")
	}
}

func TestBridgeAcksLoadWhenInjectedAfterDOMContentLoaded(t *testing.T) {
	// 桥接脚本晚于 DOMContentLoaded 注入时，只挂监听器会永远等不到事件，
	// Go 侧收不到加载确认就会一直重试导航，把搜索结果冲掉。
	if !strings.Contains(bridgeScript, `document.readyState === "loading"`) {
		t.Fatal("bridgeScript should check document.readyState before waiting for DOMContentLoaded")
	}
	// 两个分支都要补发确认。
	if strings.Count(bridgeScript, `notifyAppState("loaded")`) < 2 {
		t.Fatal(`bridgeScript should notify "loaded" both when loading and when already ready`)
	}
}

func TestBridgeSyncsSPANavigationURL(t *testing.T) {
	for _, want := range []string{
		"nativePushState",
		"nativeReplaceState",
		`"url:" + url`,
	} {
		if !strings.Contains(bridgeScript, want) {
			t.Fatalf("bridgeScript missing SPA URL sync token %q", want)
		}
	}
}

func TestHandleWebViewMessageSPAURLTracksCurrentURL(t *testing.T) {
	app := newDesktopApp(nil, nil)
	raw := "http://127.0.0.1:37777/music/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6"
	app.handleWebViewMessage("url:" + raw)

	if app.pendingExternalOpenTo != nil {
		t.Fatal("url: message must not be treated as an external download")
	}
	if app.currentWebURL != raw {
		t.Fatalf("currentWebURL = %q, want %q", app.currentWebURL, raw)
	}
	if app.initialNavAcked {
		t.Fatal("SPA URL sync must not acknowledge the initial navigation")
	}
}

func gotURL(app *desktopApp) string {
	if app.pendingExternalOpenTo == nil {
		return ""
	}
	return app.pendingExternalOpenTo.String()
}
