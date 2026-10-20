package ai

import (
	"bytes"
	"context"
	"sync"
	"testing"

	"github.com/danielmiessler/fabric/internal/chat"
	"github.com/danielmiessler/fabric/internal/domain"
)

type stubVendor struct {
	name string
}

func (v *stubVendor) GetName() string                       { return v.name }
func (v *stubVendor) GetSetupDescription() string           { return "" }
func (v *stubVendor) IsConfigured() bool                    { return true }
func (v *stubVendor) Configure() error                      { return nil }
func (v *stubVendor) Setup() error                          { return nil }
func (v *stubVendor) SetupFillEnvFileContent(*bytes.Buffer) {}
func (v *stubVendor) ListModels(context.Context) ([]string, error) {
	return []string{v.name + "-model"}, nil
}
func (v *stubVendor) SendStream(context.Context, []*chat.ChatCompletionMessage, *domain.ChatOptions, chan domain.StreamUpdate) error {
	return nil
}
func (v *stubVendor) Send(context.Context, []*chat.ChatCompletionMessage, *domain.ChatOptions) (string, error) {
	return "", nil
}
func (v *stubVendor) NeedsRawMode(string) bool { return false }

// TestVendorsManager_GetModelsConcurrent calls GetModels from 8 goroutines
// at the same time. Run it with -race. Without modelsMu, the race detector
// finds a data race on Models.
func TestVendorsManager_GetModelsConcurrent(t *testing.T) {
	manager := NewVendorsManager()
	manager.AddVendors(&stubVendor{name: "OpenAI"}, &stubVendor{name: "Anthropic"})

	const n = 8
	var wg sync.WaitGroup
	results := make([]*VendorsModels, n)
	wg.Add(n)
	for i := range n {
		go func() {
			defer wg.Done()
			results[i], _ = manager.GetModels()
		}()
	}
	wg.Wait()

	// The lazy init runs one time. Thus each call gets the same models.
	for i, got := range results {
		if got == nil || got != results[0] {
			t.Fatalf("call %d got models %p, want %p", i, got, results[0])
		}
	}
}
