package youtube

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseSeconds(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    int
		wantErr bool
	}{
		{
			name:    "integer seconds",
			input:   "42",
			want:    42,
			wantErr: false,
		},
		{
			name:    "fractional seconds",
			input:   "42.567",
			want:    42,
			wantErr: false,
		},
		{
			name:    "zero",
			input:   "0",
			want:    0,
			wantErr: false,
		},
		{
			name:    "zero with fraction",
			input:   "0.999",
			want:    0,
			wantErr: false,
		},
		{
			name:    "decimal point at start",
			input:   ".5",
			want:    0,
			wantErr: false,
		},
		{
			name:    "invalid input",
			input:   "abc",
			want:    0,
			wantErr: true,
		},
		{
			name:    "empty string",
			input:   "",
			want:    0,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseSeconds(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Errorf("parseSeconds(%q) expected error but got none", tt.input)
				}
				return
			}

			if err != nil {
				t.Fatalf("parseSeconds(%q) unexpected error: %v", tt.input, err)
			}

			if got != tt.want {
				t.Errorf("parseSeconds(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestExtractAndValidateVideoId(t *testing.T) {
	yt := NewYouTube()

	tests := []struct {
		name      string
		url       string
		wantId    string
		wantError bool
		errorMsg  string
	}{
		{
			name:      "valid video URL",
			url:       "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			wantId:    "dQw4w9WgXcQ",
			wantError: false,
		},
		{
			name:      "valid short URL",
			url:       "https://youtu.be/dQw4w9WgXcQ",
			wantId:    "dQw4w9WgXcQ",
			wantError: false,
		},
		{
			name:      "video with playlist URL - should extract video",
			url:       "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
			wantId:    "dQw4w9WgXcQ",
			wantError: false,
		},
		{
			name:      "playlist-only URL",
			url:       "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
			wantId:    "",
			wantError: true,
			errorMsg:  "URL is a playlist, not a video",
		},
		{
			name:      "invalid URL",
			url:       "https://example.com",
			wantId:    "",
			wantError: true,
			errorMsg:  "invalid YouTube URL",
		},
		{
			name:      "empty URL",
			url:       "",
			wantId:    "",
			wantError: true,
		},
		{
			name:      "malformed URL",
			url:       "not-a-url",
			wantId:    "",
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := yt.extractAndValidateVideoId(tt.url)

			if tt.wantError {
				if err == nil {
					t.Errorf("extractAndValidateVideoId(%q) expected error but got none", tt.url)
					return
				}
				if tt.errorMsg != "" && !strings.Contains(err.Error(), tt.errorMsg) {
					t.Errorf("extractAndValidateVideoId(%q) error = %v, want error containing %q", tt.url, err, tt.errorMsg)
				}
				if got != "" {
					t.Errorf("extractAndValidateVideoId(%q) returned videoId %q on error, want empty string", tt.url, got)
				}
				return
			}

			if err != nil {
				t.Errorf("extractAndValidateVideoId(%q) unexpected error = %v", tt.url, err)
				return
			}

			if got != tt.wantId {
				t.Errorf("extractAndValidateVideoId(%q) = %q, want %q", tt.url, got, tt.wantId)
			}
		})
	}
}

func TestYtDlpLangSteps(t *testing.T) {
	// No "en.*": YouTube names auto-translated tracks en-<source> (en-af,
	// en-ja, ...), so a wildcard asks for dozens of tracks and YouTube
	// answers HTTP 429 after the first one or two. Each step is one yt-dlp
	// run; "" is a run without --sub-langs.
	const enRegional = `--sub-langs en-(?-i:[A-Z]{2}|\d{3})`
	const original = `--sub-langs .*-orig`
	tests := []struct {
		name     string
		language string
		userArgs []string
		want     []string
	}{
		{"no user flag", "en", nil, []string{"--sub-langs en-orig", "--sub-langs en", enRegional, original, ""}},
		{"user --sub-lang", "en", []string{"--sub-lang", "en-orig"}, []string{"", ""}},
		{"user --sub-langs=", "en", []string{"--sub-langs=en-orig"}, []string{"", ""}},
		{"no language", "", nil, []string{"", ""}},
		{"one letter language", "e", nil, []string{"--sub-langs e-orig", "--sub-langs e", `--sub-langs e-(?-i:[A-Z]{2}|\d{3})`, original, ""}},
		{"regional language", "en-GB", nil, []string{"--sub-langs en-orig", "--sub-langs en-GB,en", enRegional, original, ""}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got []string
			for _, step := range ytDlpLangSteps(tt.language, tt.userArgs) {
				got = append(got, strings.Join(step, " "))
			}
			if strings.Join(got, " | ") != strings.Join(tt.want, " | ") {
				t.Errorf("ytDlpLangSteps(%q, %v) = %q, want %q", tt.language, tt.userArgs, got, tt.want)
			}
		})
	}
}

// fakeYtDlpTracks is a yt-dlp stand-in for a video whose only caption track
// is $FAKE_TRACK. It logs each --sub-langs value (or "-" for none) to
// $FAKE_LOG and writes a VTT file only when the value would match the track
// in real yt-dlp: the exact name, the regional pattern, or no filter at all.
// For de-orig it acts like a German video on YouTube: "en" and yt-dlp's own
// pick are auto-translations, which YouTube answers with HTTP 429.
const fakeYtDlpTracks = `#!/bin/sh
langs=-
while [ $# -gt 0 ]; do
	case "$1" in
	-o) out="$2"; shift ;;
	--sub-langs) langs="$2"; shift ;;
	esac
	shift
done
echo "$langs" >> "$FAKE_LOG"
case "$FAKE_TRACK:$langs" in
de-orig:'.*-orig')
	printf 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\ntrack %s\n' "$FAKE_TRACK" > "$(dirname "$out")/video.$FAKE_TRACK.vtt" ;;
de-orig:en | de-orig:-)
	echo "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests" ;;
en-orig:en-orig | en:en | en-GB:*'[A-Z]'* | *:-)
	printf 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\ntrack %s\n' "$FAKE_TRACK" > "$(dirname "$out")/video.$FAKE_TRACK.vtt" ;;
*)
	echo "WARNING: $langs subtitles not available for dQw4w9WgXcQ" ;;
esac
`

func TestGrabTranscriptLanguageSteps(t *testing.T) {
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "yt-dlp"), []byte(fakeYtDlpTracks), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))

	tests := []struct {
		track     string
		wantCalls string
	}{
		// One yt-dlp run when the English original track exists.
		{"en-orig", "en-orig"},
		// No en-orig, so the exact run follows.
		{"en", "en-orig | en"},
		// Neither finds anything, so the regional run follows.
		{"en-GB", `en-orig | en | en-(?-i:[A-Z]{2}|\d{3})`},
		// "en" is a refused auto-translation, so the original track follows.
		{"de-orig", `en-orig | en | en-(?-i:[A-Z]{2}|\d{3}) | .*-orig`},
	}
	for _, tt := range tests {
		t.Run(tt.track, func(t *testing.T) {
			logFile := filepath.Join(t.TempDir(), "calls")
			t.Setenv("FAKE_LOG", logFile)
			t.Setenv("FAKE_TRACK", tt.track)

			got, err := NewYouTube().GrabTranscript("dQw4w9WgXcQ", "en")
			if err != nil {
				t.Fatalf("GrabTranscript: %v", err)
			}
			if !strings.Contains(got, "track "+tt.track) {
				t.Errorf("transcript = %q, want the %s track", got, tt.track)
			}
			calls, err := os.ReadFile(logFile)
			if err != nil {
				t.Fatal(err)
			}
			if gotCalls := strings.Join(strings.Fields(string(calls)), " | "); gotCalls != tt.wantCalls {
				t.Errorf("yt-dlp --sub-langs per run = %q, want %q", gotCalls, tt.wantCalls)
			}
		})
	}
}

// fakeYtDlpBurstLimit answers HTTP 429 to every run without
// --sleep-requests, as YouTube does during a short burst limit, and logs
// "fast" or "slow" for each run to $FAKE_LOG.
const fakeYtDlpBurstLimit = `#!/bin/sh
speed=fast
while [ $# -gt 0 ]; do
	case "$1" in
	-o) out="$2"; shift ;;
	--sleep-requests) speed=slow ;;
	esac
	shift
done
echo "$speed" >> "$FAKE_LOG"
if [ "$speed" = fast ]; then
	echo "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests"
else
	printf 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nslow pass\n' > "$(dirname "$out")/video.en.vtt"
fi
`

func TestGrabTranscriptRetriesSlowerAfterRateLimit(t *testing.T) {
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "yt-dlp"), []byte(fakeYtDlpBurstLimit), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))
	saved := rateLimitRetryDelay
	rateLimitRetryDelay = 0
	t.Cleanup(func() { rateLimitRetryDelay = saved })

	logFile := filepath.Join(t.TempDir(), "calls")
	t.Setenv("FAKE_LOG", logFile)

	got, err := NewYouTube().GrabTranscript("dQw4w9WgXcQ", "en")
	if err != nil {
		t.Fatalf("GrabTranscript: %v", err)
	}
	if !strings.Contains(got, "slow pass") {
		t.Errorf("transcript = %q, want the slow pass", got)
	}
	calls, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatal(err)
	}
	// Five fast language steps, all rate-limited, then the first slow one.
	if gotCalls := strings.Join(strings.Fields(string(calls)), " "); gotCalls != "fast fast fast fast fast slow" {
		t.Errorf("runs = %q, want five fast runs and one slow", gotCalls)
	}

	// With the user's own --sleep-requests there is no second pass.
	_ = os.Remove(logFile)
	if _, err = NewYouTube().GrabTranscriptWithArgs("dQw4w9WgXcQ", "en", "--sleep-requests 0"); err != nil {
		t.Fatalf("GrabTranscriptWithArgs: %v", err)
	}
	calls, _ = os.ReadFile(logFile)
	if n := len(strings.Fields(string(calls))); n != 1 {
		t.Errorf("runs with user --sleep-requests = %d, want 1", n)
	}
}

// fakeYtDlpWarns429 downloads the requested track but, like real yt-dlp when
// one of its player clients or an extra caption track is refused, also
// prints a 429 warning. It logs one line per run to $FAKE_LOG.
const fakeYtDlpWarns429 = `#!/bin/sh
while [ $# -gt 0 ]; do
	case "$1" in
	-o) out="$2"; shift ;;
	esac
	shift
done
echo run >> "$FAKE_LOG"
echo "WARNING: [youtube] dQw4w9WgXcQ: Unable to download subtitles for 'en-de': HTTP Error 429: Too Many Requests"
printf 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\ngot it\n' > "$(dirname "$out")/video.en.vtt"
`

func TestGrabTranscriptKeepsDownloadDespite429Warning(t *testing.T) {
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "yt-dlp"), []byte(fakeYtDlpWarns429), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))
	saved := rateLimitRetryDelay
	rateLimitRetryDelay = 0
	t.Cleanup(func() { rateLimitRetryDelay = saved })
	logFile := filepath.Join(t.TempDir(), "calls")
	t.Setenv("FAKE_LOG", logFile)

	got, err := NewYouTube().GrabTranscript("dQw4w9WgXcQ", "en")
	if err != nil {
		t.Fatalf("GrabTranscript: %v (the captions were downloaded)", err)
	}
	if !strings.Contains(got, "got it") {
		t.Errorf("transcript = %q", got)
	}
	calls, _ := os.ReadFile(logFile)
	if n := len(strings.Fields(string(calls))); n != 1 {
		t.Errorf("yt-dlp runs = %d, want 1: each extra run is more requests to YouTube", n)
	}
}

func TestPickCaptionFile(t *testing.T) {
	tests := []struct {
		files    []string
		language string
		want     string // "" means no acceptable file
	}{
		{[]string{"v.ar.vtt", "v.en.vtt"}, "en", "v.en.vtt"},
		// A dubbed video: en merges translations of the dubs; en-orig is real.
		{[]string{"v.bn-orig.vtt", "v.en.vtt", "v.en-orig.vtt"}, "en", "v.en-orig.vtt"},
		{[]string{"v.bn.vtt", "v.en-orig.vtt"}, "en", "v.en-orig.vtt"},
		{[]string{"v.en-GB.vtt", "v.fr.vtt"}, "en", "v.en-GB.vtt"},
		{[]string{"v.es-419.vtt"}, "es", "v.es-419.vtt"},
		{[]string{"v.en.vtt"}, "en-US", "v.en.vtt"},
		// A video in another language: its original track beats nothing.
		{[]string{"v.ar.vtt", "v.de-orig.vtt"}, "en", "v.de-orig.vtt"},
		// Only machine translations into other languages: refuse them.
		{[]string{"v.ar.vtt", "v.bn.vtt"}, "en", ""},
		// en-orig is not a regional variant of en, and en-af is a translation.
		{[]string{"v.en-af.vtt"}, "en", ""},
	}
	for _, tt := range tests {
		got, ok := pickCaptionFile(tt.files, tt.language)
		if !ok {
			got = ""
		}
		if got != tt.want {
			t.Errorf("pickCaptionFile(%v, %q) = %q, want %q", tt.files, tt.language, got, tt.want)
		}
	}
}

// fakeYtDlpStrayTranslation acts like a run where YouTube refuses the English
// track but a machine translation (Bengali) still downloads, and only the
// original-language run gets the real English captions.
const fakeYtDlpStrayTranslation = `#!/bin/sh
langs=-
while [ $# -gt 0 ]; do
	case "$1" in
	-o) out="$2"; shift ;;
	--sub-langs) langs="$2"; shift ;;
	esac
	shift
done
dir="$(dirname "$out")"
case "$langs" in
'.*-orig')
	printf 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nreal english\n' > "$dir/video.en-orig.vtt" ;;
*)
	printf 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nbengali translation\n' > "$dir/video.bn.vtt"
	echo "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests" ;;
esac
`

func TestGrabTranscriptNeverReturnsAMachineTranslation(t *testing.T) {
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "yt-dlp"), []byte(fakeYtDlpStrayTranslation), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))
	saved := rateLimitRetryDelay
	rateLimitRetryDelay = 0
	t.Cleanup(func() { rateLimitRetryDelay = saved })

	got, err := NewYouTube().GrabTranscript("dQw4w9WgXcQ", "en")
	if err != nil {
		t.Fatalf("GrabTranscript: %v", err)
	}
	if !strings.Contains(got, "real english") || strings.Contains(got, "bengali") {
		t.Errorf("transcript = %q, want the English original track", got)
	}
}
