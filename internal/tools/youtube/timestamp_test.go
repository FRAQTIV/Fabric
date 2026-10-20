package youtube

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseTimestampToSeconds(t *testing.T) {
	tests := []struct {
		timestamp string
		expected  int
		shouldErr bool
	}{
		{"00:30", 30, false},
		{"01:30", 90, false},
		{"01:05:30", 3930, false}, // 1 hour 5 minutes 30 seconds
		{"10:00", 600, false},
		{"invalid", 0, true},
		{"1:2:3:4", 0, true}, // too many parts
	}

	for _, test := range tests {
		result, err := parseTimestampToSeconds(test.timestamp)

		if test.shouldErr {
			if err == nil {
				t.Errorf("Expected error for timestamp %s, but got none", test.timestamp)
			}
		} else {
			if err != nil {
				t.Errorf("Unexpected error for timestamp %s: %v", test.timestamp, err)
			}
			if result != test.expected {
				t.Errorf("For timestamp %s, expected %d seconds, got %d", test.timestamp, test.expected, result)
			}
		}
	}
}

func TestShouldIncludeRepeat(t *testing.T) {
	tests := []struct {
		lastTimestamp    string
		currentTimestamp string
		expected         bool
		description      string
	}{
		{"00:30", "01:30", true, "60 second gap should allow repeat"},
		{"00:30", "00:45", true, "15 second gap should allow repeat"},
		{"01:00", "01:10", true, "10 second gap should allow repeat (boundary case)"},
		{"01:00", "01:09", false, "9 second gap should not allow repeat"},
		{"00:30", "00:35", false, "5 second gap should not allow repeat"},
		{"invalid", "01:30", true, "invalid timestamp should err on side of inclusion"},
		{"01:30", "invalid", true, "invalid timestamp should err on side of inclusion"},
	}

	for _, test := range tests {
		result := shouldIncludeRepeat(test.lastTimestamp, test.currentTimestamp)
		if result != test.expected {
			t.Errorf("%s: expected %v, got %v", test.description, test.expected, result)
		}
	}
}

func TestParseFFmpegFrameTimes(t *testing.T) {
	logOutput := `
[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0
[Parsed_showinfo_1 @ 0x1] n:   1 pts:    500 pts_time:0.5
[Parsed_showinfo_1 @ 0x1] n:   2 pts:   2500 pts_time:2.5
`

	frameTimes := parseFFmpegFrameTimes(logOutput)
	if len(frameTimes) != 3 {
		t.Fatalf("expected 3 frame times, got %d", len(frameTimes))
	}
	if frameTimes[0] != 0 || frameTimes[1] != 0.5 || frameTimes[2] != 2.5 {
		t.Fatalf("unexpected frame times: %#v", frameTimes)
	}
}

func TestParseFFmpegFrameTimes_ShowinfoLinesOnly(t *testing.T) {
	logOutput := `
    title           : pts_time:99
[Parsed_showinfo_1 @ 0x1] n:   0 pts:    -40 pts_time:-0.04
[Parsed_showinfo_1 @ 0x1] n:   1 pts:    460 pts_time:0.46
`

	frameTimes := parseFFmpegFrameTimes(logOutput)
	if len(frameTimes) != 2 || frameTimes[0] != -0.04 || frameTimes[1] != 0.46 {
		t.Fatalf("unexpected frame times: %#v", frameTimes)
	}
	if got := parseFFmpegFrameTimes(""); len(got) != 0 {
		t.Fatalf("expected no frame times for empty input, got %#v", got)
	}
}

func TestFormatCueTimestamp(t *testing.T) {
	tests := map[float64]string{
		-0.04:     "00:00:00.000",
		0:         "00:00:00.000",
		0.4995:    "00:00:00.500",
		3599.9996: "01:00:00.000",
		3600:      "01:00:00.000",
		90061.5:   "25:01:01.500",
	}
	for seconds, want := range tests {
		if got := formatCueTimestamp(seconds); got != want {
			t.Errorf("formatCueTimestamp(%v) = %s, want %s", seconds, got, want)
		}
	}
}

func TestVisualCueRange_UsesActualFrameTimes(t *testing.T) {
	frameTimes := []float64{0, 0.5, 2.5}

	start0, end0 := visualCueRange(frameTimes, 0)
	if start0 != "00:00:00.000" || end0 != "00:00:00.499" {
		t.Fatalf("unexpected first cue range: %s --> %s", start0, end0)
	}

	start1, end1 := visualCueRange(frameTimes, 1)
	if start1 != "00:00:00.500" || end1 != "00:00:02.499" {
		t.Fatalf("unexpected second cue range: %s --> %s", start1, end1)
	}
}

func writeExecutable(t *testing.T, dir, name, contents string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(contents), 0o755); err != nil {
		t.Fatalf("failed to write %s: %v", name, err)
	}
	return path
}

func TestGrabVisual_UsesFrameTimesFromFFmpeg(t *testing.T) {
	binDir := t.TempDir()
	writeExecutable(t, binDir, "yt-dlp", "#!/usr/bin/env bash\necho 'http://example.invalid/video'\n")
	writeExecutable(t, binDir, "ffmpeg", "#!/usr/bin/env bash\nout=\"${@: -1}\"\ntouch \"${out//%04d/0001}\"\ntouch \"${out//%04d/0002}\"\necho '[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0' >&2\necho '[Parsed_showinfo_1 @ 0x1] n:   1 pts:    500 pts_time:0.5' >&2\n")
	writeExecutable(t, binDir, "tesseract", "#!/usr/bin/env bash\ncase \"$1\" in\n  *0001.jpg) echo 'First frame text' ;;\n  *0002.jpg) echo 'Second frame text' ;;\n  *) echo 'Unknown frame text' ;;\nesac\n")

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	yt := NewYouTube()
	got, err := yt.GrabVisual("video123", "en", "", 0.4, 2)
	if err != nil {
		t.Fatalf("GrabVisual returned error: %v", err)
	}

	if !strings.Contains(got, "00:00:00.500 --> 00:00:01.499") {
		t.Fatalf("expected second frame to use ffmpeg-derived timing, got %q", got)
	}
	if !strings.Contains(got, "Second frame text") {
		t.Fatalf("expected second frame OCR text in output, got %q", got)
	}
}

func TestGrabVisual_FrameTimeCountMismatchUsesIndex(t *testing.T) {
	binDir := t.TempDir()
	writeExecutable(t, binDir, "yt-dlp", "#!/usr/bin/env bash\necho 'http://example.invalid/video'\n")
	writeExecutable(t, binDir, "ffmpeg", "#!/usr/bin/env bash\nout=\"${@: -1}\"\nfor n in 0001 0002 0003; do touch \"${out//%04d/$n}\"; done\necho '[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0' >&2\necho '[Parsed_showinfo_1 @ 0x1] n:   1 pts:  10000 pts_time:10' >&2\n")
	writeExecutable(t, binDir, "tesseract", "#!/usr/bin/env bash\necho \"Text for frame $(basename \"$1\")\"\n")

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	got, err := NewYouTube().GrabVisual("video123", "en", "", 0.4, 2)
	if err != nil {
		t.Fatalf("GrabVisual returned error: %v", err)
	}

	for _, cue := range []string{"00:00:00.000 --> 00:00:00.999", "00:00:01.000 --> 00:00:01.999", "00:00:02.000 --> 00:00:02.999"} {
		if !strings.Contains(got, cue) {
			t.Fatalf("expected index cue %q, got %q", cue, got)
		}
	}
}
