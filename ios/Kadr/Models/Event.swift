import Foundation

// MARK: - Перечисления (SPECIFICATION §1)

/// Стиль камеры / фильтр. Хранится как text в Postgres.
enum CameraStyle: String, Codable, CaseIterable, Identifiable {
    case film35  = "film35"
    case vintage = "vintage"
    case bw      = "bw"
    case summer  = "summer"

    var id: String { rawValue }

    /// Человекочитаемое название (русский UI)
    var displayName: String {
        switch self {
        case .film35:  return "Плёнка 35мм"
        case .vintage: return "Винтаж"
        case .bw:      return "Ч/Б"
        case .summer:  return "Лето"
        }
    }
}

/// Статус события. Хранится как text в Postgres.
enum EventStatus: String, Codable {
    case draft    = "draft"
    case live     = "live"
    case revealed = "revealed"
    case archived = "archived"
    case deleted  = "deleted"

    var displayName: String {
        switch self {
        case .draft:    return "Черновик"
        case .live:     return "Активно"
        case .revealed: return "Проявлено"
        case .archived: return "Архив"
        case .deleted:  return "Удалено"
        }
    }
}

/// Код тарифного плана.
enum PlanCode: String, Codable {
    case free      = "free"
    case party     = "party"
    case wedding   = "wedding"
    case unlimited = "unlimited"

    var displayName: String {
        switch self {
        case .free:      return "Free"
        case .party:     return "Вечеринка"
        case .wedding:   return "Свадьба"
        case .unlimited: return "Безлимит"
        }
    }
}

// MARK: - Event

/// Событие. Поля соответствуют SPECIFICATION §2.2.
struct Event: Codable, Identifiable {
    let id: String
    let hostId: String?
    let title: String
    let cameraStyle: CameraStyle
    let shotsPerGuest: Int
    let plan: PlanCode
    let status: EventStatus
    let revealAt: Date?
    let shortCode: String
    let startsAt: Date?
    let expiresAt: Date
    let createdAt: Date

    // Возвращается только при создании (POST create-event)
    let joinUrl: String?
    let qrUrl: String?   // подписанный URL QR-кода из Storage (если есть)

    enum CodingKeys: String, CodingKey {
        case id
        case hostId        = "host_id"
        case title
        case cameraStyle   = "camera_style"
        case shotsPerGuest = "shots_per_guest"
        case plan
        case status
        case revealAt      = "reveal_at"
        case shortCode     = "short_code"
        case startsAt      = "starts_at"
        case expiresAt     = "expires_at"
        case createdAt     = "created_at"
        case joinUrl       = "join_url"
        case qrUrl         = "qr_url"
    }
}

// MARK: - CreateEventRequest / Response

/// Тело запроса на создание события (POST /functions/v1/create-event).
struct CreateEventRequest: Encodable {
    let title: String
    let cameraStyle: String
    let shotsPerGuest: Int
    let revealAt: Date?
    let startsAt: Date?

    enum CodingKeys: String, CodingKey {
        case title
        case cameraStyle   = "camera_style"
        case shotsPerGuest = "shots_per_guest"
        case revealAt      = "reveal_at"
        case startsAt      = "starts_at"
    }
}

/// Ответ на создание события.
struct CreateEventResponse: Codable {
    let id: String
    let shortCode: String
    let joinUrl: String
    let qrPath: String?
    let qrUrl: String?
    let plan: String
    let expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case shortCode = "short_code"
        case joinUrl   = "join_url"
        case qrPath    = "qr_path"
        case qrUrl     = "qr_url"
        case plan
        case expiresAt = "expires_at"
    }
}

// MARK: - RevealResponse

struct RevealResponse: Codable {
    let ok: Bool
    let status: String?
}
