import Foundation

/// Конфигурация приложения.
/// Для локальной разработки: заполни hostJWT токеном из `supabase status` + curl (см. README).
/// На продакшн: baseURL заменить на https://api.kadr.ru
enum AppConfig {
    // MARK: - Сетевые настройки

    /// Базовый URL self-hosted Supabase (РФ-инфраструктура).
    /// Для симулятора: http://127.0.0.1:54321
    /// Для устройства: http://<IP-мака>:54321
    /// Симулятор: http://127.0.0.1:54321
    /// Реальное устройство: https://<IP-мака>:8444 (через caddy, т.к. iOS требует
    /// HTTPS и блокирует http по ATS). На устройстве 127.0.0.1 = сам телефон.
    static let baseURL = "https://192.168.50.124:8444"

    /// Publishable-ключ Supabase (из `supabase status`, новый формат sb_publishable_…)
    static let anonKey = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"

    // MARK: - Локальная разработка

    /// Локальный демо-вход: анонимная сессия Supabase в роли хоста.
    /// true → кнопка «Войти (демо)» делает signInAnonymously (валидный токен,
    /// create-event работает). На проде = false (вход телефон+OTP).
    static let useAnonymousHostLogin = true

    /// Тестовый JWT хоста для режима .mock (опционально). Оставь пустым.
    static let hostJWT = ""

    // MARK: - Политика

    /// Версия политики обработки ПДн — должна совпадать с опубликованной на сайте.
    static let policyVersion = "2026-06-01"

    /// URL текста политики приватности
    static let privacyPolicyURL = URL(string: "https://kadr.ru/privacy")!
}
