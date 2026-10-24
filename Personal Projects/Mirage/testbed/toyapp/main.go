// Command toyapp is a deliberately simple, deliberately "vulnerable-shaped" app
// used ONLY inside the isolated test network to exercise Mirage. It SIMULATES
// attack surfaces (a login, a REST API with object IDs, an admin panel, an
// upload form) and the SHAPE of a leak — it contains no real CVE and no working
// exploit. Never expose it to the internet.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	addr := env("TOYAPP_LISTEN", ":3000")

	// Container healthcheck mode: GET /healthz and exit.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		port := addr
		if i := strings.LastIndex(addr, ":"); i >= 0 {
			port = addr[i:]
		}
		resp, err := http.Get("http://127.0.0.1" + port + "/healthz")
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		os.Exit(0)
	}
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })

	// Landing page. Contains a bait path in an HTML comment that only a client
	// *reading the body* would find — used to test semantic-bait scoring.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<!doctype html><html><head><title>ShopCo</title></head>
<body><h1>Welcome to ShopCo</h1>
<nav><a href="/products">Products</a> <a href="/login">Login</a></nav>
<!-- TODO: remove debug endpoint /internal/admin-v2 before launch -->
</body></html>`)
	})

	// Product listing and individual product pages (an object-id surface).
	mux.HandleFunc("/products", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if r.URL.Path == "/products" {
			fmt.Fprint(w, `<!doctype html><html><body><h1>Products</h1>
<ul><li><a href="/products/1">Widget</a></li><li><a href="/products/2">Gadget</a></li></ul>
</body></html>`)
			return
		}
		fmt.Fprint(w, `<!doctype html><html><body><h1>Product</h1><p>In stock.</p></body></html>`)
	})
	mux.HandleFunc("/products/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<!doctype html><html><body><h1>Product</h1><p>In stock.</p></body></html>`)
	})

	// Ordinary pages a human browses (so legitimate navigation stays 200).
	page := func(title, body string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, "<!doctype html><html><head><title>%s</title></head><body><h1>%s</h1>%s</body></html>",
				title, title, body)
		}
	}
	mux.HandleFunc("/cart", page("Cart", "<p>Your cart is empty.</p>"))
	mux.HandleFunc("/about", page("About", "<p>ShopCo sells widgets.</p>"))
	mux.HandleFunc("/account", page("Account", "<p>Signed in as user1@shopco.example</p>"))

	// REST API with object IDs — the classic enumeration surface.
	mux.HandleFunc("/api/users/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/users/")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Request-Id", "req-"+id)
		if id == "" || id == "999" {
			w.WriteHeader(404)
			json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"id":         id,
			"email":      "user" + id + "@shopco.example",
			"name":       "User " + id,
			"created_at": "2026-01-15T10:30:00Z",
			"api_key":    "sk_demo_realkey_" + id, // the REAL (demo) secret
			"role":       "customer",
		})
	})

	// Login form (GET shows it, POST "authenticates").
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			r.ParseForm()
			if r.FormValue("username") == "admin" && r.FormValue("password") == "admin" {
				http.SetCookie(w, &http.Cookie{Name: "session", Value: "demo-token"})
				w.Write([]byte("ok"))
				return
			}
			w.WriteHeader(401)
			w.Write([]byte("invalid credentials"))
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<form method=post action=/login>
<input name=username><input name=password type=password><button>Sign in</button></form>`)
	})

	mux.HandleFunc("/admin", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<!doctype html><html><body><h1>Admin Panel</h1>
<p>Users: 1032 · Orders: 5571</p></body></html>`)
	})

	mux.HandleFunc("/upload", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			r.ParseMultipartForm(8 << 20)
			w.Write([]byte("uploaded"))
			return
		}
		fmt.Fprint(w, `<form method=post enctype=multipart/form-data action=/upload>
<input type=file name=file><button>Upload</button></form>`)
	})

	// /debug SIMULATES a leak: a verbose stack trace and an oversized session
	// cookie (the PHP2Shell memory-disclosure SHAPE). No real memory is read;
	// this is a fixed string so the leak filter has something to catch.
	mux.HandleFunc("/debug", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Set-Cookie", "PHPSESSID="+strings.Repeat("A", 68000)) // ~67 KB "leak"
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, "Fatal error: Uncaught Exception in /var/www/html/index.php:88\n"+
			"Stack trace:\n#0 /var/www/html/db.php(42): connect()\n"+
			"-----BEGIN RSA PRIVATE KEY-----\nMIIsimulateddemokeymaterial\n-----END RSA PRIVATE KEY-----\n")
	})

	log.Printf("toyapp listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
