import Foundation

// MARK: - Photo

/// Кадр. Соответствует SPECIFICATION §2.4.
struct Photo: Codable, Identifiable {
    let id: String
    let eventId: String
    let guestId: String
    let filter: CameraStyle
    let width: Int?
    let height: Int?
    let isFavorite: Bool
    let uploaded: Bool
    let takenAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case eventId   = "event_id"
        case guestId   = "guest_id"
        case filter
        case width
        case height
        case isFavorite = "is_favorite"
        case uploaded
        case takenAt   = "taken_at"
    }
}

// MARK: - PhotoURL

/// Ответ endpoint /functions/v1/photo-url
struct PhotoURLResponse: Codable {
    let url: String
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case url
        case expiresIn = "expires_in"
    }
}

// MARK: - SetFavoriteRequest

struct SetFavoriteRequest: Encodable {
    let isFavorite: Bool

    enum CodingKeys: String, CodingKey {
        case isFavorite = "is_favorite"
    }
}
