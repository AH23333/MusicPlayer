package web

import (
	"strings"
	"testing"
)

func TestIssue240SettingsAndPlayerPolish(t *testing.T) {
	appContent, err := templateFS.ReadFile("templates/static/js/app.js")
	if err != nil {
		t.Fatalf("ReadFile(app.js): %v", err)
	}
	modalContent, err := templateFS.ReadFile("templates/partials/modals.html")
	if err != nil {
		t.Fatalf("ReadFile(modals.html): %v", err)
	}
	styleContent, err := templateFS.ReadFile("templates/static/css/style.css")
	if err != nil {
		t.Fatalf("ReadFile(style.css): %v", err)
	}
	authContent, err := templateFS.ReadFile("templates/pages/auth.html")
	if err != nil {
		t.Fatalf("ReadFile(auth.html): %v", err)
	}
	indexContent, err := templateFS.ReadFile("templates/pages/index.html")
	if err != nil {
		t.Fatalf("ReadFile(index.html): %v", err)
	}
	videoCSSContent, err := templateFS.ReadFile("templates/static/css/videogen.css")
	if err != nil {
		t.Fatalf("ReadFile(videogen.css): %v", err)
	}
	videoJSContent, err := templateFS.ReadFile("templates/static/js/videogen.js")
	if err != nil {
		t.Fatalf("ReadFile(videogen.js): %v", err)
	}

	appJS := string(appContent)
	modalsHTML := string(modalContent)
	styleCSS := string(styleContent)
	authHTML := string(authContent)
	indexHTML := string(indexContent)
	videoCSS := string(videoCSSContent)
	videoJS := string(videoJSContent)

	for _, want := range []string{
		`"/home/appuser/data"`,
		"downloadTipDuration",
		"downloadNoticeDuration()",
		`btn.classList.toggle("is-stop", isPlaying)`,
		"bindSettingsTabs()",
		"filterVersionKeywords",
		"versionFilterKeywords",
		"filterShortTracks",
		"normalizeChineseVariants",
		`searchForm.dataset.loading === "1"`,
		"fa-spinner fa-spin",
		"aplayer-icon-lrc",
		"显示或隐藏歌词",
		"scrollToCurrentPlaying",
		"ensureSongActionFold",
		"confirmLocalMusicDeletion",
	} {
		if !strings.Contains(appJS, want) {
			t.Fatalf("app.js missing issue #240 token %q", want)
		}
	}

	for _, want := range []string{
		`data-settings-tab="general"`,
		`data-settings-tab="download"`,
		`data-settings-tab="cookies"`,
		`id="setting-download-tip-duration"`,
		`value="/home/appuser/data"`,
		`id="setting-filter-version-keywords"`,
		`id="setting-version-filter-keywords"`,
		`id="setting-filter-short-tracks"`,
		`id="setting-normalize-chinese-variants"`,
		`id="cookie-hint-{{$source}}"`,
	} {
		if !strings.Contains(modalsHTML, want) {
			t.Fatalf("modals.html missing issue #240 token %q", want)
		}
	}

	downloadStart := strings.Index(modalsHTML, `id="downloadRecordsModal"`)
	playbackStart := strings.Index(modalsHTML, `id="playbackHistoryModal"`)
	if downloadStart < 0 || playbackStart <= downloadStart {
		t.Fatal("could not isolate utility record modals")
	}
	downloadModal := modalsHTML[downloadStart:playbackStart]
	playbackModal := modalsHTML[playbackStart:]
	if strings.Contains(downloadModal, "download-records-footer") {
		t.Fatal("download records modal should not render a duplicate footer close button")
	}
	if strings.Contains(playbackModal, "utility-modal-footer") {
		t.Fatal("playback history modal should not render a duplicate footer close button")
	}

	for _, want := range []string{
		".btn-play.is-stop",
		".settings-tabs",
		".settings-tab-panel",
		".settings-save-bar",
		".aplayer.aplayer-fixed.aplayer-narrow .player-speed-wrap",
		".aplayer.aplayer-fixed.is-empty .player-speed-wrap",
		".search-btn:disabled",
		".mobile-more-actions.is-open",
	} {
		if !strings.Contains(styleCSS, want) {
			t.Fatalf("style.css missing issue #240 token %q", want)
		}
	}

	for _, want := range []string{
		"Web setup token:",
		`aria-describedby="setup-token-help"`,
	} {
		if !strings.Contains(authHTML, want) {
			t.Fatalf("auth.html missing issue #240 token %q", want)
		}
	}

	if !strings.Contains(indexHTML, `id="locate-current-track"`) {
		t.Fatal("index.html missing current track locator")
	}
	if strings.Contains(indexHTML, `onclick="scrollToBottom()"`) {
		t.Fatal("index.html should remove the scroll-to-bottom toolbar button")
	}

	for _, want := range []string{
		"--vg-progress",
		"flex: 0 0 40px",
		"border-radius: 8px",
	} {
		if !strings.Contains(videoCSS, want) {
			t.Fatalf("videogen.css missing issue #240 token %q", want)
		}
	}
	if !strings.Contains(videoJS, `style.setProperty('--vg-progress'`) {
		t.Fatal("videogen.js must update the themed seek progress")
	}
}
