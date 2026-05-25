cask "argus" do
  version "0.15.1"

  on_arm do
    sha256 "58165ad0dabf6f92b0f61821ae75dc349d318173cc71c4a8a2220617c9398026"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "91ccf0c6bcd36e033db58da2ca49eb4df0eff38222cd5d4cf2557a20ada149d8"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}.dmg"
  end

  name "Argus"
  desc "Dashboard for managing multiple Claude Code CLI sessions"
  homepage "https://github.com/antonioromano/argus"

  app "Argus.app"

  zap trash: [
    "~/Library/Application Support/Argus",
    "~/Library/Logs/Argus",
    "~/Library/Preferences/com.antonio.argus.plist",
  ]
end
