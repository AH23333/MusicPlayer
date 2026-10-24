package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareDesktopDataDirDoesNotUseLaunchCwdForDefaults(t *testing.T) {
	launchDir := t.TempDir()
	t.Chdir(launchDir)
	t.Setenv("MUSIC_DL_CONFIG_DB", "")
	t.Setenv("MUSIC_DL_COOKIE_FILE", "")
	t.Setenv("MUSIC_DL_FAVORITES_DB", "")

	dataDir := filepath.Join(t.TempDir(), "music-dl")
	got, err := prepareDesktopDataDirAt(dataDir)
	if err != nil {
		t.Fatalf("prepare desktop data dir: %v", err)
	}
	if got != dataDir {
		t.Fatalf("data dir mismatch: got %q want %q", got, dataDir)
	}

	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	if cwd != dataDir {
		t.Fatalf("working directory mismatch: got %q want %q", cwd, dataDir)
	}
	if info, err := os.Stat(dataDir); err != nil || !info.IsDir() {
		t.Fatalf("desktop data directory was not created: %v", err)
	}
	if _, err := os.Stat(filepath.Join(launchDir, "data")); !os.IsNotExist(err) {
		t.Fatalf("launch cwd should not be used for app data, stat error: %v", err)
	}

	configDB := os.Getenv("MUSIC_DL_CONFIG_DB")
	wantConfigDB := filepath.Join(dataDir, "data", "settings.db")
	if configDB != wantConfigDB {
		t.Fatalf("config db mismatch: got %q want %q", configDB, wantConfigDB)
	}
	cookieFile := os.Getenv("MUSIC_DL_COOKIE_FILE")
	wantCookieFile := filepath.Join(dataDir, "data", "cookies.json")
	if cookieFile != wantCookieFile {
		t.Fatalf("cookie file mismatch: got %q want %q", cookieFile, wantCookieFile)
	}
}

func TestPrepareDesktopDataDirPreservesExplicitPaths(t *testing.T) {
	launchDir := t.TempDir()
	t.Chdir(launchDir)
	t.Setenv("MUSIC_DL_CONFIG_DB", filepath.Join("custom", "settings.db"))
	cookieFile := filepath.Join(t.TempDir(), "cookies.json")
	t.Setenv("MUSIC_DL_COOKIE_FILE", cookieFile)
	t.Setenv("MUSIC_DL_FAVORITES_DB", filepath.Join("legacy", "favorites.db"))

	dataDir := filepath.Join(t.TempDir(), "music-dl")
	if _, err := prepareDesktopDataDirAt(dataDir); err != nil {
		t.Fatalf("prepare desktop data dir: %v", err)
	}

	wantConfigDB := filepath.Join(launchDir, "custom", "settings.db")
	if got := os.Getenv("MUSIC_DL_CONFIG_DB"); got != wantConfigDB {
		t.Fatalf("relative config override should resolve from launch cwd: got %q want %q", got, wantConfigDB)
	}
	if got := os.Getenv("MUSIC_DL_COOKIE_FILE"); got != cookieFile {
		t.Fatalf("absolute cookie override changed: got %q want %q", got, cookieFile)
	}
	wantFavoritesDB := filepath.Join(launchDir, "legacy", "favorites.db")
	if got := os.Getenv("MUSIC_DL_FAVORITES_DB"); got != wantFavoritesDB {
		t.Fatalf("relative favorites override should resolve from launch cwd: got %q want %q", got, wantFavoritesDB)
	}
}
