package ladder

import (
	"crypto/sha256"
	"fmt"
	"strings"
)

// Proof-of-work is a HashCash-style challenge: find a nonce such that
// sha256(challenge ":" nonce) has at least `bits` leading zero bits. Verifying
// is O(1); solving is exponential in `bits`. A real browser solves it in the
// background; a high-volume scanner pays the cost on every fresh session.

// VerifyPoW checks a submitted "nonce" (or "challenge:nonce") solution.
func VerifyPoW(challenge, solution string, bits int) bool {
	nonce := solution
	if i := strings.LastIndexByte(solution, ':'); i >= 0 {
		// Accept "challenge:nonce"; the challenge part must match.
		if solution[:i] != challenge {
			return false
		}
		nonce = solution[i+1:]
	}
	sum := sha256.Sum256([]byte(challenge + ":" + nonce))
	return leadingZeroBits(sum[:]) >= bits
}

// SolvePoW finds a valid nonce (used by tests and as a reference solver).
func SolvePoW(challenge string, bits int) string {
	for n := 0; ; n++ {
		nonce := fmt.Sprintf("%d", n)
		sum := sha256.Sum256([]byte(challenge + ":" + nonce))
		if leadingZeroBits(sum[:]) >= bits {
			return nonce
		}
	}
}

func leadingZeroBits(b []byte) int {
	n := 0
	for _, x := range b {
		if x == 0 {
			n += 8
			continue
		}
		for m := byte(0x80); m != 0; m >>= 1 {
			if x&m == 0 {
				n++
			} else {
				return n
			}
		}
		break
	}
	return n
}

// powPage renders the challenge page with an inline JS solver. A browser runs
// it automatically and resubmits with the X-Mirage-PoW header; the page is
// intentionally plain so it never resembles the protected app.
func powPage(challenge string, bits int) []byte {
	return []byte(fmt.Sprintf(`<!doctype html>
<html><head><meta charset="utf-8"><title>Checking your browser…</title></head>
<body>
<p>Verifying your browser, one moment…</p>
<script>
(async function(){
  const challenge=%q, bits=%d;
  function lz(buf){let n=0;for(const x of buf){if(x===0){n+=8;continue;}
    for(let m=128;m;m>>=1){if((x&m)===0)n++;else return n;}break;}return n;}
  async function h(s){const d=await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(s));return new Uint8Array(d);}
  let n=0;while(true){const dg=await h(challenge+':'+n);
    if(lz(dg)>=bits)break;n++;}
  await fetch(location.href,{headers:{'X-Mirage-PoW':challenge+':'+n}})
    .then(()=>location.reload());
})();
</script>
</body></html>`, challenge, bits))
}
