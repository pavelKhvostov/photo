import Foundation

// MARK: - ApiError

/// Структура ошибки API: { "error": { "code": "...", "message": "..." } }
/// Соответствует SPECIFICATION §6 и CLAUDE.md конвенции ошибок.
struct ApiErrorResponse: Codable {
    struct ErrorDetail: Codable {
        let code: String
        let message: String
    }
    let error: ErrorDetail
}

/// Swift-ошибка, бросаемая APIClient.
enum KadrError: LocalizedError {
    case apiError(code: String, message: String)
    case httpError(statusCode: Int)
    case decodingError(String)
    case networkError(Error)
    case unauthorized
    case unknown

    var errorDescription: String? {
        switch self {
        case .apiError(_, let message):
            return message
        case .httpError(let code):
            return "Ошибка сервера: \(code)"
        case .decodingError(let detail):
            return "Ошибка разбора ответа: \(detail)"
        case .networkError(let err):
            return "Нет соединения: \(err.localizedDescription)"
        case .unauthorized:
            return "Требуется авторизация"
        case .unknown:
            return "Неизвестная ошибка"
        }
    }

    /// Человекочитаемые сообщения для edge cases (SPECIFICATION §9)
    var userMessage: String {
        switch self {
        case .apiError(let code, let message):
            switch code {
            case "shot_limit_reached":
                return "Вы использовали все кадры для этого события."
            case "guests_limit_reached":
                return "Достигнут лимит гостей. Хост может расширить тариф."
            case "event_closed":
                return "Событие завершено."
            case "already_revealed":
                return "Галерея уже проявлена."
            case "not_host":
                return "Только хост может выполнить это действие."
            default:
                return message
            }
        default:
            return errorDescription ?? "Неизвестная ошибка"
        }
    }
}
