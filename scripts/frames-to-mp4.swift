// frames-to-mp4.swift —— 把一叠图片编码成 H.264 的 .mp4（只用 macOS 自带 AVFoundation）
//
// 为什么需要它：本机**没有 ffmpeg**（`which ffmpeg` 为空），而演示要交付一段能在任何播放器里
// 打开的 mp4。macOS 自带 AVFoundation + swiftc，几十行就能把图片序列写成 H.264 mp4。
//
// 用法：
//     swiftc -O scripts/frames-to-mp4.swift -o /tmp/frames-to-mp4
//     /tmp/frames-to-mp4 <帧目录> <输出.mp4> [fps]
// 帧目录里按文件名排序读取（*.png / *.jpg / *.jpeg）。

import Foundation
import AVFoundation
import CoreGraphics
import ImageIO
import CoreVideo

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("用法: frames-to-mp4 <帧目录> <输出.mp4> [fps]\n".data(using: .utf8)!)
    exit(2)
}
let framesDir = args[1]
let outPath = args[2]
let fps = args.count > 3 ? (Int(args[3]) ?? 10) : 10

let fm = FileManager.default
guard let names = try? fm.contentsOfDirectory(atPath: framesDir) else {
    FileHandle.standardError.write("读不到帧目录: \(framesDir)\n".data(using: .utf8)!)
    exit(3)
}
let files = names
    .filter { let e = ($0 as NSString).pathExtension.lowercased(); return ["png", "jpg", "jpeg"].contains(e) }
    .sorted()
    .map { (framesDir as NSString).appendingPathComponent($0) }

guard !files.isEmpty else {
    FileHandle.standardError.write("帧目录里没有图片\n".data(using: .utf8)!)
    exit(4)
}

// 用第一帧的尺寸建 writer
func loadCGImage(_ path: String) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}
guard let first = loadCGImage(files[0]) else {
    FileHandle.standardError.write("第一帧读不出来\n".data(using: .utf8)!)
    exit(5)
}
let width = first.width
let height = first.height
// H.264 要求宽高为偶数
let w = width % 2 == 0 ? width : width - 1
let h = height % 2 == 0 ? height : height - 1

try? fm.removeItem(atPath: outPath)
let writer = try! AVAssetWriter(outputURL: URL(fileURLWithPath: outPath), fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: w,
    AVVideoHeightKey: h,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 4_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: fps * 2,
    ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
        kCVPixelBufferWidthKey as String: w,
        kCVPixelBufferHeightKey as String: h,
    ]
)
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let attrs: [String: Any] = [
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
]
let colorSpace = CGColorSpaceCreateDeviceRGB()

var appended = 0
for (i, path) in files.enumerated() {
    guard let cg = loadCGImage(path) else { continue }
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pb)
    guard let buffer = pb else { continue }
    CVPixelBufferLockBaseAddress(buffer, [])
    if let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer),
        width: w, height: h, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) {
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])

    while !input.isReadyForMoreMediaData { usleep(2000) }
    let t = CMTime(value: CMTimeValue(i), timescale: CMTimeScale(fps))
    if !adaptor.append(buffer, withPresentationTime: t) {
        FileHandle.standardError.write("append 失败 @\(i)\n".data(using: .utf8)!)
    } else {
        appended += 1
    }
    if i % 100 == 0 { FileHandle.standardError.write("编码 \(i)/\(files.count)\n".data(using: .utf8)!) }
}
input.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()

let size = (try? fm.attributesOfItem(atPath: outPath)[.size] as? Int) ?? 0
print("✅ \(outPath)  \(w)×\(h)  \(appended) 帧 @\(fps)fps  ≈\(String(format: "%.1f", Double(appended) / Double(fps)))s  \(size ?? 0) bytes")
