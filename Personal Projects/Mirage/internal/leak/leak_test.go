package leak

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

func testFilter(t *testing.T) *Filter {
	t.Helper()
	cfg := config.Default().Leak
	cfg.Enabled = true
	f, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// The PHP2Shell shape: an oversized / binary Set-Cookie carrying leaked memory.
func TestOversizedCookieRedacted(t *testing.T) {
	f := testFilter(t)
	h := http.Header{}
	leaked := "PHPSESSID=" + strings.Repeat("A", 70000) // ~67 KB memory leak
	h.Add("Set-Cookie", leaked)
	hits := f.InspectHeaders(h)
	if len(hits) == 0 {
		t.Fatal("oversized cookie not caught")
	}
	out := h.Get("Set-Cookie")
	if len(out) > 1000 || strings.Count(out, "A") > 100 {
		t.Errorf("leaked bytes not redacted: len=%d", len(out))
	}
	if !strings.HasPrefix(out, "PHPSESSID=") {
		t.Errorf("cookie name should be preserved: %q", out)
	}
}

func TestBinaryCookieRedacted(t *testing.T) {
	f := testFilter(t)
	h := http.Header{}
	h.Add("Set-Cookie", "sid=val\x00\x01\x02binarymemory")
	if hits := f.InspectHeaders(h); len(hits) == 0 {
		t.Error("binary cookie not caught")
	}
}

func TestBodySecretsRedacted(t *testing.T) {
	f := testFilter(t)
	cases := []struct{ name, body, mustGone string }{
		{"private key", "x\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\ny", "MIIabc"},
		{"aws", `{"AWS_SECRET_ACCESS_KEY":"wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12"}`, "wJalr"},
		{"stripe", "key=sk_" + "live_abcdef012345678901234567", "sk_" + "live_abcdef012345"},
		{"php trace", "Fatal error: Uncaught Exception in /var/www/app.php:42\nStack trace:\n#0 /var/www/x.php(10)", "Stack trace"},
		{"phpinfo", "<title>phpinfo()</title>PHP Version 8.1", "phpinfo()"},
	}
	for _, c := range cases {
		red, hits := f.RedactBody("text/html", []byte(c.body))
		if len(hits) == 0 {
			t.Errorf("%s: nothing redacted", c.name)
		}
		if strings.Contains(string(red), c.mustGone) {
			t.Errorf("%s: secret still present: %s", c.name, red)
		}
	}
}

// Binary content skips body scan (headers already handled) to protect latency.
func TestBinaryBodySkipped(t *testing.T) {
	f := testFilter(t)
	body := []byte("sk_" + "live_abcdef0123456789012345 inside a PNG")
	red, hits := f.RedactBody("image/png", body)
	if len(hits) != 0 || !bytes.Equal(red, body) {
		t.Errorf("binary body should not be scanned")
	}
}

// Full wrapper: a gzipped response with a secret is decoded, redacted, and
// re-encoded so the client receives gzip without the secret.
func TestGzipRoundTripRedaction(t *testing.T) {
	f := testFilter(t)
	secret := "sk_" + "live_abcdef0123456789012345ZZ"
	var zbuf bytes.Buffer
	zw := gzip.NewWriter(&zbuf)
	zw.Write([]byte(`{"token":"` + secret + `"}`))
	zw.Close()

	rec := httptest.NewRecorder()
	w := f.Wrap(rec)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "gzip")
	w.WriteHeader(200)
	w.Write(zbuf.Bytes())
	w.Finalise()

	// Decode what the client got.
	zr, err := gzip.NewReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("client body not valid gzip: %v", err)
	}
	out, _ := readAll(zr)
	if strings.Contains(string(out), secret) {
		t.Errorf("secret leaked through gzip: %s", out)
	}
	if !strings.Contains(string(out), "REDACTED") {
		t.Errorf("expected redaction marker, got: %s", out)
	}
}

// A secret hidden behind a base64 layer is caught by the single rescan pass.
func TestBase64HiddenSecret(t *testing.T) {
	f := testFilter(t)
	secret := "-----BEGIN RSA PRIVATE KEY-----\nMIIhidden\n-----END RSA PRIVATE KEY-----"
	enc := base64.StdEncoding.EncodeToString([]byte(secret))
	body := `{"blob":"` + enc + `"}`

	rec := httptest.NewRecorder()
	w := f.Wrap(rec)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	w.Write([]byte(body))
	w.Finalise()

	got := rec.Body.String()
	// The original base64 of the raw key must not survive intact.
	if strings.Contains(got, enc) {
		t.Errorf("base64-hidden secret passed through unchanged")
	}
}

func readAll(r interface{ Read([]byte) (int, error) }) ([]byte, error) {
	var out []byte
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		out = append(out, buf[:n]...)
		if err != nil {
			if err.Error() == "EOF" {
				return out, nil
			}
			return out, nil
		}
	}
}
