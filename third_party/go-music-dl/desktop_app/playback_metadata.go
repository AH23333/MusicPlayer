package main

import (
	"encoding/json"
	"errors"
	"strings"
)

type playbackMetadata struct {
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album"`
	PositionMS int64  `json:"positionMs"`
	DurationMS int64  `json:"durationMs"`
	Playing    bool   `json:"playing"`
}

func parsePlaybackMetadata(raw string) (playbackMetadata, error) {
	var metadata playbackMetadata
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &metadata); err != nil {
		return playbackMetadata{}, err
	}
	if strings.TrimSpace(metadata.Title) == "" &&
		strings.TrimSpace(metadata.Artist) == "" &&
		strings.TrimSpace(metadata.Album) == "" &&
		metadata.PositionMS == 0 &&
		metadata.DurationMS == 0 &&
		!metadata.Playing {
		return playbackMetadata{}, errors.New("playback metadata is empty")
	}

	metadata.Title = clampPlaybackText(metadata.Title, 512)
	metadata.Artist = clampPlaybackText(metadata.Artist, 512)
	metadata.Album = clampPlaybackText(metadata.Album, 512)
	if metadata.PositionMS < 0 {
		metadata.PositionMS = 0
	}
	if metadata.DurationMS < 0 {
		metadata.DurationMS = 0
	}
	if metadata.DurationMS > 0 && metadata.PositionMS > metadata.DurationMS {
		metadata.PositionMS = metadata.DurationMS
	}
	return metadata, nil
}

func clampPlaybackText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 {
		return value
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
