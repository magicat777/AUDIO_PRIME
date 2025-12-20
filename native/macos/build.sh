#!/bin/bash
# Build script for macOS AudioCapture utility

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../../build/macos"

echo "Building macOS AudioCapture utility..."

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Compile Swift source to executable
swiftc -O \
    -framework Foundation \
    -framework AVFoundation \
    -framework CoreAudio \
    "$SCRIPT_DIR/AudioCapture.swift" \
    -o "$OUTPUT_DIR/AudioCapture"

# Make executable
chmod +x "$OUTPUT_DIR/AudioCapture"

echo "✓ Built successfully: $OUTPUT_DIR/AudioCapture"

# Test the binary
if [ -f "$OUTPUT_DIR/AudioCapture" ]; then
    echo "✓ Binary exists and is ready"
else
    echo "✗ Build failed"
    exit 1
fi
