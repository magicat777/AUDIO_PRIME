#!/usr/bin/env swift

import Foundation
import AVFoundation
import CoreAudio
import ScreenCaptureKit

/// macOS System Audio Capture for AUDIO_PRIME
/// Uses ScreenCaptureKit (macOS 12.3+) to capture system audio output
/// Outputs raw PCM float32le to stdout at 48kHz stereo

@available(macOS 12.3, *)
class SystemAudioCapture: NSObject {
    private var stream: SCStream?
    private let sampleRate: Double = 48000.0

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

        fputs("Available audio output devices:\n", stderr)
        fputs("  system: System Audio (recommended - captures all playing audio)\n", stderr)

        for deviceID in deviceIDs {
            if let name = getDeviceName(deviceID),
               let uid = getDeviceUID(deviceID) {
                let outputChannels = getDeviceChannelCount(deviceID, scope: kAudioDevicePropertyScopeOutput)
                if outputChannels > 0 {
                    fputs("  \(uid): \(name) (\(outputChannels) channels)\n", stderr)
                }
            }
        }
    }

    func start() async {
        do {
            // Get available content for screen capture (includes system audio)
            let availableContent = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )

            // Configure to capture system audio only (no video)
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.sampleRate = Int(sampleRate)
            config.channelCount = 2

            // Don't capture video
            config.width = 1
            config.height = 1
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

            // Create filter to capture system audio
            let filter = SCContentFilter(
                display: availableContent.displays[0],
                excludingWindows: availableContent.windows
            )

            // Create and start stream
            stream = SCStream(filter: filter, configuration: config, delegate: nil)

            // Add audio output handler
            try stream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "AudioOutputQueue"))

            try await stream?.startCapture()

            fputs("System audio capture started. Press Ctrl+C to stop.\n", stderr)

        } catch {
            fputs("ERROR: Failed to start system audio capture: \(error.localizedDescription)\n", stderr)
            fputs("NOTE: This requires Screen Recording permission in System Preferences > Privacy & Security\n", stderr)
            exit(1)
        }
    }

    func stop() async {
        do {
            try await stream?.stopCapture()
        } catch {
            fputs("Error stopping capture: \(error.localizedDescription)\n", stderr)
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
}

// MARK: - SCStreamOutput Delegate
@available(macOS 12.3, *)
extension SystemAudioCapture: SCStreamOutput {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }

        // Get audio buffer
        var blockBuffer: CMBlockBuffer?
        var audioBufferListOut = AudioBufferList()
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &audioBufferListOut,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &blockBuffer
        )

        guard status == noErr else { return }
        defer { blockBuffer = nil }

        // Process each buffer
        let buffers = UnsafeMutableAudioBufferListPointer(&audioBufferListOut)
        for buffer in buffers {
            guard let data = buffer.mData else { continue }

            let samples = data.assumingMemoryBound(to: Float.self)

            // Write raw float32 samples to stdout
            let bytesData = Data(bytes: samples, count: Int(buffer.mDataByteSize))
            FileHandle.standardOutput.write(bytesData)
        }
    }
}

// MARK: - Main Entry Point
if #available(macOS 12.3, *) {
    let capture = SystemAudioCapture()

    // Handle command line arguments
    let args = CommandLine.arguments

    if args.count > 1 && (args[1] == "--list" || args[1] == "-l") {
        capture.listDevices()
        exit(0)
    }

    // Signal handling for clean shutdown
    signal(SIGINT) { _ in
        fputs("\nStopping capture...\n", stderr)
        exit(0)
    }
    signal(SIGTERM) { _ in
        exit(0)
    }

    // Start capture
    Task {
        await capture.start()
    }

    RunLoop.main.run()
} else {
    fputs("ERROR: This application requires macOS 12.3 or later\n", stderr)
    exit(1)
}
