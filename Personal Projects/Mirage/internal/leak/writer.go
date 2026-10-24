package leak

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"io"
	"net/http"
	"regexp"
	"strings"
)

// Writer wraps an http.ResponseWriter, inspecting headers immediately and
// buffering the body (up to the configured cap) for full inspection before it
// is flushed to the client. Beyond the cap it streams with an overlap window so
// a secret straddling two chunks is still caught.
type Writer struct {
	rw     http.ResponseWriter
	f      *Filter
	status int

	headerDone bool
	ct         string
	gzipped    bool
	bodyScan   bool

	buf      bytes.Buffer
	overflow bool
	overlap  []byte // tail carried between streamed chunks

	Hits []string
}

// Wrap returns a leak Writer around rw.
func (f *Filter) Wrap(rw http.ResponseWriter) *Writer {
	return &Writer{rw: rw, f: f}
}

func (w *Writer) Header() http.Header { return w.rw.Header() }

func (w *Writer) WriteHeader(code int) {
	if w.headerDone {
		return
	}
	w.status = code
	w.prepare()
	// We may rewrite the body (and thus Content-Length); drop it so the client
	// reads to EOF. Headers are inspected/redacted before they go out.
	if w.bodyScan {
		w.rw.Header().Del("Content-Length")
	}
	w.rw.WriteHeader(code)
	w.headerDone = true
}

func (w *Writer) prepare() {
	hits := w.f.InspectHeaders(w.rw.Header())
	w.Hits = append(w.Hits, hits...)
	w.ct = w.rw.Header().Get("Content-Type")
	w.gzipped = strings.Contains(strings.ToLower(w.rw.Header().Get("Content-Encoding")), "gzip")
	w.bodyScan = w.f.TextLike(w.ct) || w.gzipped
}

func (w *Writer) Write(b []byte) (int, error) {
	if !w.headerDone {
		w.WriteHeader(http.StatusOK)
	}
	if !w.bodyScan {
		return w.rw.Write(b) // binary, non-gzip: pass straight through
	}
	n := len(b)
	if !w.overflow {
		w.buf.Write(b)
		if int64(w.buf.Len()) <= w.f.cfg.BufferCapBytes {
			return n, nil // keep buffering for a full-body scan
		}
		// Cap exceeded: switch to streaming. Flush what we have (can't gzip-
		// re-encode a partial safely, so for gzipped bodies we only reach here
		// on very large payloads; fall back to redacting the compressed bytes
		// chunk-wise, which still catches plaintext-in-gzip only after full
		// buffering — documented limitation).
		w.overflow = true
		w.flushStreaming(w.buf.Bytes())
		w.buf.Reset()
		return n, nil
	}
	w.flushStreaming(b)
	return n, nil
}

// flushStreaming redacts a chunk together with the carried overlap tail so a
// secret split across the boundary is caught, then writes the cleaned chunk.
func (w *Writer) flushStreaming(chunk []byte) {
	combined := append(w.overlap, chunk...)
	red, hits := w.f.RedactBody(w.ct, combined)
	w.Hits = append(w.Hits, hits...)
	// Keep a tail as the next overlap (longest pattern we might straddle).
	const tail = 256
	if len(red) > tail {
		w.rw.Write(red[:len(red)-tail])
		w.overlap = append(w.overlap[:0], red[len(red)-tail:]...)
	} else {
		w.overlap = append(w.overlap[:0], red...)
	}
}

// Finalise must be called after the origin finishes. It flushes the buffered
// body (full-body inspection), handling gzip decode/re-encode and one base64
// rescan pass.
func (w *Writer) Finalise() {
	if !w.headerDone {
		w.WriteHeader(w.statusOrOK())
	}
	if !w.bodyScan {
		return
	}
	if w.overflow {
		// Streaming mode: flush the final overlap tail.
		if len(w.overlap) > 0 {
			w.rw.Write(w.overlap)
			w.overlap = nil
		}
		return
	}
	body := w.buf.Bytes()

	if w.gzipped {
		if dec, err := gunzip(body); err == nil {
			red, hits := w.scanWithBase64(dec)
			w.Hits = append(w.Hits, hits...)
			if enc, err := gzipBytes(red); err == nil {
				w.rw.Write(enc)
				return
			}
			// Re-encode failed: send decoded, drop the now-wrong encoding.
			w.rw.Header().Del("Content-Encoding")
			w.rw.Write(red)
			return
		}
		// Couldn't decode: pass through (headers already scanned).
		w.rw.Write(body)
		return
	}

	red, hits := w.scanWithBase64(body)
	w.Hits = append(w.Hits, hits...)
	w.rw.Write(red)
}

// scanWithBase64 redacts the body, then decodes long base64 runs once and
// redacts their plaintext too (re-encoding the cleaned value back) so secrets
// hidden behind a base64 layer don't slip through.
func (w *Writer) scanWithBase64(body []byte) ([]byte, []string) {
	red, hits := w.f.RedactBody(w.ct, body)
	out := reBase64Run.ReplaceAllFunc(red, func(m []byte) []byte {
		dec, err := base64.StdEncoding.DecodeString(string(m))
		if err != nil || !w.f.TextLike("text/plain") {
			return m
		}
		cleaned, bh := w.f.RedactBody("text/plain", dec)
		if len(bh) == 0 {
			return m // nothing hidden; leave original untouched
		}
		hits = append(hits, bh...)
		return []byte(base64.StdEncoding.EncodeToString(cleaned))
	})
	return out, hits
}

func (w *Writer) statusOrOK() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}

// Flush satisfies http.Flusher for streaming middle layers.
func (w *Writer) Flush() {
	if f, ok := w.rw.(http.Flusher); ok {
		f.Flush()
	}
}

func gunzip(b []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(io.LimitReader(r, 16<<20)) // bound decompression (zip-bomb guard)
}

func gzipBytes(b []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(b); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

var reBase64Run = regexp.MustCompile(`[A-Za-z0-9+/]{40,}={0,2}`)
