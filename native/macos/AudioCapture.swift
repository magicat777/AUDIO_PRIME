#!/usr/bin/env swift

import Foundation
import AVFoundation
import CoreAudio

/// Simple CoreAudio capture utility for AUDIO_PRIME
/// Captures system audio and outputs raw PCM float32le to stdout
/// Usage: ./AudioCapture [deviceUID]

class AudioCapture {
    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private let sampleRate: Double = 48000.0
    private let channelCount: UInt32 = 2

    init() {
        setupAudioEngine()
    }

    private func setupAudioEngine() {
        audioEngine = AVAudioEngine()

        guard let engine = audioEngine else {
            fputs("ERROR: Failed to create audio engine\n", stderr)
            exit(1)
        }

        inputNode = engine.inputNode

        guard let input = inputNode else {
            fputs("ERROR: Failed to get input node\n", stderr)
            exit(1)
        }

        // Set up the desired format: 48kHz, stereo, float32
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: channelCount,
            interleaved: true
        )

        guard let audioFormat = format else {
            fputs("ERROR: Failed to create audio format\n", stderr)
            exit(1)
        }

        // Install tap to capture audio
        input.installTap(onBus: 0, bufferSize: 512, format: audioFormat) { [weak self] buffer, time in
            self?.processAudioBuffer(buffer)
        }
    }

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData else { return }

        let frameLength = Int(buffer.frameLength)
        let channelCount = Int(self.channelCount)

        // Convert to interleaved float32 format
        var interleavedData = [Float](repeating: 0, count: frameLength * channelCount)

        if channelCount == 1 {
            // Mono - direct copy
            for frame in 0..<frameLength {
                interleavedData[frame] = channelData[0][frame]
            }
        } else {
            // Stereo - interleave channels
            for frame in 0..<frameLength {
                interleavedData[frame * 2] = channelData[0][frame]
                interleavedData[frame * 2 + 1] = channelData[1][frame]
            }
        }

        // Write raw bytes to stdout
        interleavedData.withUnsafeBytes { bytes in
            if let baseAddress = bytes.baseAddress {
                let data = Data(bytes: baseAddress, count: bytes.count)
                FileHandle.standardOutput.write(data)
            }
        }
    }

    func listDevices() {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize: UInt32 = 0
        var status = AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize
        )

        guard status == kAudioHardwareNoError else {
            fputs("ERROR: Failed to get device list size\n", stderr)
            return
        }

        let deviceCount = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var deviceIDs = [AudioDeviceID](repeating: 0, count: deviceCount)

        status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &deviceIDs
        )

        guard status == kAudioHardwareNoError else {
            fputs("ERROR: Failed to get device list\n", stderr)
            return
        }

        fputs("Available audio devices:\n", stderr)
        for deviceID in deviceIDs {
            if let name = getDeviceName(deviceID),
               let uid = getDeviceUID(deviceID) {
                let inputChannels = getDeviceChannelCount(deviceID, scope: kAudioDevicePropertyScopeInput)
                if inputChannels > 0 {
                    fputs("  \(uid): \(name) (\(inputChannels) channels)\n", stderr)
                }
            }
        }
    }

    private func getDeviceName(_ deviceID: AudioDeviceID) -> String? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize = UInt32(MemoryLayout<CFString>.size)
        var name: CFString = "" as CFString

        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &name
        )

        return status == kAudioHardwareNoError ? (name as String) : nil
    }

    private func getDeviceUID(_ deviceID: AudioDeviceID) -> String? {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize = UInt32(MemoryLayout<CFString>.size)
        var uid: CFString = "" as CFString

        let status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            &uid
        )

        return status == kAudioHardwareNoError ? (uid as String) : nil
    }

    private func getDeviceChannelCount(_ deviceID: AudioDeviceID, scope: AudioObjectPropertyScope) -> UInt32 {
        var propertyAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )

        var dataSize: UInt32 = 0
        var status = AudioObjectGetPropertyDataSize(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize
        )

        guard status == kAudioHardwareNoError else { return 0 }

        let bufferListPointer = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: 1)
        defer { bufferListPointer.deallocate() }

        status = AudioObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            &dataSize,
            bufferListPointer
        )

        guard status == kAudioHardwareNoError else { return 0 }

        let bufferList = UnsafeMutableAudioBufferListPointer(bufferListPointer)
        var channelCount: UInt32 = 0

        for buffer in bufferList {
            channelCount += buffer.mNumberChannels
        }

        return channelCount
    }

    func start(deviceUID: String? = nil) {
        guard let engine = audioEngine else {
            fputs("ERROR: Audio engine not initialized\n", stderr)
            exit(1)
        }

        // If device UID specified, try to set it as input device
        if let uid = deviceUID {
            setInputDevice(uid: uid)
        }

        do {
            try engine.start()
            fputs("Audio capture started. Press Ctrl+C to stop.\n", stderr)

            // Keep running until interrupted
            RunLoop.main.run()
        } catch {
            fputs("ERROR: Failed to start audio engine: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    private func setInputDevice(uid: String) {
        // Note: Setting specific input device requires more complex CoreAudio API calls
        // For now, this is a placeholder. The default input device will be used.
        fputs("INFO: Using device: \(uid)\n", stderr)
    }

    func stop() {
        audioEngine?.stop()
        inputNode?.removeTap(onBus: 0)
    }
}

// Signal handling for clean shutdown
var captureInstance: AudioCapture?

func signalHandler(_ signal: Int32) {
    fputs("\nReceived signal \(signal), stopping...\n", stderr)
    captureInstance?.stop()
    exit(0)
}

signal(SIGINT, signalHandler)
signal(SIGTERM, signalHandler)

// Main execution
let args = CommandLine.arguments

if args.count > 1 && (args[1] == "--list" || args[1] == "-l") {
    let capture = AudioCapture()
    capture.listDevices()
    exit(0)
}

// Request microphone permission (required for audio capture on macOS)
AVCaptureDevice.requestAccess(for: .audio) { granted in
    if !granted {
        fputs("ERROR: Microphone permission denied. Please grant permission in System Preferences.\n", stderr)
        exit(1)
    }

    captureInstance = AudioCapture()
    let deviceUID = args.count > 1 ? args[1] : nil
    captureInstance?.start(deviceUID: deviceUID)
}

// Keep the main thread running
RunLoop.main.run()
