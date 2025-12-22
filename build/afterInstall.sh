#!/bin/bash
# Post-installation script for AUDIO_PRIME
# Sets SUID bit on chrome-sandbox for Electron sandboxing

SANDBOX_PATH="/opt/AUDIO_PRIME/chrome-sandbox"

if [ -f "$SANDBOX_PATH" ]; then
    chown root:root "$SANDBOX_PATH"
    chmod 4755 "$SANDBOX_PATH"
    echo "Set SUID on chrome-sandbox for Electron sandboxing"
fi
