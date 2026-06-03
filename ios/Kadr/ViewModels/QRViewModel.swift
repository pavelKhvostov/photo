import Foundation
import CoreImage
import UIKit
import Observation

// MARK: - QRViewModel

@Observable
final class QRViewModel {
    let joinUrl: String
    let shortCode: String

    /// QR-изображение, генерируется локально через CIQRCodeGenerator (без сети).
    private(set) var qrImage: UIImage?

    init(joinUrl: String, shortCode: String) {
        self.joinUrl = joinUrl
        self.shortCode = shortCode
        // Генерируем QR синхронно при инициализации
        self.qrImage = Self.generateQR(from: joinUrl)
    }

    // MARK: - Локальная генерация QR

    /// Генерирует QR-код через Core Image CIQRCodeGenerator.
    /// Не зависит от сети — надёжнее, чем загружать qr_url из Storage.
    private static func generateQR(from string: String) -> UIImage? {
        guard
            let filter = CIFilter(name: "CIQRCodeGenerator"),
            let data = string.data(using: .utf8)
        else { return nil }

        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")

        guard let outputImage = filter.outputImage else { return nil }

        // Масштабируем до читаемого размера (300x300 pt)
        let targetSize: CGFloat = 300.0
        let scale = targetSize / outputImage.extent.width
        let scaled = outputImage.transformed(
            by: CGAffineTransform(scaleX: scale, y: scale)
        )

        let context = CIContext(options: nil)
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    // MARK: - Поделиться

    /// Элементы для UIActivityViewController: ссылка + QR-изображение (если сгенерировано)
    var shareItems: [Any] {
        var items: [Any] = [joinUrl]
        if let img = qrImage {
            items.append(img)
        }
        return items
    }
}
