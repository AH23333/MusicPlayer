package web

import (
	"strings"
	"testing"
)

func TestAppJSTaskbarThumbnailBridge(t *testing.T) {
	content, err := templateFS.ReadFile("templates/static/js/app.js")
	if err != nil {
		t.Fatalf("ReadFile(app.js): %v", err)
	}

	js := string(content)
	for _, want := range []string{
		"function syncTaskbarPlaybackState()",
		`window.musicDlTaskbarState(hasTracks, isPlaying)`,
		"window.musicDlTaskbarControl = function (action, value)",
		`case "previous":`,
		`case "toggle":`,
		`case "next":`,
		"setInterval(syncTaskbarPlaybackState, 500);",
		`ap.on("play", () => {`,
		`ap.on("pause", () => {`,
		`ap.on("ended", () => {`,
	} {
		if !strings.Contains(js, want) {
			t.Fatalf("app.js missing taskbar bridge token %q", want)
		}
	}
}
