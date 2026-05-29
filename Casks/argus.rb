cask "argus" do
  version "0.16.5"

  on_arm do
    sha256 "02773dda9a96fcaa190a49cb01706b78bd4fa3a329b012c7305d457800fb622d"
    url "https://github.com/antonioromano/argus/releases/download/v#{version}/Argus-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "bb10a19cb217d9b37720fbd6e07c301f6cad43ad7fd1a75b4e0e99fe3272e1fd"
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
