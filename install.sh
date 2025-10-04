#!/bin/bash
# Documentation Hub - Linux/macOS Installer Script
# This script downloads and installs the latest version of Documentation Hub

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}Documentation Hub Installer${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Darwin*)
        PLATFORM="macos"
        FILE_EXT=".dmg"
        ;;
    Linux*)
        PLATFORM="linux"
        FILE_EXT=".AppImage"
        ;;
    *)
        echo -e "${RED}Error: Unsupported operating system: $OS${NC}"
        exit 1
        ;;
esac

echo -e "${YELLOW}Detected platform: $PLATFORM${NC}"
echo ""

# Get latest release information from GitHub
echo -e "${YELLOW}Fetching latest release information...${NC}"
RELEASE_URL="https://api.github.com/repos/ItMeDiaTech/Documentation_Hub/releases/latest"

if ! RELEASE_JSON=$(curl -sL "$RELEASE_URL"); then
    echo -e "${RED}Error: Failed to fetch release information${NC}"
    echo -e "${RED}Please check your internet connection and try again.${NC}"
    exit 1
fi

VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
echo -e "${GREEN}Latest version: $VERSION${NC}"

# Find the appropriate installer asset
if [ "$PLATFORM" = "macos" ]; then
    DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep "browser_download_url.*\.dmg" | head -n 1 | cut -d '"' -f 4)
    INSTALLER_NAME="Documentation-Hub.dmg"
else
    DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep "browser_download_url.*\.AppImage" | head -n 1 | cut -d '"' -f 4)
    INSTALLER_NAME="Documentation-Hub.AppImage"
fi

if [ -z "$DOWNLOAD_URL" ]; then
    echo -e "${RED}Error: No installer found for $PLATFORM in the latest release${NC}"
    exit 1
fi

# Download location
DOWNLOAD_DIR="$HOME/Downloads"
DOWNLOAD_PATH="$DOWNLOAD_DIR/$INSTALLER_NAME"

echo ""
echo -e "${YELLOW}Downloading $INSTALLER_NAME...${NC}"
echo -e "${NC}URL: $DOWNLOAD_URL${NC}"

if ! curl -L -o "$DOWNLOAD_PATH" "$DOWNLOAD_URL" --progress-bar; then
    echo -e "${RED}Error: Failed to download installer${NC}"
    exit 1
fi

echo -e "${GREEN}Download complete!${NC}"
echo ""

# Platform-specific installation
if [ "$PLATFORM" = "macos" ]; then
    echo -e "${YELLOW}Opening DMG file...${NC}"
    echo -e "${CYAN}Please drag Documentation Hub to your Applications folder.${NC}"
    open "$DOWNLOAD_PATH"
else
    # Linux AppImage
    echo -e "${YELLOW}Setting up AppImage...${NC}"

    # Make executable
    chmod +x "$DOWNLOAD_PATH"

    # Create desktop entry
    DESKTOP_FILE="$HOME/.local/share/applications/documentation-hub.desktop"
    mkdir -p "$(dirname "$DESKTOP_FILE")"

    cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=Documentation Hub
Exec=$DOWNLOAD_PATH
Icon=documentation-hub
Type=Application
Categories=Office;
Terminal=false
Comment=Modern document processing and session management
EOF

    echo -e "${GREEN}AppImage installed to: $DOWNLOAD_PATH${NC}"
    echo -e "${GREEN}Desktop entry created${NC}"

    # Ask if user wants to run now
    echo ""
    read -p "Would you like to launch Documentation Hub now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        "$DOWNLOAD_PATH" &
        echo -e "${GREEN}Documentation Hub is starting...${NC}"
    fi
fi

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}Documentation Hub has been installed!${NC}"
if [ "$PLATFORM" = "macos" ]; then
    echo -e "${CYAN}Launch it from your Applications folder.${NC}"
else
    echo -e "${CYAN}Launch it from your application menu or run:${NC}"
    echo -e "${YELLOW}$DOWNLOAD_PATH${NC}"
fi
echo ""
