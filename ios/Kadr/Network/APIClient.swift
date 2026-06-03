import Foundation

// MARK: - APIClient

/// Сетевой слой. URLSession + async/await. Без сторонних зависимостей.
/// Фото отдаются только через подписанные URL (SPECIFICATION §5, 152-ФЗ).
final class APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let iso8601Decoder: JSONDecoder
    private let iso8601Encoder: JSONEncoder

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)

        // ISO8601 с дробными секундами (Supabase возвращает .SSSZ)
        self.iso8601Decoder = JSONDecoder()
        self.iso8601Decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            if let date = ISO8601DateFormatter.fractional.date(from: string) {
                return date
            }
            if let date = ISO8601DateFormatter.standard.date(from: string) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Неверный формат даты: \(string)"
            )
        }

        self.iso8601Encoder = JSONEncoder()
        self.iso8601Encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(ISO8601DateFormatter.fractional.string(from: date))
        }
    }

    // MARK: - Токен

    /// Текущий JWT хоста. Устанавливается AuthService после входа.
    var hostJWT: String = ""

    // MARK: - Вспомогательные методы

    private func baseHeaders() -> [String: String] {
        [
            "Authorization": "Bearer \(hostJWT)",
            "apikey": AppConfig.anonKey,
            "Content-Type": "application/json"
        ]
    }

    /// Строит URLRequest с базовыми заголовками.
    private func makeRequest(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        extraHeaders: [String: String] = [:]
    ) throws -> URLRequest {
        guard let url = URL(string: AppConfig.baseURL + path) else {
            throw KadrError.unknown
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        baseHeaders().forEach { request.setValue($1, forHTTPHeaderField: $0) }
        extraHeaders.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        return request
    }

    /// Выполняет запрос, декодирует успешный ответ или бросает KadrError.
    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw KadrError.unknown
        }
        if http.statusCode == 401 {
            throw KadrError.unauthorized
        }
        if !(200..<300).contains(http.statusCode) {
            // Пробуем распарсить структурированную ошибку API
            if let apiErr = try? iso8601Decoder.decode(ApiErrorResponse.self, from: data) {
                throw KadrError.apiError(code: apiErr.error.code, message: apiErr.error.message)
            }
            throw KadrError.httpError(statusCode: http.statusCode)
        }
        do {
            return try iso8601Decoder.decode(T.self, from: data)
        } catch {
            throw KadrError.decodingError(error.localizedDescription)
        }
    }

    /// Выполняет запрос без тела ответа (204 / пустой 200).
    private func performVoid(_ request: URLRequest) async throws {
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw KadrError.unknown
        }
        if http.statusCode == 401 { throw KadrError.unauthorized }
        if !(200..<300).contains(http.statusCode) {
            throw KadrError.httpError(statusCode: http.statusCode)
        }
    }

    // MARK: - События

    /// Создание события. POST /functions/v1/create-event
    func createEvent(_ req: CreateEventRequest) async throws -> CreateEventResponse {
        let body = try iso8601Encoder.encode(req)
        let request = try makeRequest(
            path: "/functions/v1/create-event",
            method: "POST",
            body: body
        )
        return try await perform(request)
    }

    /// Список своих событий. GET /rest/v1/events (PostgREST + RLS).
    func listEvents() async throws -> [Event] {
        let request = try makeRequest(
            path: "/rest/v1/events?select=*&order=created_at.desc",
            extraHeaders: ["Prefer": "return=representation"]
        )
        return try await perform(request)
    }

    /// Ручная проявка. POST /functions/v1/reveal
    func revealEvent(eventId: String) async throws -> RevealResponse {
        let body = try JSONSerialization.data(withJSONObject: ["event_id": eventId])
        let request = try makeRequest(
            path: "/functions/v1/reveal",
            method: "POST",
            body: body
        )
        return try await perform(request)
    }

    // MARK: - Фото

    /// Список фото события. GET /rest/v1/photos (PostgREST + RLS).
    /// guestId: опционально — фильтр «по гостю».
    func listPhotos(eventId: String, guestId: String? = nil) async throws -> [Photo] {
        var path = "/rest/v1/photos?event_id=eq.\(eventId)&uploaded=eq.true"
        path += "&select=id,event_id,guest_id,filter,width,height,is_favorite,uploaded,taken_at"
        path += "&order=taken_at.desc"
        if let guestId = guestId {
            path += "&guest_id=eq.\(guestId)"
        }
        let request = try makeRequest(path: path)
        return try await perform(request)
    }

    /// Получение подписанного URL фото.
    /// GET /functions/v1/photo-url?photo_id=<id> → { url, expires_in }
    /// Фото отдаются ТОЛЬКО через подписанный URL (152-ФЗ, SPECIFICATION §5).
    func photoURL(photoId: String) async throws -> PhotoURLResponse {
        let request = try makeRequest(path: "/functions/v1/photo-url?photo_id=\(photoId)")
        return try await perform(request)
    }

    /// Отметить / снять избранное. PATCH /rest/v1/photos?id=eq.<id>
    func setFavorite(photoId: String, isFavorite: Bool) async throws {
        let body = try iso8601Encoder.encode(SetFavoriteRequest(isFavorite: isFavorite))
        let request = try makeRequest(
            path: "/rest/v1/photos?id=eq.\(photoId)",
            method: "PATCH",
            body: body,
            extraHeaders: ["Prefer": "return=minimal"]
        )
        try await performVoid(request)
    }

    // MARK: - Auth (OTP, prod)

    /// Запрос OTP. POST /auth/otp  (SPECIFICATION §6.1)
    func requestOTP(phone: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["phone": phone])
        let request = try makeRequest(path: "/auth/otp", method: "POST", body: body)
        try await performVoid(request)
    }

    /// Подтверждение OTP. POST /auth/verify → { jwt, user }
    func verifyOTP(phone: String, code: String) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: ["phone": phone, "code": code])
        let request = try makeRequest(path: "/auth/verify", method: "POST", body: body)
        let response: OTPVerifyResponse = try await perform(request)
        return response.jwt
    }

    /// Локальный демо-вход: анонимная сессия Supabase в роли хоста.
    /// POST /auth/v1/signup (пустое тело) → { access_token }. Токен валиден
    /// для create-event и др. На проде заменяется на телефон+OTP.
    func signInAnonymously() async throws -> String {
        guard let url = URL(string: AppConfig.baseURL + "/auth/v1/signup") else {
            throw KadrError.unknown
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(AppConfig.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        let response: AnonSessionResponse = try await perform(request)
        return response.accessToken
    }
}

// MARK: - OTPVerifyResponse

private struct OTPVerifyResponse: Decodable {
    let jwt: String
}

// MARK: - AnonSessionResponse

private struct AnonSessionResponse: Decodable {
    let accessToken: String
    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
    }
}

// MARK: - ISO8601DateFormatter helpers

private extension ISO8601DateFormatter {
    static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static let standard: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
