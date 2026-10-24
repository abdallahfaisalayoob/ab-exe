package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultsAreSafe(t *testing.T) {
	c := Default()
	if c.Mode != "monitor" {
		t.Errorf("default mode = %q, want monitor", c.Mode)
	}
	if c.EnforceActive() {
		t.Errorf("defaults must not enforce")
	}
	// Active defences off by default.
	if c.Ladder.Enabled || c.Shadow.Enabled || c.Leak.Enabled || c.Shadow.DecoyText {
		t.Errorf("active defences must be off by default")
	}
	// Ingress guard IS on (it's safe and fail-open), but limits are generous.
	if !c.Ingress.Enabled {
		t.Errorf("ingress guard should be enabled by default")
	}
}

func TestLoadOverlay(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "m.yaml")
	os.WriteFile(path, []byte("origin: http://app:9000\nmode: enforce\nladder:\n  enabled: true\n"), 0o644)
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.Origin != "http://app:9000" {
		t.Errorf("origin not overlaid: %q", c.Origin)
	}
	if c.Mode != "enforce" || !c.EnforceActive() {
		t.Errorf("mode not overlaid")
	}
	if !c.Ladder.Enabled {
		t.Errorf("nested overlay failed")
	}
	// Unset fields keep defaults.
	if c.Ingress.MaxBodyBytes != Default().Ingress.MaxBodyBytes {
		t.Errorf("unset nested field lost its default")
	}
}

func TestKillSwitchEnv(t *testing.T) {
	t.Setenv("MIRAGE_KILL", "1")
	c, err := Load("")
	if err != nil {
		t.Fatal(err)
	}
	if !c.KillSwitch {
		t.Errorf("MIRAGE_KILL=1 should force kill switch")
	}
	if c.EnforceActive() {
		t.Errorf("kill switch must disable enforcement")
	}
}

func TestValidate(t *testing.T) {
	c := Default()
	c.Origin = ""
	if err := c.Validate(); err == nil {
		t.Errorf("empty origin should fail validation")
	}
	c = Default()
	c.Mode = "nonsense"
	if err := c.Validate(); err == nil {
		t.Errorf("bad mode should fail validation")
	}
}
