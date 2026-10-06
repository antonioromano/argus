cask "argus" do
  version "0.25.2"

  on_arm do
    sha256 "340ded8e89c945e9cb7d6425120630bcbe2a2e24b37f4c628bc584f7f5303266"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "0962123c2df4f5c9a62368d443678fa2294307978f970dadaa3c54ad710cf0a0"
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
