package web

import (
	"strings"
	"testing"
)

func TestVideoGenPrewarmsPlayerAudioRouting(t *testing.T) {
	videoJS, err := templateFS.ReadFile("templates/static/js/videogen.js")
	if err != nil {
		t.Fatalf("read videogen.js: %v", err)
	}
	appJS, err := templateFS.ReadFile("templates/static/js/app.js")
	if err != nil {
		t.Fatalf("read app.js: %v", err)
	}
	appSource := strings.ReplaceAll(string(appJS), "\r\n", "\n")

	for _, want := range []string{
		"prepareAudioRouting: function(options = {})",
		"if (!this._audioRoutingConnected)",
		"window.VideoGen.prepareAudioRouting();",
	} {
		if !strings.Contains(string(videoJS), want) {
			t.Fatalf("videogen.js missing shared audio routing token %q", want)
		}
	}

	for _, want := range []string{
		`document.addEventListener("pointerdown", resumeVideoGenAudioRouting`,
		`document.addEventListener("keydown", resumeVideoGenAudioRouting`,
		`ap.on("play", () => {
    resumeVideoGenAudioRouting();`,
	} {
		if !strings.Contains(appSource, want) {
			t.Fatalf("app.js missing early audio resume token %q", want)
		}
	}
}
