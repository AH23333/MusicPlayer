package main

import (
	"strings"
	"testing"
)

func TestParsePlaybackMetadata(t *testing.T) {
	metadata, err := parsePlaybackMetadata(`{
		"title":"  Song  ",
		"artist":"Artist",
		"album":"Album",
		"positionMs":125000,
		"durationMs":180000,
		"playing":true
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Title != "Song" || metadata.Artist != "Artist" || metadata.Album != "Album" {
		t.Fatalf("unexpected text metadata: %+v", metadata)
	}
	if metadata.PositionMS != 125000 || metadata.DurationMS != 180000 || !metadata.Playing {
		t.Fatalf("unexpected playback metadata: %+v", metadata)
	}
}

func TestParsePlaybackMetadataClampsInvalidValues(t *testing.T) {
	metadata, err := parsePlaybackMetadata(`{
		"title":"` + strings.Repeat("x", 600) + `",
		"positionMs":-10,
		"durationMs":5000,
		"playing":true
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(metadata.Title) != 512 {
		t.Fatalf("title length = %d, want 512", len(metadata.Title))
	}
	if metadata.PositionMS != 0 || metadata.DurationMS != 5000 {
		t.Fatalf("unexpected clamped metadata: %+v", metadata)
	}
}

func TestParsePlaybackMetadataRejectsEmptyPayload(t *testing.T) {
	if _, err := parsePlaybackMetadata(`{"title":"","artist":"","album":"","positionMs":0,"durationMs":0,"playing":false}`); err == nil {
		t.Fatal("empty playback metadata should be rejected")
	}
}
