package domain

// StreamType distinguishes between partial text content and metadata events.
type StreamType string

const (
	StreamTypeContent StreamType = "content"
	StreamTypeUsage   StreamType = "usage"
	StreamTypeError   StreamType = "error"
)

// StreamUpdate is the unified payload sent through the internal channels.
type StreamUpdate struct {
	Type    StreamType     `json:"type"`
	Content string         `json:"content,omitempty"` // For text deltas
	Usage   *UsageMetadata `json:"usage,omitempty"`   // For token counts
}

// UsageMetadata normalizes token counts across different providers.
type UsageMetadata struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}
