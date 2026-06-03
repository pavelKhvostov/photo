import Foundation

/// Конфигурация приложения.
/// Для локальной разработки: заполни hostJWT токеном из `supabase status` + curl (см. README).
/// На продакшн: baseURL заменить на https://api.kadr.ru
enum AppConfig {
    // MARK: - Сетевые настройки

    /// Базовый URL self-hosted Supabase (РФ-инфраструктура).
    /// Для симулятора: http://127.0.0.1:54321
    /// Для устройства: http://<IP-мака>:54321
    static let baseURL = "http://127.0.0.1:54321"

    /// Anon-ключ Supabase (из `supabase status`)
    static let anonKey = "ВСТАВЬ_ANON_KEY_ЗДЕСЬ"

    // MARK: - Локальная разработка

    /// Тестовый JWT хоста для режима .mock (см. README — как получить).
    /// Оставь пустым — будет использован экран ввода телефона+OTP.
    static let hostJWT = ""

    // MARK: - Политика

    /// Версия политики обработки ПДн — должна совпадать с опубликованной на сайте.
    static let policyVersion = "2026-06-01"

    /// URL текста политики приватности
    static let privacyPolicyURL = URL(string: "https://kadr.ru/privacy")!
}
