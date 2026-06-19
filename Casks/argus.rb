cask "argus" do
  version "0.18.1"

  on_arm do
    sha256 "b6588c04e00fd843fe1bb71d17b6b1ccf2f11285d9ec918fcfcfd34572cfb235"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "db6d670d775aad11a181821f3d217b682089ed525f9d3db49e234fcf68e087be"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}.dmg"
  end

  name "Argus"
  desc "Dashboard for managing multiple Claude Code CLI sessions"
  homepage "https://github.com/antonioromano/argus"

  app "Argus.app"

  # App is ad-hoc signed (no Apple Developer cert). Strip the quarantine flag
  # Homebrew adds on download so Gatekeeper opens it without the manual
  # right-click -> Open dance. Best-effort; harmless if it no-ops.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Argus.app"]
  end

  zap trash: [
    "~/Library/Application Support/Argus",
    "~/Library/Logs/Argus",
    "~/Library/Preferences/com.antonio.argus.plist",
  ]
end
