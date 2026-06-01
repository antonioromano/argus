cask "argus" do
  version "0.16.12"

  on_arm do
    sha256 "b6ea353289738ed6ba0416586393b0fe101b3910c2817c29eaa89f2a575f54bc"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "1772ce856d885505a5d6e2925e7b12d6d5de5e47290997bf0e749772265df3df"
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
