//go:build windows

package main

import (
	"strings"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestMakeThumbButtonsReflectPlaybackState(t *testing.T) {
	icons := taskbarIcons{
		previous: 0x11,
		play:     0x22,
		pause:    0x33,
		next:     0x44,
	}

	buttons := makeThumbButtons(true, true, icons)
	if buttons[0].ID != taskbarButtonPrevious ||
		buttons[1].ID != taskbarButtonToggle ||
		buttons[2].ID != taskbarButtonNext {
		t.Fatalf("unexpected taskbar button order: %#v", buttons)
	}
	if buttons[1].Icon != icons.pause {
		t.Fatalf("toggle icon = %#x, want pause icon %#x", buttons[1].Icon, icons.pause)
	}
	if got := windows.UTF16ToString(buttons[1].Tip[:]); got != "暂停" {
		t.Fatalf("toggle tooltip = %q, want 暂停", got)
	}
	for i, button := range buttons {
		if button.Flags != thbfEnabled {
			t.Fatalf("button %d flags = %#x, want enabled", i, button.Flags)
		}
	}

	buttons = makeThumbButtons(false, false, icons)
	if buttons[1].Icon != icons.play {
		t.Fatalf("idle toggle icon = %#x, want play icon %#x", buttons[1].Icon, icons.play)
	}
	if got := windows.UTF16ToString(buttons[1].Tip[:]); got != "播放" {
		t.Fatalf("idle toggle tooltip = %q, want 播放", got)
	}
	for i, button := range buttons {
		if button.Flags != thbfDisabled {
			t.Fatalf("button %d flags = %#x, want disabled", i, button.Flags)
		}
	}
}

func TestTaskbarCommandMapping(t *testing.T) {
	tests := []struct {
		name   string
		wParam uintptr
		want   taskbarAction
	}{
		{"previous", uintptr(thbnClicked<<16 | taskbarButtonPrevious), taskbarActionPrevious},
		{"toggle", uintptr(thbnClicked<<16 | taskbarButtonToggle), taskbarActionToggle},
		{"next", uintptr(thbnClicked<<16 | taskbarButtonNext), taskbarActionNext},
		{"wrong notification", uintptr(taskbarButtonToggle), ""},
		{"unknown button", uintptr(thbnClicked<<16 | 0x1234), ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := taskbarActionFromCommand(test.wParam); got != test.want {
				t.Fatalf("taskbarActionFromCommand(%#x) = %q, want %q", test.wParam, got, test.want)
			}
		})
	}
}

func TestTaskbarControlScriptIsSafe(t *testing.T) {
	script := taskbarControlScript(taskbarActionNext)
	for _, want := range []string{"window.musicDlTaskbarControl", `"next"`} {
		if !strings.Contains(script, want) {
			t.Fatalf("control script missing %q: %s", want, script)
		}
	}
}

func TestThumbButtonMatchesNativeLayout(t *testing.T) {
	want := uintptr(552)
	if unsafe.Sizeof(uintptr(0)) == 4 {
		want = 544
	}
	if got := unsafe.Sizeof(thumbButton{}); got != want {
		t.Fatalf("THUMBBUTTON size = %d, want %d", got, want)
	}
}

func TestTaskbarIconsCanBeCreated(t *testing.T) {
	icons, err := createTaskbarIcons()
	if err != nil {
		t.Fatalf("createTaskbarIcons: %v", err)
	}
	defer icons.destroy()

	for name, icon := range map[string]uintptr{
		"previous": icons.previous,
		"play":     icons.play,
		"pause":    icons.pause,
		"next":     icons.next,
	} {
		if icon == 0 {
			t.Fatalf("%s icon is nil", name)
		}
	}
}

func TestRenderMonochromeIcon(t *testing.T) {
	andBits, xorBits := renderMonochromeIcon(taskbarIconPlay, 16)
	if len(andBits) != 64 || len(xorBits) != 64 {
		t.Fatalf("icon buffer sizes = %d/%d, want 64/64", len(andBits), len(xorBits))
	}
	for i := range andBits {
		if andBits[i] != 0xFF || xorBits[i] != 0 {
			return
		}
	}
	t.Fatal("play icon has no visible pixels")
}

func TestTaskbarIconsUseRoundedCorners(t *testing.T) {
	pixelIsVisible := func(kind taskbarIconKind, x, y int) bool {
		andBits, _ := renderMonochromeIcon(kind, 16)
		stride := 4
		row := 16 - 1 - y
		mask := byte(0x80 >> (x % 8))
		return andBits[row*stride+x/8]&mask == 0
	}

	for _, test := range []struct {
		name      string
		kind      taskbarIconKind
		x, y      int
		wantShown bool
	}{
		{"play sharp tip removed", taskbarIconPlay, 13, 8, false},
		{"play interior retained", taskbarIconPlay, 12, 8, true},
		{"pause top-left rounded", taskbarIconPause, 3, 2, false},
		{"pause top-right rounded", taskbarIconPause, 5, 2, false},
		{"pause interior retained", taskbarIconPause, 4, 3, true},
		{"previous bar top rounded", taskbarIconPrevious, 11, 2, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := pixelIsVisible(test.kind, test.x, test.y); got != test.wantShown {
				t.Fatalf("pixel (%d,%d) visible = %v, want %v", test.x, test.y, got, test.wantShown)
			}
		})
	}
}
