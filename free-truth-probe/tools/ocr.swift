// GENOE — witness OCR readback for iOS ScreenSesh screenshots.
// Compiles on the macOS runner with: swiftc -O ocr.swift -o genoe-ocr
// Prints recognized text lines from the given PNG, one per line.
import AppKit
import Vision

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write(Data("usage: ocr <png>\n".utf8))
    exit(2)
}
let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write(Data("could not load image\n".utf8))
    exit(3)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write(Data("perform failed: \(error)\n".utf8))
    exit(4)
}
var lines: [String] = []
for observation in request.results ?? [] {
    if let best = observation.topCandidates(1).first {
        lines.append(best.string)
    }
}
FileHandle.standardOutput.write(Data((lines.joined(separator: "\n") + "\n").utf8))