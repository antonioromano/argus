# Build the argusd pty-host daemon as static, per-arch macOS binaries bundled by
# electron-builder (extraResources → Contents/Resources/argusd/). Named by Node's
# process.arch (arm64 / x64) so DaemonBackend can resolve argusd-${process.arch}.
# creack/pty is pure Go → CGO_ENABLED=0 cross-compiles cleanly.
BINDIR := ../electron/resources/argusd
LDFLAGS := -s -w
GOFLAGS := -trimpath

.PHONY: build build-arm64 build-x64 test vet clean

build: build-arm64 build-x64

build-arm64:
	@mkdir -p $(BINDIR)
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o $(BINDIR)/argusd-arm64 .

build-x64:
	@mkdir -p $(BINDIR)
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o $(BINDIR)/argusd-x64 .

test:
	go test ./...

vet:
	go vet ./...

clean:
	rm -f $(BINDIR)/argusd-arm64 $(BINDIR)/argusd-x64
