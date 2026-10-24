package core

import (
	"path/filepath"
	"testing"

	"github.com/guohuiyuan/music-lib/model"
)

func TestNormalizeChineseVariantsForDownload(t *testing.T) {
	original := &model.Song{
		ID:     "song-id",
		Name:   "Summer 久石讓\u200b",
		Artist: "久石讓\u200c",
		Album:  "ENCORE",
		Source: "netease",
	}
	normalized := NormalizeSongForDownload(original)

	if normalized.Name != "Summer 久石让" {
		t.Fatalf("normalized name = %q", normalized.Name)
	}
	if normalized.Artist != "久石让" {
		t.Fatalf("normalized artist = %q", normalized.Artist)
	}
	if normalized.ID != original.ID || normalized.Source != original.Source {
		t.Fatal("normalization must not change lookup IDs or source")
	}
	if original.Artist != "久石讓\u200c" {
		t.Fatal("normalization must not mutate the original song")
	}

	simplified := &model.Song{Name: "Summer 久石让", Artist: "久石让"}
	if SongKey(original) != SongKey(simplified) {
		t.Fatalf("variant song keys differ: %q vs %q", SongKey(original), SongKey(simplified))
	}
}

func TestBuildDownloadFilenameUsesChineseVariantSetting(t *testing.T) {
	baseDir := t.TempDir()
	t.Setenv("MUSIC_DL_CONFIG_DB", filepath.Join(baseDir, "settings.db"))
	resetConfigStateForTest()
	t.Cleanup(resetConfigStateForTest)

	if err := SaveWebSettings(WebSettings{
		NormalizeChineseVariants: true,
	}); err != nil {
		t.Fatalf("SaveWebSettings: %v", err)
	}

	filename := BuildDownloadFilename(
		&model.Song{Name: "Summer 久石讓\u200b", Artist: "久石讓\u200c"},
		"mp3",
		"{artist}/{name}",
	)
	if filename != filepath.Join("久石让", "Summer 久石让.mp3") {
		t.Fatalf("filename = %q", filename)
	}
}
