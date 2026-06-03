import Foundation
import Observation

// MARK: - AuthMode

/// Режим аутентификации.
/// .mock — локальная разработка: берём JWT из AppConfig.hostJWT.
/// .otp  — продакшн: телефон + SMS OTP через SMS Aero/SMSC.
enum AuthMode {
    case mock
    case otp
}

// MARK: - AuthService

/// Сервис аутентификации хоста.
/// @MainActor — все обновления состояния происходят на главном потоке (SwiftUI).
@Observable
@MainActor
final class AuthService {
    // MARK: Режим
    private(set) var mode: AuthMode

    // MARK: Состояние
    private(set) var isAuthenticated: Bool = false
    private(set) var currentJWT: String = ""
    private(set) var errorMessage: String?

    init() {
        self.mode = AppConfig.hostJWT.isEmpty ? .otp : .mock
    }

    // MARK: - Mock-вход (локальная разработка)

    /// Войти с тестовым JWT из AppConfig.hostJWT.
    func loginWithMockToken() {
        guard !AppConfig.hostJWT.isEmpty else {
            errorMessage = "AppConfig.hostJWT не заполнен. Добавьте тестовый токен (см. README)."
            return
        }
        applyJWT(AppConfig.hostJWT)
    }

    // MARK: - OTP-вход (продакшн)

    /// Шаг 1: запросить OTP-код.
    func requestOTP(phone: String) async {
        do {
            try await APIClient.shared.requestOTP(phone: phone)
            errorMessage = nil
        } catch {
            errorMessage = (error as? KadrError)?.userMessage ?? error.localizedDescription
        }
    }

    /// Шаг 2: подтвердить OTP, получить JWT.
    func verifyOTP(phone: String, code: String) async {
        do {
            let jwt = try await APIClient.shared.verifyOTP(phone: phone, code: code)
            applyJWT(jwt)
            errorMessage = nil
        } catch {
            errorMessage = (error as? KadrError)?.userMessage ?? error.localizedDescription
        }
    }

    // MARK: - Выход

    func logout() {
        currentJWT = ""
        APIClient.shared.hostJWT = ""
        isAuthenticated = false
    }

    // MARK: - Private

    private func applyJWT(_ jwt: String) {
        currentJWT = jwt
        APIClient.shared.hostJWT = jwt
        isAuthenticated = true
    }
}
