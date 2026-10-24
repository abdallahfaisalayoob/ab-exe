# Mirage — build, test, run.
BINDIR := ./bin
GOFLAGS := -trimpath -ldflags="-s -w"

.PHONY: all build test vet sim offline docker clean

all: build

build:
	CGO_ENABLED=0 go build $(GOFLAGS) -o $(BINDIR)/mirage ./cmd/mirage
	CGO_ENABLED=0 go build $(GOFLAGS) -o $(BINDIR)/mirage-sim ./cmd/mirage-sim
	CGO_ENABLED=0 go build $(GOFLAGS) -o $(BINDIR)/toyapp ./testbed/toyapp

test:
	go test ./...

vet:
	go vet ./...

# Fast, deterministic scorer evaluation (0% human-FP gate).
offline:
	go run ./cmd/mirage-sim offline -n 500

# Drive labelled traffic through a running Mirage (default :8080).
sim:
	go run ./cmd/mirage-sim run

docker:
	docker compose build

clean:
	rm -rf $(BINDIR) *.db *.db-*
