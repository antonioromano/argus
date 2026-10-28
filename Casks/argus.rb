cask "argus" do
  version "0.30.1"

  on_arm do
    sha256 "9d253b3d3fc4f52020083b21182b881443051e8fa9717011ea5615107357daa3"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "bbf69f7d7f4561717c522560a986e07f85b14a6c0a4854df4889504eef5ff796"
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
