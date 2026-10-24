FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mirage-sim ./cmd/mirage-sim

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/mirage-sim /mirage-sim
ENTRYPOINT ["/mirage-sim"]
