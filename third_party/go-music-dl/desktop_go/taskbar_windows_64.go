//go:build windows && (amd64 || arm64)

package main

type thumbButton struct {
	Mask  uint32
	ID    uint32
	Bmp   uint32
	Icon  uintptr
	Tip   [260]uint16
	Flags uint32
}
