package allowlist

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// signRequest builds a valid RFC 9421 Ed25519 signature over the given
// components and sets the Signature-Input/Signature headers, exactly as a
// Web Bot Auth client would — so the verifier is tested against real crypto.
func signAuthority(t *testing.T, priv ed25519.PrivateKey, keyid, authority string) (sigInput, sig string) {
	t.Helper()
	components := `("@authority")`
	params := fmt.Sprintf(`%s;created=1700000000;keyid="%s";alg="ed25519";tag="web-bot-auth"`, components, keyid)
	base := fmt.Sprintf("\"@authority\": %s\n\"@signature-params\": %s", authority, params)
	s := ed25519.Sign(priv, []byte(base))
	sigInput = "sig1=" + params
	sig = "sig1=:" + base64.StdEncoding.EncodeToString(s) + ":"
	return
}

func TestWebBotAuthValid(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	keyid := "test-key-1"
	cfg := config.Allowlist{
		WebBotAuth:     true,
		WebBotAuthKeys: map[string]string{keyid: base64.StdEncoding.EncodeToString(pub)},
	}
	a, err := New(cfg, fakeResolver{})
	if err != nil {
		t.Fatal(err)
	}

	r := httptest.NewRequest("GET", "http://api.example.com/data", nil)
	r.Host = "api.example.com"
	si, sg := signAuthority(t, priv, keyid, "api.example.com")
	r.Header.Set("Signature-Input", si)
	r.Header.Set("Signature", sg)

	if ok, id := a.Check(r, "203.0.113.9"); !ok || id == "" {
		t.Fatalf("valid Web Bot Auth signature rejected (ok=%v id=%q)", ok, id)
	}
}

func TestWebBotAuthTamperedFails(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	keyid := "k"
	a, _ := New(config.Allowlist{WebBotAuth: true,
		WebBotAuthKeys: map[string]string{keyid: base64.StdEncoding.EncodeToString(pub)}}, fakeResolver{})

	r := httptest.NewRequest("GET", "http://api.example.com/data", nil)
	r.Host = "api.example.com"
	si, sg := signAuthority(t, priv, keyid, "api.example.com")
	// Tamper: the signature was made for api.example.com, now the request
	// claims a different authority. Verification must fail.
	r.Host = "evil.example.com"
	r.Header.Set("Signature-Input", si)
	r.Header.Set("Signature", sg)
	if ok, _ := a.Check(r, "203.0.113.9"); ok {
		t.Error("tampered authority must fail signature verification")
	}
}

func TestWebBotAuthUnknownKeyFails(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	// Configure a DIFFERENT key than the one that signed.
	otherPub, _, _ := ed25519.GenerateKey(rand.Reader)
	a, _ := New(config.Allowlist{WebBotAuth: true,
		WebBotAuthKeys: map[string]string{"k": base64.StdEncoding.EncodeToString(otherPub)}}, fakeResolver{})

	r := httptest.NewRequest("GET", "http://api.example.com/", nil)
	r.Host = "api.example.com"
	si, sg := signAuthority(t, priv, "k", "api.example.com")
	r.Header.Set("Signature-Input", si)
	r.Header.Set("Signature", sg)
	if ok, _ := a.Check(r, "203.0.113.9"); ok {
		t.Error("signature from an unconfigured key must not verify")
	}
}

func TestWebBotAuthMissingHeaders(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	a, _ := New(config.Allowlist{WebBotAuth: true,
		WebBotAuthKeys: map[string]string{"k": base64.StdEncoding.EncodeToString(pub)}}, fakeResolver{})
	r := httptest.NewRequest("GET", "http://api.example.com/", nil)
	if ok, _ := a.Check(r, "203.0.113.9"); ok {
		t.Error("no signature headers must not allowlist")
	}
}
