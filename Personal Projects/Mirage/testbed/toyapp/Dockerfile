FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/toyapp ./testbed/toyapp

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/toyapp /toyapp
EXPOSE 3000
ENTRYPOINT ["/toyapp"]
