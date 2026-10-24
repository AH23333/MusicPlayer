package web

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPagesUseEmbeddedVendorAssets(t *testing.T) {
	pages := []string{
		"templates/pages/index.html",
		"templates/pages/auth.html",
		"templates/pages/render.html",
	}
	for _, page := range pages {
		content, err := templateFS.ReadFile(page)
		if err != nil {
			t.Fatalf("read %s: %v", page, err)
		}
		body := string(content)
		if strings.Contains(body, "cdn.jsdelivr.net") {
			t.Fatalf("%s still depends on jsDelivr", page)
		}
		if !strings.Contains(body, "{{.Root}}/vendor/fontawesome/css/all.min.css") {
			t.Fatalf("%s does not use the embedded Font Awesome stylesheet", page)
		}
	}

	index, err := templateFS.ReadFile("templates/pages/index.html")
	if err != nil {
		t.Fatal(err)
	}
	indexBody := string(index)
	for _, asset := range []string{
		"{{.Root}}/vendor/aplayer/APlayer.min.css",
		"{{.Root}}/vendor/aplayer/APlayer.min.js",
		"{{.Root}}/vendor/sakana/sakana.min.css",
		"{{.Root}}/vendor/sakana/sakana.min.js",
	} {
		if !strings.Contains(indexBody, asset) {
			t.Fatalf("index.html missing embedded asset %q", asset)
		}
	}
}

func TestEmbeddedVendorAssetsAreServed(t *testing.T) {
	assets, err := embeddedVendorFS()
	if err != nil {
		t.Fatal(err)
	}
	handler := http.FileServer(http.FS(assets))
	for _, name := range []string{
		"aplayer/APlayer.min.css",
		"aplayer/APlayer.min.js",
		"fontawesome/css/all.min.css",
		"fontawesome/webfonts/fa-solid-900.woff2",
		"sakana/sakana.min.css",
		"sakana/sakana.min.js",
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/"+name, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("GET /%s status = %d, want %d", name, rec.Code, http.StatusOK)
			}
			if rec.Body.Len() == 0 {
				t.Fatalf("GET /%s returned an empty body", name)
			}
			if _, err := fs.Stat(assets, name); err != nil {
				t.Fatalf("embedded asset %s: %v", name, err)
			}
		})
	}
}
