import AppKit
import CoreImage
import Foundation

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: generate-mobile-preview-qr.swift <url> <output.png>\n", stderr)
  exit(2)
}

let url = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let generator = CIFilter(name: "CIQRCodeGenerator")!
generator.setValue(Data(url.utf8), forKey: "inputMessage")
generator.setValue("M", forKey: "inputCorrectionLevel")

guard let qrImage = generator.outputImage else {
  fputs("Could not generate the mobile preview QR code.\n", stderr)
  exit(1)
}

let scaledQR = qrImage.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
let canvas = scaledQR.extent.insetBy(dx: -36, dy: -36)
let background = CIImage(color: .white).cropped(to: canvas)
let imageWithQuietZone = scaledQR.composited(over: background)

guard
  let cgImage = CIContext().createCGImage(imageWithQuietZone, from: canvas),
  let pngData = NSBitmapImageRep(cgImage: cgImage).representation(
    using: .png,
    properties: [:]
  )
else {
  fputs("Could not encode the mobile preview QR code as PNG.\n", stderr)
  exit(1)
}

try pngData.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
print("Mobile preview QR code: \(outputPath)")
