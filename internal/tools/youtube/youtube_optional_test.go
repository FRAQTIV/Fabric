package youtube

import "testing"

func TestNewYouTubeApiKeyOptional(t *testing.T) {
	yt := NewYouTube()

	if yt.ApiKey == nil {
		t.Fatal("expected API key setup question to be initialized")
	}

	if yt.ApiKey.Required {
		t.Fatalf("expected YouTube API key to be optional, but it is marked as required")
	}

	if !yt.IsConfigured() {
		t.Fatalf("expected YouTube plugin to be considered configured without an API key")
	}
}
