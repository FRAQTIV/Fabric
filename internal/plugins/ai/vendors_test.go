package ai

import (
	"bytes"
	"context"
	"sync/atomic"
	"testing"

	"github.com/danielmiessler/fabric/internal/chat"
	"github.com/danielmiessler/fabric/internal/domain"
)

type testVendor struct {
	name  string
	calls atomic.Int32
}

func (v *testVendor) GetName() string                       { return v.name }
func (v *testVendor) GetSetupDescription() string           { return "" }
func (v *testVendor) IsConfigured() bool                    { return true }
func (v *testVendor) Configure() error                      { return nil }
func (v *testVendor) Setup() error                          { return nil }
func (v *testVendor) SetupFillEnvFileContent(*bytes.Buffer) {}
func (v *testVendor) ListModels(context.Context) ([]string, error) {
	v.calls.Add(1)
	return []string{v.name + "-model"}, nil
}
func (v *testVendor) SendStream(context.Context, []*chat.ChatCompletionMessage, *domain.ChatOptions, chan domain.StreamUpdate) error {
	return nil
}
func (v *testVendor) Send(context.Context, []*chat.ChatCompletionMessage, *domain.ChatOptions) (string, error) {
	return "", nil
}
func (v *testVendor) NeedsRawMode(string) bool { return false }

// TestAddVendorsInvalidatesCachedModels validates that registering
// a new vendor after warming the cache includes the new vendor's models.
func TestAddVendorsInvalidatesCachedModels(t *testing.T) {
	manager := NewVendorsManager()
	first := &testVendor{name: "alpha"}
	second := &testVendor{name: "beta"}

	manager.AddVendors(first)
	if _, err := manager.GetModels(); err != nil {
		t.Fatal(err)
	}

	manager.AddVendors(second)
	models, err := manager.GetModels()
	if err != nil {
		t.Fatal(err)
	}
	if got := models.FindModelNameCaseInsensitive("beta-model"); got != "beta-model" {
		t.Errorf("new registered vendor missing from warmed cache: got=%q", got)
	}
}
