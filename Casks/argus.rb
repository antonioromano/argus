cask "argus" do
  version "0.21.15"

  on_arm do
    sha256 "077c4665db807b08beeb5967810cb8c15cddd458b5e0cf813ee778a3a7c18750"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "91117aa715a5e54d7e19b52719b7ee080aa182ec398d5e352f6259a76f6be2a7"
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
