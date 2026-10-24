# Build a fully static Mirage binary, then ship it on distroless.
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# CGO off => static binary (pure-Go sqlite driver makes this possible).
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/mirage ./cmd/mirage

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/mirage /usr/local/bin/mirage
COPY mirage.example.yaml /etc/mirage/mirage.yaml
USER nonroot:nonroot
EXPOSE 8080 9900
ENTRYPOINT ["/usr/local/bin/mirage"]
CMD ["-config", "/etc/mirage/mirage.yaml"]
