// Command mirage is the Mirage reverse-proxy binary.
package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
	"github.com/abdallahfaisalayoob/mirage/internal/failopen"
	"github.com/abdallahfaisalayoob/mirage/internal/metrics"
	"github.com/abdallahfaisalayoob/mirage/internal/proxy"
	"github.com/abdallahfaisalayoob/mirage/internal/server"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

func main() {
	var cfgPath string
	flag.StringVar(&cfgPath, "config", "mirage.yaml", "path to config file")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg, err := config.Load(cfgPath)
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	slog.Info("mirage starting",
		"listen", cfg.Listen, "origin", cfg.Origin, "mode", cfg.Mode,
		"kill_switch", cfg.KillSwitch)

	app, err := server.Build(&cfg)
	if err != nil {
		slog.Error("build", "err", err)
		os.Exit(1)
	}

	dataSrv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           app.Proxy,
		ReadHeaderTimeout: 10 * time.Second,
	}
	adminSrv := &http.Server{
		Addr:              cfg.AdminListen,
		Handler:           app.Admin,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("admin listening", "addr", cfg.AdminListen)
		if err := adminSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("admin server", "err", err)
		}
	}()
	go func() {
		slog.Info("proxy listening", "addr", cfg.Listen)
		if err := dataSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("proxy server", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	slog.Info("shutting down", "failopen_events", failopen.Failures())

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = dataSrv.Shutdown(ctx)
	_ = adminSrv.Shutdown(ctx)
	app.Close()
}

// Keep references used across milestones from being flagged unused during the
// incremental build.
var (
	_ = metrics.New
	_ = proxy.New
	_ = session.NewStore
)
