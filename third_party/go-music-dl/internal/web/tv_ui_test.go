package web

import (
	"strings"
	"testing"
)

func TestTVUIAssets(t *testing.T) {
	t.Parallel()

	searchBox, err := templateFS.ReadFile("templates/partials/search_box.html")
	if err != nil {
		t.Fatalf("ReadFile(search_box.html): %v", err)
	}
	appJS, err := templateFS.ReadFile("templates/static/js/app.js")
	if err != nil {
		t.Fatalf("ReadFile(app.js): %v", err)
	}
	styleCSS, err := templateFS.ReadFile("templates/static/css/style.css")
	if err != nil {
		t.Fatalf("ReadFile(style.css): %v", err)
	}

	checks := []struct {
		name    string
		content string
		token   string
	}{
		{
			name:    "source label is a TV focus target",
			content: string(searchBox),
			token:   `<label class="source-option">`,
		},
		{
			name:    "TV mode can be forced or disabled by query",
			content: string(appJS),
			token:   `const TV_UI_QUERY_PARAM = "tv";`,
		},
		{
			name:    "default focus respects selector priority",
			content: string(appJS),
			token:   "function firstTVFocusMatch(scope, selectors)",
		},
		{
			name:    "native TV key bridge is exposed",
			content: string(appJS),
			token:   "window.__musicDlTVHandleKey = handleTVNavigationAction;",
		},
		{
			name:    "native back bridge is exposed",
			content: string(appJS),
			token:   "window.__musicDlHandleBack = closeTVTopLayer;",
		},
		{
			name:    "missing player CDN does not abort the page",
			content: string(appJS),
			token:   `if (ap && typeof ap.on === "function") {`,
		},
		{
			name:    "wide TV layout",
			content: string(styleCSS),
			token:   "max-width: min(1680px,",
		},
		{
			name:    "focused source card highlight",
			content: string(styleCSS),
			token:   ".source-option:focus .source-card",
		},
	}

	for _, check := range checks {
		if !strings.Contains(check.content, check.token) {
			t.Errorf("%s: missing %q", check.name, check.token)
		}
	}
}
