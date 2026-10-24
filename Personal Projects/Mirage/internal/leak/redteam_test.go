package leak

import (
	"bytes"
	"compress/zlib"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// RED-TEAM #4: a secret in a DEFLATE-compressed body is caught.
func TestDeflateRedaction(t *testing.T) {
	cfg := config.Default().Leak
	cfg.Enabled = true
	f, _ := New(cfg)

	secret := "sk_" + "live_abcdef0123456789012345ZZ"
	var zb bytes.Buffer
	zw := zlib.NewWriter(&zb)
	zw.Write([]byte(`{"k":"` + secret + `"}`))
	zw.Close()

	rec := httptest.NewRecorder()
	w := f.Wrap(rec)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "deflate")
	w.WriteHeader(200)
	w.Write(zb.Bytes())
	w.Finalise()

	zr, err := zlib.NewReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("client body not valid zlib: %v", err)
	}
	out, _ := readAll(zr)
	if strings.Contains(string(out), secret) {
		t.Errorf("secret leaked through deflate: %s", out)
	}
}

// RED-TEAM #4 (honest gap): an encoding we can't decode (brotli) is NOT
// silently claimed as scanned — it is flagged so the gap is visible.
func TestUnknownEncodingIsFlagged(t *testing.T) {
	cfg := config.Default().Leak
	cfg.Enabled = true
	f, _ := New(cfg)

	rec := httptest.NewRecorder()
	w := f.Wrap(rec)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Encoding", "br") // brotli: not decodable here
	w.WriteHeader(200)
	w.Write([]byte("opaque-brotli-bytes"))
	w.Finalise()

	var flagged bool
	for _, h := range w.Hits {
		if strings.HasPrefix(h, "unscannable_encoding:") {
			flagged = true
		}
	}
	if !flagged {
		t.Errorf("unknown encoding should be flagged as unscannable, hits=%v", w.Hits)
	}
}

var _ = http.StatusOK
