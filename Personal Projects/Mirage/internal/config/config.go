// Package config loads and validates Mirage's YAML configuration.
//
// The zero-value philosophy: a config with almost nothing set must still be
// safe. Defaults put Mirage in monitor-only mode with every active defence
// (shadow, tarpit, pow, decoy text) switched off, so a fresh install can
// never take down the protected site.
package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the top-level Mirage configuration.
type Config struct {
	// Listen is the address Mirage binds for proxied traffic, e.g. ":8080".
	Listen string `yaml:"listen"`
	// Origin is the upstream the proxy forwards to, e.g. "http://app:3000".
	Origin string `yaml:"origin"`
	// AdminListen is the dashboard/metrics address, e.g. "127.0.0.1:9900".
	AdminListen string `yaml:"admin_listen"`
	// ServerSecret seeds all HMACs (session cookies, shadow PRNG, honeytokens).
	// If empty, a random secret is generated at startup (sessions won't survive
	// a restart). Set it in production. May be given via $MIRAGE_SECRET.
	ServerSecret string `yaml:"server_secret"`

	// Mode is "monitor" (score + log, enforce nothing) or "enforce".
	// Default "monitor".
	Mode string `yaml:"mode"`
	// KillSwitch, when true, disables all Mirage stages: pure pass-through.
	// Also forced on by env MIRAGE_KILL=1.
	KillSwitch bool `yaml:"kill_switch"`

	Ingress   Ingress   `yaml:"ingress"`
	Scorer    Scorer    `yaml:"scorer"`
	Ladder    Ladder    `yaml:"ladder"`
	Shadow    Shadow    `yaml:"shadow"`
	Leak      Leak      `yaml:"leak"`
	Allowlist Allowlist `yaml:"allowlist"`
	Alert     Alert     `yaml:"alert"`
	Privacy   Privacy   `yaml:"privacy"`
	Storage   Storage   `yaml:"storage"`
}

// Ingress holds request-admission limits. Defaults stop the PHP2Shell shape
// (huge urlencoded bodies with oversized field names) without breaking normal
// forms or uploads.
type Ingress struct {
	Enabled          bool          `yaml:"enabled"`
	MaxBodyBytes     int64         `yaml:"max_body_bytes"`
	MaxFields        int           `yaml:"max_fields"`
	MaxFieldNameLen  int           `yaml:"max_field_name_len"`
	MaxHeaderCount   int           `yaml:"max_header_count"`
	MaxMultipartSize int64         `yaml:"max_multipart_size"`
	MinRequestGap    time.Duration `yaml:"min_request_gap"`
	// VirtualPatch toggles the CISA-KEV virtual-patch pack (shape rules keyed
	// to CVE IDs). RulesFile optionally points at a Coraza/CRS rules file.
	VirtualPatch bool   `yaml:"virtual_patch"`
	RulesFile    string `yaml:"rules_file"`
}

// Scorer configures session scoring.
type Scorer struct {
	Enabled    bool `yaml:"enabled"`
	WindowSize int  `yaml:"window_size"` // requests retained per session
}

// Ladder maps score thresholds to response rungs. Each threshold is the
// minimum combined score for that rung. Rungs above MaxRung are clamped.
type Ladder struct {
	Enabled       bool   `yaml:"enabled"`
	MaxRung       string `yaml:"max_rung"` // highest rung allowed to fire
	PoWThreshold  int    `yaml:"pow_threshold"`
	TarpitMin     int    `yaml:"tarpit_threshold"`
	ShadowMin     int    `yaml:"shadow_threshold"`
	BlockMin      int    `yaml:"block_threshold"`
	TarpitDelayMS int    `yaml:"tarpit_delay_ms"`
	PoWDifficulty int    `yaml:"pow_difficulty"` // leading zero bits required
}

// Shadow configures the deception engine.
type Shadow struct {
	Enabled      bool   `yaml:"enabled"`
	MinAgent     int    `yaml:"min_agent"`     // extra gate: agent score
	MinHostile   int    `yaml:"min_hostile"`   // extra gate: hostile score
	LearnFromAPI bool   `yaml:"learn_traffic"` // learn route shapes from live traffic
	OpenAPIFile  string `yaml:"openapi_file"`
	// DecoyText enables defensive prompt-injection text in shadow responses.
	// Off by default. Can only mislead/stall; never hack-back (enforced).
	DecoyText     bool   `yaml:"decoy_text"`
	HoneytokenEnv bool   `yaml:"honeytoken_env"` // serve fake .env/config files
	TokenPrefix   string `yaml:"token_prefix"`
}

// Leak configures the outgoing-response inspector.
type Leak struct {
	Enabled        bool  `yaml:"enabled"`
	MaxCookieBytes int   `yaml:"max_cookie_bytes"`
	BufferCapBytes int64 `yaml:"buffer_cap_bytes"`
	RedactKeys     bool  `yaml:"redact_keys"`
	RedactTraces   bool  `yaml:"redact_traces"`
	RedactPHPInfo  bool  `yaml:"redact_phpinfo"`
	ScanCompressed bool  `yaml:"scan_compressed"`
	// ExtraPatterns are user regexes; matches are redacted.
	ExtraPatterns []string `yaml:"extra_patterns"`
}

// Allowlist exempts trusted clients from all enforcement.
type Allowlist struct {
	IPs            []string `yaml:"ips"`             // IPs or CIDRs
	Paths          []string `yaml:"paths"`           // path prefixes (health checks)
	VerifyCrawlers bool     `yaml:"verify_crawlers"` // rDNS-verify Google/Bing/etc
	WebBotAuth     bool     `yaml:"web_bot_auth"`    // accept RFC 9421 signed agents
}

// Alert configures outbound notifications.
type Alert struct {
	WebhookURL string `yaml:"webhook_url"`
	Syslog     bool   `yaml:"syslog"`
	SyslogAddr string `yaml:"syslog_addr"`
}

// Privacy controls what is stored.
type Privacy struct {
	StoreRaw bool `yaml:"store_raw"` // store full cookies/headers/bodies (default false)
}

// Storage configures the event store.
type Storage struct {
	Driver string `yaml:"driver"` // "sqlite" (default) or "memory"
	DSN    string `yaml:"dsn"`    // e.g. "file:mirage.db"
}

// Default returns a fully-populated safe configuration.
func Default() Config {
	return Config{
		Listen:      ":8080",
		Origin:      "http://127.0.0.1:3000",
		AdminListen: "127.0.0.1:9900",
		Mode:        "monitor",
		KillSwitch:  false,
		Ingress: Ingress{
			Enabled:          true,
			MaxBodyBytes:     10 << 20, // 10 MiB
			MaxFields:        2000,
			MaxFieldNameLen:  256,
			MaxHeaderCount:   100,
			MaxMultipartSize: 32 << 20, // 32 MiB
			MinRequestGap:    0,
			VirtualPatch:     true,
			RulesFile:        "",
		},
		Scorer: Scorer{Enabled: true, WindowSize: 64},
		Ladder: Ladder{
			Enabled:       false,
			MaxRung:       "monitor",
			PoWThreshold:  55,
			TarpitMin:     70,
			ShadowMin:     82,
			BlockMin:      95,
			TarpitDelayMS: 120,
			PoWDifficulty: 16,
		},
		Shadow: Shadow{
			Enabled:       false,
			MinAgent:      60,
			MinHostile:    70,
			LearnFromAPI:  true,
			DecoyText:     false,
			HoneytokenEnv: true,
			TokenPrefix:   "mrg",
		},
		Leak: Leak{
			Enabled:        false,
			MaxCookieBytes: 4096,
			BufferCapBytes: 2 << 20, // 2 MiB
			RedactKeys:     true,
			RedactTraces:   true,
			RedactPHPInfo:  true,
			ScanCompressed: true,
		},
		Allowlist: Allowlist{
			Paths:          []string{"/healthz", "/livez", "/readyz"},
			VerifyCrawlers: true,
			WebBotAuth:     true,
		},
		Privacy: Privacy{StoreRaw: false},
		Storage: Storage{Driver: "sqlite", DSN: "file:mirage.db?cache=shared"},
	}
}

// Load reads a YAML file over the defaults. Fields absent in the file keep
// their default values. An empty path returns the defaults.
func Load(path string) (Config, error) {
	cfg := Default()
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return cfg, fmt.Errorf("read config: %w", err)
		}
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return cfg, fmt.Errorf("parse config: %w", err)
		}
	}
	cfg.applyEnv()
	if err := cfg.Validate(); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func (c *Config) applyEnv() {
	if v := os.Getenv("MIRAGE_SECRET"); v != "" {
		c.ServerSecret = v
	}
	if v := os.Getenv("MIRAGE_ORIGIN"); v != "" {
		c.Origin = v
	}
	if v := os.Getenv("MIRAGE_LISTEN"); v != "" {
		c.Listen = v
	}
	if os.Getenv("MIRAGE_KILL") == "1" {
		c.KillSwitch = true
	}
}

// Validate checks required fields and internal consistency.
func (c *Config) Validate() error {
	if c.Listen == "" {
		return fmt.Errorf("listen is required")
	}
	if c.Origin == "" {
		return fmt.Errorf("origin is required")
	}
	switch c.Mode {
	case "", "monitor", "enforce":
	default:
		return fmt.Errorf("mode must be monitor or enforce, got %q", c.Mode)
	}
	if c.Mode == "" {
		c.Mode = "monitor"
	}
	if !validRung(c.Ladder.MaxRung) {
		return fmt.Errorf("ladder.max_rung invalid: %q", c.Ladder.MaxRung)
	}
	return nil
}

func validRung(r string) bool {
	switch r {
	case "", "monitor", "pow", "tarpit", "shadow", "block":
		return true
	}
	return false
}

// EnforceActive reports whether any enforcement should happen.
func (c *Config) EnforceActive() bool {
	return c.Mode == "enforce" && !c.KillSwitch
}
