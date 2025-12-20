# Audio Prime WebApp Delivery Plan

## Commercial Release Preparation Roadmap

**Document Version:** 1.0
**Created:** December 2024
**Target:** Commercial distribution via Linux (.deb, AppImage) and macOS (.dmg)

---

## Executive Summary

This document outlines the phased approach to prepare AUDIO_PRIME for commercial distribution. The plan covers security hardening, code quality, legal compliance, and distribution infrastructure.

---

## Phase 1: Security Foundation (Week 1-2)

### 1.1 Dependency Security Audit

**Objective:** Identify and remediate vulnerable dependencies

| Task | Tool | Command | Status |
|------|------|---------|--------|
| NPM vulnerability scan | npm audit | `npm audit --audit-level=moderate` | [ ] |
| Deep dependency scan | Snyk | `snyk test` | [ ] |
| Outdated packages | npm-check-updates | `ncu` | [ ] |
| Fix vulnerabilities | npm/manual | `npm audit fix` | [ ] |

**Acceptance Criteria:**
- [ ] Zero high/critical vulnerabilities
- [ ] All moderate vulnerabilities documented with remediation plan
- [ ] Dependencies updated to latest stable versions

### 1.2 License Compliance Audit

**Objective:** Ensure all dependencies are compatible with commercial distribution

| Task | Tool | Command | Status |
|------|------|---------|--------|
| License inventory | license-checker | `npx license-checker --summary` | [ ] |
| Compliance check | license-checker | `npx license-checker --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD"` | [ ] |
| Generate attribution | license-checker | `npx license-checker --json > licenses.json` | [ ] |
| Review copyleft licenses | Manual | Review GPL/LGPL dependencies | [ ] |

**Allowed Licenses (Commercial-friendly):**
- MIT
- Apache-2.0
- BSD-2-Clause / BSD-3-Clause
- ISC
- 0BSD
- Unlicense
- CC0-1.0

**Requires Review:**
- LGPL (dynamic linking usually OK)
- MPL-2.0 (file-level copyleft)

**Not Allowed:**
- GPL (without full source disclosure)
- AGPL
- SSPL

**Acceptance Criteria:**
- [ ] All dependencies use commercial-compatible licenses
- [ ] Attribution file generated (THIRD_PARTY_LICENSES.md)
- [ ] Any problematic dependencies replaced

### 1.3 Electron Security Hardening

**Objective:** Implement Electron security best practices

| Task | Location | Status |
|------|----------|--------|
| Verify `contextIsolation: true` | electron/main.ts | [x] |
| Verify `nodeIntegration: false` | electron/main.ts | [x] |
| Enable `sandbox: true` for renderer | electron/main.ts | [ ] |
| Add Content Security Policy | electron/main.ts | [ ] |
| Audit IPC handlers for input validation | electron/main.ts | [ ] |
| Minimize preload API surface | electron/preload.ts | [ ] |
| Disable `remote` module | electron/main.ts | [x] |
| Set `webSecurity: true` | electron/main.ts | [ ] |

**Content Security Policy Template:**
```javascript
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https://i.scdn.co data:",  // Spotify album art
        "connect-src 'self' https://api.spotify.com https://accounts.spotify.com",
        "font-src 'self'"
      ].join('; ')
    }
  });
});
```

**Acceptance Criteria:**
- [ ] All Electron security flags properly configured
- [ ] CSP implemented and tested
- [ ] IPC handlers validate all inputs

---

## Phase 2: Code Quality & Static Analysis (Week 2-3)

### 2.1 TypeScript Strict Mode

**Objective:** Enable maximum type safety

| Compiler Option | Current | Target | Status |
|----------------|---------|--------|--------|
| strict | true | true | [x] |
| noImplicitAny | ? | true | [ ] |
| strictNullChecks | ? | true | [ ] |
| strictFunctionTypes | ? | true | [ ] |
| noUnusedLocals | ? | true | [ ] |
| noUnusedParameters | ? | true | [ ] |
| noImplicitReturns | ? | true | [ ] |
| noFallthroughCasesInSwitch | ? | true | [ ] |

### 2.2 ESLint Security Configuration

**Objective:** Automated detection of security issues and code smells

**Plugins to Install:**
```bash
npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
  eslint-plugin-security \
  eslint-plugin-no-secrets \
  eslint-plugin-svelte
```

**ESLint Config (.eslintrc.cjs):**
```javascript
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended-legacy',
    'plugin:svelte/recommended'
  ],
  plugins: ['@typescript-eslint', 'security', 'no-secrets'],
  rules: {
    'no-secrets/no-secrets': 'error',
    'security/detect-object-injection': 'warn',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-eval-with-expression': 'error',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'warn'
  }
};
```

### 2.3 Automated Security Scanning

**Objective:** CI/CD integrated security scanning

| Tool | Purpose | Integration |
|------|---------|-------------|
| CodeQL | SAST scanning | GitHub Actions |
| Semgrep | Pattern-based scanning | CLI / CI |
| Snyk | Dependency + code scanning | CLI / CI |
| Trivy | Container/filesystem scanning | CLI |

**GitHub Actions Workflow (.github/workflows/security.yml):**
```yaml
name: Security Scan
on: [push, pull_request]
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm audit --audit-level=moderate
      - name: Run Snyk
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

**Acceptance Criteria:**
- [ ] Zero ESLint security errors
- [ ] TypeScript strict mode enabled with no errors
- [ ] CI pipeline running security scans on every PR

---

## Phase 3: API & Authentication Security (Week 3-4)

### 3.1 Spotify API Compliance

**Objective:** Ensure compliance with Spotify Developer Terms

| Requirement | Status | Notes |
|-------------|--------|-------|
| Review Developer Terms of Service | [ ] | https://developer.spotify.com/terms/ |
| Commercial use approval (if required) | [ ] | May need extended quota |
| Proper attribution/branding | [ ] | "Spotify" logo usage guidelines |
| User data handling compliance | [ ] | What data is stored/transmitted |
| Rate limiting implementation | [ ] | Respect API rate limits |
| Token refresh error handling | [ ] | Graceful degradation |

**Spotify Branding Requirements:**
- [ ] Include "Powered by Spotify" or Spotify logo where applicable
- [ ] Follow Spotify Brand Guidelines
- [ ] Don't imply Spotify endorsement

### 3.2 OAuth Token Security

**Objective:** Secure handling of authentication tokens

| Task | Status |
|------|--------|
| Tokens stored only in memory (not localStorage) | [ ] |
| Refresh tokens encrypted if persisted | [ ] |
| Token expiration handled gracefully | [ ] |
| Logout clears all token data | [ ] |
| No tokens in logs or error messages | [ ] |

### 3.3 Secure Communication

**Objective:** All external communication over TLS

| Endpoint | Protocol | Verified |
|----------|----------|----------|
| Spotify API | HTTPS | [ ] |
| Spotify Auth | HTTPS | [ ] |
| Any future update server | HTTPS | [ ] |

**Acceptance Criteria:**
- [ ] Spotify Developer Terms reviewed and complied with
- [ ] Token handling follows security best practices
- [ ] All external requests use HTTPS

---

## Phase 4: Performance & Stability (Week 4-5)

### 4.1 Memory Leak Detection

**Objective:** Ensure stable long-running operation

| Test | Tool | Duration | Status |
|------|------|----------|--------|
| Baseline memory profile | Chrome DevTools | 1 hour | [ ] |
| Extended runtime test | DevTools + heapdump | 8 hours | [ ] |
| Panel toggle stress test | Manual | 100 cycles | [ ] |
| Audio source switching | Manual | 50 cycles | [ ] |

**Memory Profiling Commands:**
```bash
# Enable Node.js heap snapshots
NODE_OPTIONS="--expose-gc" npm run dev

# Generate heap snapshot from DevTools
# Main Process: chrome://inspect
# Renderer: DevTools > Memory tab
```

### 4.2 CPU Performance Profiling

**Objective:** Maintain 60 FPS under all conditions

| Scenario | Target FPS | Status |
|----------|------------|--------|
| All panels active | 60 FPS | [ ] |
| Spectrum + Waterfall | 60 FPS | [ ] |
| 4K resolution | 60 FPS | [ ] |
| Low-end hardware (2 core) | 30 FPS | [ ] |

### 4.3 Error Handling & Crash Reporting

**Objective:** Graceful error handling with telemetry (opt-in)

| Task | Status |
|------|--------|
| Global error boundary in Svelte | [ ] |
| Uncaught exception handler in main process | [ ] |
| Crash reporter integration (Sentry/Bugsnag) | [ ] |
| User-facing error messages (non-technical) | [ ] |
| Automatic recovery where possible | [ ] |

**Acceptance Criteria:**
- [ ] No memory leaks detected over 8-hour test
- [ ] Consistent 60 FPS on target hardware
- [ ] Graceful error handling with user notification

---

## Phase 5: Legal & Documentation (Week 5-6)

### 5.1 Legal Documents

| Document | Status | Location |
|----------|--------|----------|
| Privacy Policy | [ ] | docs/PRIVACY_POLICY.md |
| Terms of Service | [ ] | docs/TERMS_OF_SERVICE.md |
| Third-Party Licenses | [ ] | THIRD_PARTY_LICENSES.md |
| EULA (End User License Agreement) | [ ] | docs/EULA.md |

### 5.2 User Documentation

| Document | Status | Location |
|----------|--------|----------|
| User Guide | [x] | docs/USER_GUIDE.md |
| Installation Guide | [ ] | docs/INSTALLATION.md |
| Troubleshooting Guide | [ ] | docs/TROUBLESHOOTING.md |
| FAQ | [ ] | docs/FAQ.md |
| Changelog | [ ] | CHANGELOG.md |

### 5.3 Developer Documentation

| Document | Status | Location |
|----------|--------|----------|
| Architecture Overview | [ ] | docs/ARCHITECTURE.md |
| Build Instructions | [ ] | docs/DEVELOPMENT.md |
| API Documentation | [ ] | docs/API.md |
| Contributing Guide | [ ] | CONTRIBUTING.md |

**Acceptance Criteria:**
- [ ] All legal documents reviewed by legal counsel (recommended)
- [ ] User documentation complete and accurate
- [ ] License attribution file generated

---

## Phase 6: Distribution & Signing (Week 6-7)

### 6.1 macOS Code Signing & Notarization

**Objective:** Signed and notarized macOS distribution

**Prerequisites:**
- [x] Apple Developer Account ($99/year)
- [ ] Developer ID Application certificate
- [ ] Developer ID Installer certificate (for .pkg)
- [ ] App-specific password for notarization

**Setup Steps:**
```bash
# 1. Generate certificates in Apple Developer portal
# 2. Download and install in Keychain

# 3. Configure electron-builder (package.json)
"mac": {
  "category": "public.app-category.music",
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "identity": "Developer ID Application: Your Name (TEAM_ID)",
  "notarize": {
    "teamId": "TEAM_ID"
  }
}

# 4. Create entitlements file (build/entitlements.mac.plist)
```

**Entitlements File (build/entitlements.mac.plist):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
</dict>
</plist>
```

| Task | Status |
|------|--------|
| Generate Developer ID certificates | [ ] |
| Configure electron-builder for signing | [ ] |
| Create entitlements.plist | [ ] |
| Test notarization workflow | [ ] |
| Verify app launches on clean macOS | [ ] |

### 6.2 Linux Distribution

**Objective:** Professional Linux packages

| Format | Target | Status |
|--------|--------|--------|
| .deb | Ubuntu/Debian | [x] |
| AppImage | Universal | [x] |
| .rpm | Fedora/RHEL | [ ] |
| Snap | Ubuntu Store | [ ] |
| Flatpak | Flathub | [ ] |

**Package Metadata:**
```json
"linux": {
  "target": ["deb", "AppImage", "rpm"],
  "category": "AudioVideo;Audio;Music",
  "maintainer": "Your Name <email@example.com>",
  "vendor": "Your Company",
  "synopsis": "Professional Audio Analysis & Visualization",
  "description": "Real-time audio spectrum analyzer with LUFS metering, beat detection, and Spotify integration."
}
```

### 6.3 Auto-Update Infrastructure

**Objective:** Secure automatic updates

| Task | Status |
|------|--------|
| Set up update server (GitHub Releases or custom) | [ ] |
| Configure electron-updater | [ ] |
| Implement update UI in app | [ ] |
| Test update flow end-to-end | [ ] |
| Sign update packages | [ ] |

**Acceptance Criteria:**
- [ ] macOS app signed and notarized successfully
- [ ] Linux packages (.deb, AppImage) building correctly
- [ ] Auto-update tested and working

---

## Phase 7: Pre-Release Testing (Week 7-8)

### 7.1 Platform Testing Matrix

| Platform | Version | Hardware | Status |
|----------|---------|----------|--------|
| Ubuntu 22.04 LTS | .deb | Intel | [ ] |
| Ubuntu 24.04 LTS | .deb | Intel | [ ] |
| Ubuntu 22.04 | AppImage | AMD | [ ] |
| Fedora 39 | .rpm | Intel | [ ] |
| macOS 13 Ventura | .dmg | Apple Silicon | [ ] |
| macOS 14 Sonoma | .dmg | Apple Silicon | [ ] |
| macOS 14 Sonoma | .dmg | Intel | [ ] |

### 7.2 Functionality Checklist

| Feature | Linux | macOS | Status |
|---------|-------|-------|--------|
| Audio capture (PulseAudio) | [ ] | N/A | |
| Audio capture (PipeWire) | [ ] | N/A | |
| Audio capture (CoreAudio) | N/A | [ ] | |
| Spectrum analyzer | [ ] | [ ] | |
| LUFS metering | [ ] | [ ] | |
| Beat detection | [ ] | [ ] | |
| Voice detection | [ ] | [ ] | |
| Spotify integration | [ ] | [ ] | |
| Panel drag/resize | [ ] | [ ] | |
| Fullscreen mode | [ ] | [ ] | |
| Settings persistence | [ ] | [ ] | |

### 7.3 Beta Testing Program

| Task | Status |
|------|--------|
| Recruit beta testers (10-20 users) | [ ] |
| Set up feedback collection (form/Discord) | [ ] |
| Distribute beta builds | [ ] |
| Collect and triage feedback | [ ] |
| Fix critical issues | [ ] |

**Acceptance Criteria:**
- [ ] All platform tests passing
- [ ] Beta feedback addressed
- [ ] No critical bugs remaining

---

## Tool Installation Reference

### Development Tools

```bash
# Security scanning
npm install -D snyk
npx snyk auth  # One-time authentication

# License checking
npm install -D license-checker

# Dependency updates
npm install -g npm-check-updates

# ESLint with security plugins
npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
  eslint-plugin-security eslint-plugin-no-secrets eslint-plugin-svelte

# Memory profiling
npm install -D heapdump clinic
```

### CI/CD Tools

```bash
# GitHub CLI (for releases)
sudo apt install gh

# Semgrep (local scanning)
pip install semgrep

# Trivy (filesystem scanning)
sudo apt install trivy
```

### macOS Signing Tools

```bash
# Xcode Command Line Tools (on macOS)
xcode-select --install

# electron-notarize is included with electron-builder
```

---

## Timeline Summary

| Phase | Duration | Focus |
|-------|----------|-------|
| Phase 1 | Week 1-2 | Security Foundation |
| Phase 2 | Week 2-3 | Code Quality & Static Analysis |
| Phase 3 | Week 3-4 | API & Authentication Security |
| Phase 4 | Week 4-5 | Performance & Stability |
| Phase 5 | Week 5-6 | Legal & Documentation |
| Phase 6 | Week 6-7 | Distribution & Signing |
| Phase 7 | Week 7-8 | Pre-Release Testing |

**Total Estimated Timeline:** 8 weeks

---

## Success Metrics

### Security
- Zero high/critical vulnerabilities
- All dependencies commercially licensed
- Electron security score: A (via electronegativity)

### Quality
- TypeScript strict mode: 100% compliance
- ESLint: Zero errors, <10 warnings
- Test coverage: >70% (if tests added)

### Performance
- Memory: <500MB after 8 hours
- CPU: <10% idle, <50% active visualization
- FPS: Consistent 60 FPS on target hardware

### Distribution
- macOS: Signed + Notarized
- Linux: .deb, AppImage, .rpm packages
- Auto-update: Functional and secure

---

## Appendix A: Security Checklist Quick Reference

```
[ ] npm audit clean
[ ] Snyk scan clean
[ ] License audit passed
[ ] Electron security flags verified
[ ] CSP implemented
[ ] IPC handlers validated
[ ] OAuth tokens secured
[ ] TypeScript strict mode
[ ] ESLint security rules passing
[ ] No secrets in codebase
[ ] HTTPS only for external connections
[ ] Error handling implemented
[ ] macOS signed and notarized
[ ] Linux packages tested
[ ] Auto-update secured
```

---

## Appendix B: File Checklist for Release

```
AUDIO_PRIME/
├── LICENSE                    # Your license
├── THIRD_PARTY_LICENSES.md    # Attribution file
├── CHANGELOG.md               # Version history
├── README.md                  # Product overview
├── docs/
│   ├── USER_GUIDE.md
│   ├── INSTALLATION.md
│   ├── TROUBLESHOOTING.md
│   ├── FAQ.md
│   ├── PRIVACY_POLICY.md
│   ├── TERMS_OF_SERVICE.md
│   └── EULA.md
├── build/
│   └── entitlements.mac.plist
└── .github/
    └── workflows/
        └── security.yml
```

---

*This document should be updated as phases are completed.*
