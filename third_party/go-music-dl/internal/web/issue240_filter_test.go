package web

import (
	"reflect"
	"testing"

	"github.com/guohuiyuan/go-music-dl/core"
	"github.com/guohuiyuan/music-lib/model"
)

func TestFilterSongsForDisplayAppliesVersionAndShortTrackFilters(t *testing.T) {
	songs := []model.Song{
		{ID: "normal", Name: "Normal Song", Duration: 180},
		{ID: "live", Name: "Normal Song (LIVE)", Duration: 180},
		{ID: "remix", Name: "Normal Song remix", Duration: 180},
		{ID: "demo", Name: "正常歌曲（Demo）", Duration: 180},
		{ID: "preview", Name: "Another Song", Duration: 59},
		{ID: "exact-minute", Name: "One Minute", Duration: 60},
		{ID: "unknown-duration", Name: "Unknown Duration", Duration: 0},
	}
	settings := core.WebSettings{
		FilterVersionKeywords: true,
		VersionFilterKeywords: "Live，Remix; Demo\nMissing",
		FilterShortTracks:     true,
	}

	filtered := filterSongsForDisplay(songs, settings)
	got := make([]string, 0, len(filtered))
	for _, song := range filtered {
		got = append(got, song.ID)
	}
	want := []string{"normal", "exact-minute", "unknown-duration"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("filtered IDs = %#v, want %#v", got, want)
	}
	if len(songs) != 7 {
		t.Fatal("filtering must not mutate the input slice")
	}
}

func TestFilterSongsForDisplayIsDisabledByDefault(t *testing.T) {
	songs := []model.Song{
		{ID: "live", Name: "Live Preview", Duration: 20},
	}
	filtered := filterSongsForDisplay(songs, core.WebSettings{})
	if len(filtered) != 1 || filtered[0].ID != "live" {
		t.Fatalf("disabled filters changed songs: %#v", filtered)
	}
}
